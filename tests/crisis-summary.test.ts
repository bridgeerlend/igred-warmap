import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_VERSION, noDashes, checkEnglish, checkNorwegian, checkSummary, currentSummary, normaliseNumbers, runSummaries, type SummarySettings, type SummaryState } from '../src/core/crises/summary.js';

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
  enabled: true, minHoursBetween: 3, minNewSources: 3, rewriteAfterHours: 12, maxAgeHours: 72, maxPerRun: 30, maxWords: 110, timeoutMs: 5000,
  providers: [{ id: 'free', url: 'https://llm.example/v1/chat/completions', model: 'm', keyEnv: 'TEST_KEY' }],
};

const good = {
  en: 'Fighting continues in Darfur. A drone strike on a market in El Obeid killed 12 people. The army says it repelled an attack on Babanusa. The UN warns of famine in Darfur camps.',
  nb: 'Kampene fortsetter i Darfur. Et droneangrep på et marked i El Obeid drepte 12 mennesker. Hæren sier den slo tilbake et angrep på Babanusa. FN advarer om hungersnød i leirene i Darfur.',
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
    expect(result.reason).toMatch(/^nb: numbers differ from the English/);
  });

  it('refuses what the status line already says, ranges, method talk and undated UCDP figures', () => {
    const source = 'UCDP counted 4680 battle-related deaths in 2024.\nRSF drone strike kills 41 near the Ethiopian border\nArmy repels attack on Babanusa; 27 armed incidents\nFighting moves to Kordofan';
    const ok = 'Fighting has shifted to Kordofan. A drone strike killed 41 people near the Ethiopian border. The army says it repelled an attack on Babanusa.';
    const nb = 'Kampene har flyttet seg til Kordofan. Et droneangrep drepte 41 mennesker nær grensen til Etiopia. Hæren sier den slo tilbake et angrep på Babanusa.';
    expect(checkSummary(ok, nb, source, 110, [27, 23])).toEqual({ ok: true });
    expect(checkSummary(`27 armed incidents were reported. ${ok}`, nb, source, 110, [27]).reason).toMatch(/repeats the status line's figure 27/);
    expect(checkSummary(ok.replace('41 people', '40-41 people'), nb, `${source} 40`, 110).reason).toMatch(/range of figures/);
    expect(checkSummary(`${ok} The strike was reported by several outlets.`, nb, source, 110).reason).toMatch(/method/);
    expect(checkSummary(`${ok} UCDP counted 4,680 battle-related deaths.`, nb, source, 110).reason).toMatch(/without its year/);
    expect(checkSummary(`${ok} UCDP counted 4,680 battle-related deaths in 2024.`, `${nb} UCDP registrerte 4 680 kamprelaterte dødsfall i 2024.`, source, 110)).toEqual({ ok: true });
    // A status figure as a count of something else, here the dead, is fine when the sources have it.
    expect(checkSummary(ok.replace('killed 41 people', 'killed 27 people'), nb.replace('41', '27'), `${source}\n27 killed in El Fasher`, 110, [27]).ok).toBe(true);
    expect(checkSummary(`${ok} Incidents rose by 23% this week.`, nb, `${source} 23`, 110, [23]).reason).toMatch(/repeats the status line's figure 23/);
  });

  it('refuses names not in the sources, vague fates, commentary and a neighbouring crisis', () => {
    const source = 'Ambush on contractors linked to Erik Prince in eastern Congo wounds ex-UFC fighter Tim Kennedy\nM23 rebels advance near Goma\nUCDP counted 1158 battle-related deaths in 2024.';
    const base = 'Rebels of the M23 movement advanced near Goma. Contractors linked to Erik Prince were ambushed in eastern Congo, and Tim Kennedy was wounded.';
    expect(checkEnglish(base, source, 110).ok).toBe(true);
    expect(checkEnglish(`${base} Kinshasa responded with air strikes.`, source, 110).reason).toMatch(/the name "Kinshasa" is not in the sources/);
    expect(checkEnglish(base.replace('was wounded', 'was killed or injured'), source, 110).reason).toMatch(/killed or injured/);
    expect(checkEnglish(`${base} This underscores the role of private forces.`, source, 110).reason).toMatch(/commentary/);
    expect(checkEnglish(`${base} The escalation marks a new phase.`, source, 110).reason).toMatch(/commentary/);
    expect(checkEnglish('Fighting continues in Darfur. Clashes were also reported in South Sudan.', 'Fighting in Darfur\nClashes in South Sudan', 110, [], ['South Sudan']).reason)
      .toMatch(/neighbouring crisis/);
    expect(checkNorwegian('Kampene fortsetter. Dette understreker alvoret.', 'Fighting continues. Clashes follow.', 110).reason).toMatch(/commentary/);
  });

  it('holds numbers written as words to the sources, by size', () => {
    const source = 'Drone strike kills 41 near border in Darfur\nTwelve aid workers detained\nThousands flee El Fasher';
    const base = 'Fighting continues in Darfur. Aid deliveries have stopped.';
    const nbBase = 'Kampene fortsetter i Darfur. Nødhjelpen har stanset.';
    expect(checkEnglish(`${base} Dozens were killed near the border.`, source, 110).ok).toBe(true);           // 41 is in the dozens
    expect(checkEnglish(`${base} Twelve aid workers were detained.`, source, 110).ok).toBe(true);
    expect(checkEnglish(`${base} Thousands have fled El Fasher.`, source, 110).ok).toBe(true);
    expect(checkEnglish(`${base} Hundreds were wounded.`, source, 110).reason).toMatch(/"hundreds" is not in the sources/);
    expect(checkEnglish(`${base} Fifteen soldiers died.`, source, 110).reason).toMatch(/"fifteen" is not in the sources/);
    // The Norwegian must say the same numbers, in its own words.
    expect(checkNorwegian(`${nbBase} Tolv hjelpearbeidere ble arrestert.`, `${base} Twelve aid workers were detained.`, 110).ok).toBe(true);
    expect(checkNorwegian(`${nbBase} Dusinvis ble drept.`, `${base} Dozens were killed.`, 110).ok).toBe(true);
    expect(checkNorwegian(`${nbBase} Hundrevis ble drept.`, `${base} Dozens were killed.`, 110).reason).toMatch(/numbers differ/);
  });

  it('shows the English with a note when the Norwegian is refused, rather than poor Norwegian', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      const content = call === 1 ? JSON.stringify({ en: good.en }) : JSON.stringify({ nb: good.nb.replace('12', '14') });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const states: Record<string, SummaryState> = {};
    const log = await runSummaries([input], states, settings, Date.now(), { TEST_KEY: 'k' });
    expect(states.sudan!.approved!.en).toBe(good.en);
    expect(states.sudan!.approved!.nb).toBeNull();
    expect(log.join('\n')).toMatch(/Norwegian refused/);
  });

  it('refuses translated-sounding Norwegian the prompt examples rule out', () => {
    const en = 'Houthis fired missiles at Riyadh airport. The EU condemned the attack.';
    expect(checkNorwegian('Houthiene skjøt missiler mot flyplassen i Riyadh. EU fordømte angrepet.', en, 110).ok).toBe(true);
    expect(checkNorwegian('Houthiene skjøt missiler mot flyplassen i Riyadh. EU kalte det Iran-støttet proxy‑aggressjon.', en, 110).reason).toMatch(/stiff Norwegian/);
    expect(checkNorwegian('Houthiene lanserte missilangrep mot Riyadh. EU fordømte angrepet.', en, 110).reason).toMatch(/stiff Norwegian/);
    expect(checkNorwegian('Houthiene skjøt missiler mot Riyadh. Saudi-Arabia lovet en stor respons.', en, 110).reason).toMatch(/stiff Norwegian/);
  });

  it('takes out every dash, in any language', () => {
    expect(noDashes('Houthis struck Riyadh airport — killing twelve — and closed it.')).toBe('Houthis struck Riyadh airport, killing twelve, and closed it.');
    expect(noDashes('Fighting resumed – again.')).toBe('Fighting resumed, again.');
    expect(noDashes('Deaths in 2022–2023 rose.')).toBe('Deaths in 2022-2023 rose.');
    expect(noDashes('Valget i Sør‑Sudan og Iran–Israel.')).toBe('Valget i Sør-Sudan og Iran-Israel.');
    expect(noDashes('tolv personer ble drept – blant dem en flykaptein – og hundrevis såret.')).toBe('tolv personer ble drept, blant dem en flykaptein, og hundrevis såret.');
  });

  it('checks a name as a whole, and always accepts the common organisations', () => {
    const source = 'Fighting near Goma\nM23 rebels advance';
    const base = 'Rebels of the M23 movement advanced near Goma.';
    expect(checkEnglish(`${base} The African Union called for talks.`, source, 110).ok).toBe(true);
    expect(checkEnglish(`${base} The UN Security Council met.`, source, 110).ok).toBe(true);
    expect(checkEnglish(`${base} The East African Community called for talks.`, source, 110).reason).toMatch(/the name "East African Community"/);
    // A people named from a country in the sources.
    expect(checkEnglish('Gunmen killed Iraqis near Mosul. Fighting continued in Iraq.', 'Gunmen attack near Mosul, Iraq\nFighting in Iraq', 110).ok).toBe(true);
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

  it('rewrites an approved text only after three new sources, or after twelve hours', async () => {
    const fetch = reply({ choices: [{ message: { content: JSON.stringify(good) } }] });
    vi.stubGlobal('fetch', fetch);
    const now = Date.parse('2026-10-10T12:00:00Z');
    const approved = (hoursOld: number) => ({ en: 'old', nb: 'gammel', model: 'x', writtenAt: new Date(now - hoursOld * 3_600_000).toISOString(), sources: input.headlines, promptVersion: PROMPT_VERSION });
    const state = (hoursOld: number): Record<string, SummaryState> => ({ sudan: { approved: approved(hoursOld), promptVersion: PROMPT_VERSION, attemptedAt: new Date(now - hoursOld * 3_600_000).toISOString() } });
    const more = (n: number) => ({ ...input, headlines: [...input.headlines, ...Array.from({ length: n }, (_, i) => ({ title: `Fighting near El Fasher ${i}`, url: `https://example.org/new${i}`, publisher: `New ${i}` }))] });

    let states = state(5);
    await runSummaries([more(2)], states, settings, now, { TEST_KEY: 'k' });
    expect(states.sudan!.approved!.en).toBe('old');
    expect(fetch).not.toHaveBeenCalled();

    states = state(5);
    await runSummaries([more(3)], states, settings, now, { TEST_KEY: 'k' });
    expect(states.sudan!.approved!.en).toBe(good.en);

    states = state(13);
    await runSummaries([input], states, settings, now, { TEST_KEY: 'k' });
    expect(states.sudan!.approved!.en).toBe(good.en);
  });

  it('on a spent quota goes on to the next provider, and logs the whole message with its reset', async () => {
    const message = '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199500, Requested 2400. Please try again in 7m12s."}}';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('groq')
      ? new Response(message, { status: 429, headers: { 'x-ratelimit-reset-tokens': '7m12s' } })
      : url.includes('mistral')
        ? new Response('{"message":"Requests rate limit exceeded: quota"}', { status: 400 })
        : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }), { status: 200 }))));
    const chain: SummarySettings = { ...settings, providers: ['groq', 'mistral', 'gemini'].map((id) => ({ id, url: `https://${id}.example/v1`, model: 'm', keyEnv: 'TEST_KEY' })) };
    const states: Record<string, SummaryState> = {};
    const log = (await runSummaries([input], states, chain, Date.now(), { TEST_KEY: 'k' })).join('\n');
    expect(log).toContain('Please try again in 7m12s.');
    expect(log).toContain('x-ratelimit-reset-tokens: 7m12s');
    expect(log).toMatch(/mistral unavailable this run \(HTTP 400/);
    expect(states.sudan!.approved!.model).toBe('gemini/m');
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
    // The English twice (the limit, then the answer), then the Norwegian.
    expect(calls).toBe(3);
    expect(states.sudan!.approved).not.toBeNull();
  });

  it('asks once more with the reason when a draft is refused', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      call += 1;
      const prompt = JSON.parse(init.body).messages[0].content as string;
      const en = prompt.includes('previous draft was refused') ? good.en : `${good.en} This underscores the danger.`;
      const content = prompt.startsWith('Translate') ? JSON.stringify({ nb: good.nb }) : JSON.stringify({ en });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const states: Record<string, SummaryState> = {};
    await runSummaries([input], states, settings, Date.now(), { TEST_KEY: 'k' });
    expect(call).toBe(3);
    expect(states.sudan!.approved!.en).toBe(good.en);
  });

  it('does not show text written to an older brief once the current one has refused the crisis', () => {
    const old = { en: 'old', nb: 'gammel', model: 'm', writtenAt: new Date().toISOString(), sources: input.headlines, promptVersion: 1 };
    // The current brief has not run yet: the old text stands.
    expect(currentSummary({ approved: old, promptVersion: 1 }, 72, Date.now())).not.toBeNull();
    // The current brief ran and refused: the old text goes, and the status line stands alone.
    expect(currentSummary({ approved: old, promptVersion: PROMPT_VERSION }, 72, Date.now())).toBeNull();
    expect(currentSummary({ approved: { ...old, promptVersion: PROMPT_VERSION }, promptVersion: PROMPT_VERSION }, 72, Date.now())).not.toBeNull();
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
