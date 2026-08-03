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
   */
  resolve(name: string): string | undefined {
    return this.byNormalised.get(normaliseCountryName(this.aliases[name] ?? name));
  }
}
