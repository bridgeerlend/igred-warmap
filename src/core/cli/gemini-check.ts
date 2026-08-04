/**
 * Reports exactly what the configured Gemini key can and cannot do.
 *
 * The API's failures are not self-explanatory: a retired model 404s with a helpful message,
 * a model outside your tier 404s with an empty body, and an exhausted allowance 429s with
 * `limit: 0` whether you have used it or not. Rather than guess a model and hope, this asks
 * the service and prints the answer.
 *
 * Run: npm run gemini:check
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { repoRoot } from '../util/paths.js';
import { loadLocalEnv } from '../util/env.js';

loadLocalEnv();

const config = loadConfig().brief;
const apiKey = process.env[config.ai.credentialEnvVar]?.trim();

if (!apiKey) {
  console.log(`${config.ai.credentialEnvVar} is not set. Nothing to check.`);
  process.exit(0);
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const headers = { 'x-goog-api-key': apiKey, 'content-type': 'application/json' };

interface ModelEntry {
  name: string;
  supportedGenerationMethods?: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- can we see the catalogue at all? ---------------------------- */

const listResponse = await fetch(`${BASE}/models?pageSize=200`, { headers });
const listBody = (await listResponse.json().catch(() => ({}))) as {
  models?: ModelEntry[];
  error?: { status?: string; message?: string };
};

if (!listResponse.ok) {
  console.log(`Cannot list models: HTTP ${listResponse.status} ${listBody.error?.status ?? ''}`);
  console.log(listBody.error?.message ?? '');
  console.log(
    '\nPERMISSION_DENIED here means the Generative Language API is not enabled on the key’s project.',
  );
  process.exit(0);
}

const callable = (listBody.models ?? [])
  .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
  .map((model) => model.name.replace(/^models\//, ''))
  // Text models only: image, tts and embedding variants cannot draft a paragraph.
  .filter((name) => !/(image|tts|embedding|vision|nano-banana|lyria|omni)/.test(name));

console.log(`The key works and the API is enabled — ${callable.length} text models are listed.\n`);

/* ---------- which of them will actually answer? ------------------------- */

// Newest first: a retired model reports itself clearly, so it is worth trying last.
const candidates = [config.ai.model, ...callable].filter(
  (name, index, all) => all.indexOf(name) === index,
);

let working: string | undefined;
const notes: string[] = [];

for (const model of candidates.slice(0, 10)) {
  const response = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
      generationConfig: { maxOutputTokens: 200 },
    }),
  });

  if (response.ok) {
    working = model;
    console.log(`  ${model.padEnd(30)} works`);
    break;
  }

  const text = await response.text();
  let reason = `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: { status?: string; message?: string } };
    const message = parsed.error?.message ?? '';
    if (/no longer available/i.test(message)) reason = 'retired for new users';
    else if (/limit: 0/.test(message)) reason = 'no allowance on this project (limit: 0)';
    else reason = `${parsed.error?.status ?? response.status}`;
  } catch {
    // An empty body on a listed model means it is outside this project's tier.
    if (text.trim().length === 0) reason = `HTTP ${response.status}, empty body — outside this project's tier`;
  }
  console.log(`  ${model.padEnd(30)} ${reason}`);
  notes.push(reason);
  await sleep(2000);
}

console.log();
if (working) {
  console.log(`Set "model": "${working}" in config/brief.json.`);
} else if (notes.some((note) => note.includes('limit: 0'))) {
  console.log('No model has an allowance on this project.');
  console.log('The key and the API are fine; the project has no quota to spend.');
  console.log('Check the tier and billing for this key at https://aistudio.google.com/apikey —');
  console.log('that page also shows which Google Cloud project each key belongs to.');
} else {
  console.log('No model answered. The Brief will publish without prose, which is a valid edition.');
}
