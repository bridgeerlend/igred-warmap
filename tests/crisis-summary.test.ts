import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSummary, currentSummary, normaliseNumbers, runSummaries, type SummarySettings, type SummaryState } from '../src/core/crises/summary.js';

const input = {
  id: 'sudan',
  name: "Sudan's civil war",
  facts: ['27 armed incidents reported in the past seven days, 23% more than the week before.'],
  headlines: [
    { title: 'RSF drone strike hits market in El Obeid, killing 12', url: 'https://example.org/a', publisher: 'Example One' },
    { title: 'Army says it repelled attack on Babanusa', url: 'https://example.org/b', publisher: 'Example Two' },
    { title: 'UN warns of famine in Darfur camps', url: 'https://example.org/c', publisher: 'Example Three' },
  ],
};

const settings: SummarySettings = {
  enabled: true, minHoursBetween: 3, maxAgeHours: 72, maxPerRun: 30, maxWords: 110, timeoutMs: 5000,
  providers: [{ id: 'free', url: 'https://llm.example/v1/chat/completions', model: 'm', keyEnv: 'TEST_KEY' }],
};

const good = {
  en: 'Fighting continues across Kordofan and Darfur. A drone strike on a market in El Obeid killed 12 people. The army says it repelled an attack on Babanusa. The UN warns of famine in Darfur camps.',
  nb: 'Kampene fortsetter i Kordofan og Darfur. Et droneangrep på et marked i El Obeid drepte 12 mennesker. Hæren sier den slo tilbake et angrep på Babanusa. FN advarer om hungersnød i leirene i Darfur.',
};

function reply(body: unknown, status = 200) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe('the crisis summary guard', () => {
  it('accepts text whose every figure is in the material, in both languages', () => {
    const source = [...input.facts, ...input.headlines.map((h) => h.title)].join('\n');
    expect(checkSummary(good.en, good.nb, source, 110)).toEqual({ ok: true });
  });

  it('rejects a figure the sources do not contain, even if only the Norwegian has it', () => {
    const source = [...input.facts, ...input.headlines.map((h) => h.title)].join('\n');
    const result = checkSummary(good.en, good.nb.replace('12 mennesker', '14 mennesker'), source, 110);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^nb: figure "14"/);
  });

  it('reads Norwegian thousands spaces as the same figure', () => {
    expect(normaliseNumbers('1 481 hendelser')).toBe('1481 hendelser');
  });
});

describe('the crisis summary run', () => {
  it('stores a passing summary with the headlines it was written from', async () => {
    vi.stubGlobal('fetch', reply({ choices: [{ message: { content: JSON.stringify(good) } }] }));
    const states = {};
    await runSummaries([input], states, settings, Date.parse('2026-10-10T12:00:00Z'), { TEST_KEY: 'k' });
    const s = (states as Record<string, { approved: { sources: unknown[]; en: string } }>).sudan!.approved;
    expect(s.en).toBe(good.en);
    expect(s.sources).toHaveLength(3);
  });

  it('keeps the previous approved text when the new draft invents a figure', async () => {
    vi.stubGlobal('fetch', reply({ choices: [{ message: { content: JSON.stringify({ ...good, en: good.en.replace('12', '40') }) } }] }));
    const previous = { en: 'old', nb: 'gammel', model: 'x', writtenAt: '2026-10-10T08:00:00.000Z', sources: input.headlines };
    const states: Record<string, { approved: typeof previous | null; inputHash?: string }> = { sudan: { approved: previous, inputHash: 'stale' } };
    await runSummaries([input], states, settings, Date.parse('2026-10-10T12:00:00Z'), { TEST_KEY: 'k' });
    expect(states.sudan!.approved).toBe(previous);
  });

  it('falls back quietly when the free quota is spent', async () => {
    vi.stubGlobal('fetch', reply('rate limited', 429));
    const states = {};
    const log = await runSummaries([input, { ...input, id: 'yemen' }], states, settings, Date.now(), { TEST_KEY: 'k' });
    expect(log.join('\n')).toMatch(/HTTP 429/);
    expect(log.join('\n')).toMatch(/out of free quota/);
  });

  it('moves to the next provider when a model is retired, without costing the crisis its turn', async () => {
    const fetch = vi.fn(async (url: string) => (url.includes('retired')
      ? new Response('{"error":{"message":"The model does not exist"}}', { status: 404 })
      : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }), { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    const two: SummarySettings = { ...settings, providers: [
      { id: 'old', url: 'https://retired.example/v1/chat/completions', model: 'gone', keyEnv: 'TEST_KEY' },
      { id: 'new', url: 'https://llm.example/v1/chat/completions', model: 'm', keyEnv: 'TEST_KEY', params: { reasoning_effort: 'low' } },
    ] };
    const states: Record<string, SummaryState> = {};
    const log = await runSummaries([input, { ...input, id: 'yemen' }], states, two, Date.now(), { TEST_KEY: 'k' });
    expect(log.join('\n')).toMatch(/old unavailable this run \(HTTP 404/);
    expect(states.sudan!.approved!.model).toBe('new/m');
    expect(states.yemen!.approved!.model).toBe('new/m');
    // The retired model is asked once, not once per crisis; the reasoning effort is sent.
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('retired'))).toHaveLength(1);
    const body = JSON.parse(String((fetch.mock.calls.at(-1) as unknown as [string, { body: string }])[1].body));
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it('waits out a short per-minute limit instead of giving up', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++calls === 1
      ? new Response('rate limited', { status: 429, headers: { 'retry-after': '0.01' } })
      : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }), { status: 200 }))));
    const states: Record<string, SummaryState> = {};
    await runSummaries([input], states, settings, Date.now(), { TEST_KEY: 'k' });
    expect(calls).toBe(2);
    expect(states.sudan!.approved).not.toBeNull();
  });

  it('a failed call does not hold the crisis back for three hours', async () => {
    vi.stubGlobal('fetch', reply('server error', 500));
    const states: Record<string, SummaryState> = {};
    await runSummaries([input], states, settings, Date.now(), { TEST_KEY: 'k' });
    expect(states.sudan?.attemptedAt).toBeUndefined();
  });

  it('never calls a provider whose key is absent', async () => {
    const fetch = reply({});
    vi.stubGlobal('fetch', fetch);
    const log = await runSummaries([input], {}, settings, Date.now(), {});
    expect(fetch).not.toHaveBeenCalled();
    expect(log[0]).toMatch(/no provider key/);
  });

  it('does not show a summary too old to describe now', () => {
    const state = { approved: { en: 'a', nb: 'b', model: 'm', writtenAt: '2026-10-01T00:00:00.000Z', sources: input.headlines } };
    expect(currentSummary(state, 72, Date.parse('2026-10-10T00:00:00Z'))).toBeNull();
  });
});
