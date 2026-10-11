/**
 * The national electoral calendar, read from Wikipedia's "<year> national electoral calendar"
 * pages, and what each election's own article says: its lead, and from the previous election's
 * infobox the turnout and the winner's margin.
 *
 * A calendar line looks like
 *   * 25 October: [[Elections in Bulgaria|Bulgaria]], [[2026 Bulgarian presidential election|President]]
 * or a date line followed by "** country, election" lines when several fall on one day.
 */
import { fetchJson } from '../util/http.js';

export type ElectionType = 'president' | 'parliament' | 'referendum';

export interface CalendarEntry {
  date: string;
  dateEnd?: string;
  countryName: string;
  article: string;
  label: string;
  types: ElectionType[];
  round?: number;
  line: string;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "President (1st round), Chamber of Deputies and Senate" is a presidential and a parliamentary election. */
export function typesOf(label: string, article: string): ElectionType[] {
  // The calendar's own label says what is voted on ("President (2nd round)"); the article's
  // title ("general election") only when the label does not.
  const fromLabel = officesIn(label);
  return fromLabel.length ? fromLabel : officesIn(article).length ? officesIn(article) : ['parliament'];
}

function officesIn(textIn: string): ElectionType[] {
  const text = textIn.toLowerCase();
  const out = new Set<ElectionType>();
  if (/referend|plebiscite/.test(text)) out.add('referendum');
  if (/president|presidency/.test(text)) out.add('president');
  if (/parliament|legislat|house|senate|chamber|assembly|congress|knesset|duma|national council|riksdag|storting|sejm|diet|majlis|general election|bundestag|cortes|seimas|saeima|riigikogu|folketing|althing|lok sabha|council of states/.test(text)) out.add('parliament');
  return [...out];
}

function stripRefs(text: string): string {
  return text.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '');
}

/** Every entry on one calendar page; dates the page gives only as a month or "TBA" are left out. */
export function parseCalendar(wikitext: string, year: number): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  let month = -1;
  let dateLine: { day: number; endDay?: number; endMonth?: number } | null = null;
  for (const raw of stripRefs(wikitext).split('\n')) {
    const line = raw.trim();
    // A month heading starts that month; any other ("Unknown date", "Indirect elections",
    // where a parliament elects a president) ends the dated, direct elections.
    const heading = /^==\s*([^=]+?)\s*==$/.exec(line);
    if (heading) { month = MONTHS.indexOf(heading[1]!.toLowerCase()); dateLine = null; continue; }
    if (month < 0) continue;
    const top = /^\*(?!\*)\s*(\d{1,2})(?:\s*(?:–|-|and|&)\s*(\d{1,2}))?(?:\s+([A-Za-z]+))?(?:\s*(?:–|-)\s*(\d{1,2})\s+([A-Za-z]+))?\s*:\s*(.*)$/.exec(line);
    const sub = /^\*\*\s*(.*)$/.exec(line);
    let rest: string | null = null;
    if (top) {
      const startMonth = top[3] && MONTHS.includes(top[3].toLowerCase()) ? MONTHS.indexOf(top[3].toLowerCase()) : month;
      dateLine = { day: Number(top[1]) };
      if (top[2]) dateLine.endDay = Number(top[2]);
      if (top[4] && top[5] && MONTHS.includes(top[5].toLowerCase())) { dateLine.endDay = Number(top[4]); dateLine.endMonth = MONTHS.indexOf(top[5].toLowerCase()); }
      (dateLine as { month?: number }).month = startMonth;
      rest = top[6]!.trim() || null;
    } else if (sub && dateLine) {
      rest = sub[1]!;
    }
    if (!rest || !dateLine) continue;
    const links = [...rest.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((m) => ({ target: m[1]!.trim(), text: (m[2] ?? m[1]!).trim() }));
    const flag = /\{\{\s*flag(?:country|icon)?\s*\|\s*([^}|]+)/i.exec(rest);
    let country = links[0] && /^Elections in /i.test(links[0].target) ? links[0].text : flag?.[1]?.trim() ?? links[0]?.text;
    const election = links.find((l) => !/^Elections in /i.test(l.target) && /election|referendum|plebiscite/i.test(l.target));
    if (!country || !election) continue;
    country = country.replace(/^the /i, '');
    const m0 = (dateLine as { month?: number }).month ?? month;
    const round = /\b(1st|first)\s+round/i.test(election.text) ? 1 : /\b(2nd|second)\s+round/i.test(election.text) ? 2 : undefined;
    out.push({
      date: iso(year, m0, dateLine.day),
      ...(dateLine.endDay ? { dateEnd: iso(year, dateLine.endMonth ?? m0, dateLine.endDay) } : {}),
      countryName: country,
      article: election.target,
      label: election.text,
      types: typesOf(election.text, election.target),
      ...(round ? { round } : {}),
      line: rest.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/'''?/g, '').trim(),
    });
  }
  return out;
}

const API = 'https://en.wikipedia.org/w/api.php';

export async function wikitext(title: string): Promise<string | null> {
  try {
    const data = await fetchJson<{ parse?: { wikitext?: string } }>(
      `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`, { retries: 2, timeoutMs: 30_000 },
    );
    return data.parse?.wikitext ?? null;
  } catch {
    return null;
  }
}

/** The article's lead as plain text, from the REST summary. */
export async function lead(title: string): Promise<string | null> {
  try {
    const data = await fetchJson<{ extract?: string }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { retries: 2, timeoutMs: 30_000 });
    return data.extract?.trim() || null;
  } catch {
    return null;
  }
}

/** One parameter of the first infobox, as plain text. */
export function infoboxParam(text: string, name: string): string | null {
  const m = new RegExp(`\\n[ \\t]*\\|[ \\t]*${name}[ \\t]*=[ \\t]*([^\\n]*)`, 'i').exec(stripRefs(text));
  if (!m) return null;
  return m[1]!.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').replace(/\{\{[^{}]*\}\}/g, '').replace(/<[^>]+>/g, '').trim() || null;
}

export interface PreviousElection { article: string; year: number | null; turnout: number | null; margin: number | null }

/**
 * The election before this one, from the infobox's previous_election: its turnout, and the
 * margin between the first two by share of the vote. Either may be missing; a referendum has
 * no margin in this sense and is not asked.
 */
export function previousFrom(text: string): string | null {
  // Written as a link or as plain text: "[[2022 Kenyan general election|2022]]" or "2022 Kenyan general election".
  const m = /\n\s*\|\s*previous_election\s*=\s*(?:\[\[)?([^\]|\n<{]+)/i.exec(stripRefs(text));
  const title = m?.[1]?.trim();
  return title && /election|referendum/i.test(title) ? title : null;
}

export function closeness(text: string): { turnout: number | null; margin: number | null } {
  const num = (v: string | null) => {
    const m = v ? /(\d{1,3}(?:\.\d+)?)\s*%?/.exec(v.replace(/,/g, '')) : null;
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  };
  const turnout = num(infoboxParam(text, 'turnout'));
  const p1 = num(infoboxParam(text, 'percentage1'));
  const p2 = num(infoboxParam(text, 'percentage2'));
  return { turnout, margin: p1 !== null && p2 !== null && p1 >= p2 ? Math.round((p1 - p2) * 10) / 10 : null };
}
