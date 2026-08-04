/**
 * UCDP names countries ("Myanmar (Burma)"); GDELT emits its own spelling plus a FIPS code.
 * Rather than maintaining a full code table that would silently rot, names are normalised
 * and matched against the names actually observed in the feed. Anything still unmatched is
 * reported, not guessed.
 */
export function normaliseCountryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

const FIPS_CODE = /^[A-Z]{2}$/;

export class CountryResolver {
  private readonly byNormalised = new Map<string, string>();

  constructor(
    observedNamesByFips: Record<string, string>,
    private readonly aliases: Record<string, string> = {},
  ) {
    for (const [fips, name] of Object.entries(observedNamesByFips)) {
      this.byNormalised.set(normaliseCountryName(name), fips);
    }
  }

  /**
   * Exact match after normalisation only. Fuzzy matching is deliberately absent: prefix
   * matching would happily resolve "Niger" to "Nigeria", and a wrong country is worse
   * than an unresolved one.
   *
   * An alias may give a FIPS code directly rather than another name. That matters more than
   * it looks: the observed-name table only contains countries the news feed has actually
   * mentioned, so a register country the feed has never covered — Togo, say — has no name to
   * be aliased to and could never be resolved by name alone.
   */
  resolve(name: string): string | undefined {
    const alias = this.aliases[name];
    if (alias !== undefined && FIPS_CODE.test(alias)) return alias;
    return this.byNormalised.get(normaliseCountryName(alias ?? name));
  }
}
