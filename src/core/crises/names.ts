/** Names the crisis pages print. FIPS 10-4 codes, as GDELT and the register use them. */

export const CATEGORY: Record<'en' | 'nb', Record<string, string>> = {
  en: {
    armed_clash: 'Armed clash', armed_assault: 'Armed assault',
    aerial_strike: 'Aerial or missile strike', mass_violence: 'Mass violence',
    violent_repression: 'Violent repression', violent_unrest: 'Violent unrest',
    siege_blockade: 'Siege or blockade',
  },
  nb: {
    armed_clash: 'Væpnet sammenstøt', armed_assault: 'Væpnet angrep',
    aerial_strike: 'Luft- eller missilangrep', mass_violence: 'Massevold',
    violent_repression: 'Voldelig undertrykking', violent_unrest: 'Voldelige uroligheter',
    siege_blockade: 'Beleiring eller blokade',
  },
};

export const COUNTRY: Record<string, { en: string; nb: string; iso3: string; center: [number, number] }> = {
  UP: { en: 'Ukraine', nb: 'Ukraina', iso3: 'UKR', center: [31.2, 48.4] },
  RS: { en: 'Russia', nb: 'Russland', iso3: 'RUS', center: [37.6, 55.7] },
  IS: { en: 'Israel', nb: 'Israel', iso3: 'ISR', center: [34.9, 31.5] },
  GZ: { en: 'Gaza', nb: 'Gaza', iso3: 'PSE', center: [34.4, 31.4] },
  WE: { en: 'the West Bank', nb: 'Vestbredden', iso3: 'PSE', center: [35.3, 32.0] },
  LE: { en: 'Lebanon', nb: 'Libanon', iso3: 'LBN', center: [35.8, 33.9] },
  IR: { en: 'Iran', nb: 'Iran', iso3: 'IRN', center: [53.7, 32.4] },
  YM: { en: 'Yemen', nb: 'Jemen', iso3: 'YEM', center: [47.6, 15.6] },
  SY: { en: 'Syria', nb: 'Syria', iso3: 'SYR', center: [38.5, 35.0] },
  IZ: { en: 'Iraq', nb: 'Irak', iso3: 'IRQ', center: [43.7, 33.2] },
  SU: { en: 'Sudan', nb: 'Sudan', iso3: 'SDN', center: [30.2, 15.5] },
  OD: { en: 'South Sudan', nb: 'Sør-Sudan', iso3: 'SSD', center: [31.3, 7.0] },
  ET: { en: 'Ethiopia', nb: 'Etiopia', iso3: 'ETH', center: [39.6, 9.1] },
  SO: { en: 'Somalia', nb: 'Somalia', iso3: 'SOM', center: [45.3, 5.2] },
  ML: { en: 'Mali', nb: 'Mali', iso3: 'MLI', center: [-3.9, 17.6] },
  UV: { en: 'Burkina Faso', nb: 'Burkina Faso', iso3: 'BFA', center: [-1.6, 12.2] },
  NG: { en: 'Niger', nb: 'Niger', iso3: 'NER', center: [8.1, 17.6] },
  NI: { en: 'Nigeria', nb: 'Nigeria', iso3: 'NGA', center: [8.7, 9.1] },
  CG: { en: 'DR Congo', nb: 'DR Kongo', iso3: 'COD', center: [21.8, -4.0] },
  RW: { en: 'Rwanda', nb: 'Rwanda', iso3: 'RWA', center: [29.9, -1.9] },
  BY: { en: 'Burundi', nb: 'Burundi', iso3: 'BDI', center: [29.9, -3.4] },
  CM: { en: 'Cameroon', nb: 'Kamerun', iso3: 'CMR', center: [12.4, 7.4] },
  CT: { en: 'the Central African Republic', nb: 'Den sentralafrikanske republikk', iso3: 'CAF', center: [20.9, 6.6] },
  CD: { en: 'Chad', nb: 'Tsjad', iso3: 'TCD', center: [18.7, 15.5] },
  MZ: { en: 'Mozambique', nb: 'Mosambik', iso3: 'MOZ', center: [35.5, -18.7] },
  LY: { en: 'Libya', nb: 'Libya', iso3: 'LBY', center: [17.2, 26.3] },
  BM: { en: 'Myanmar', nb: 'Myanmar', iso3: 'MMR', center: [95.9, 21.9] },
  PK: { en: 'Pakistan', nb: 'Pakistan', iso3: 'PAK', center: [69.3, 30.4] },
  AF: { en: 'Afghanistan', nb: 'Afghanistan', iso3: 'AFG', center: [67.7, 33.9] },
  IN: { en: 'India', nb: 'India', iso3: 'IND', center: [78.9, 22.6] },
  RP: { en: 'the Philippines', nb: 'Filippinene', iso3: 'PHL', center: [122.0, 12.9] },
  TH: { en: 'Thailand', nb: 'Thailand', iso3: 'THA', center: [100.9, 15.9] },
  HA: { en: 'Haiti', nb: 'Haiti', iso3: 'HTI', center: [-72.3, 18.9] },
  MX: { en: 'Mexico', nb: 'Mexico', iso3: 'MEX', center: [-102.5, 23.6] },
  CO: { en: 'Colombia', nb: 'Colombia', iso3: 'COL', center: [-74.3, 4.6] },
  EC: { en: 'Ecuador', nb: 'Ecuador', iso3: 'ECU', center: [-78.2, -1.8] },
  VE: { en: 'Venezuela', nb: 'Venezuela', iso3: 'VEN', center: [-66.6, 6.4] },
  TU: { en: 'Turkey', nb: 'Tyrkia', iso3: 'TUR', center: [35.2, 39.0] },
  KE: { en: 'Kenya', nb: 'Kenya', iso3: 'KEN', center: [37.9, 0.0] },
  ID: { en: 'Indonesia', nb: 'Indonesia', iso3: 'IDN', center: [113.9, -0.8] },
  AJ: { en: 'Azerbaijan', nb: 'Aserbajdsjan', iso3: 'AZE', center: [47.6, 40.1] },
  BR: { en: 'Brazil', nb: 'Brasil', iso3: 'BRA', center: [-51.9, -14.2] },
  UG: { en: 'Uganda', nb: 'Uganda', iso3: 'UGA', center: [32.3, 1.4] },
  FR: { en: 'France', nb: 'Frankrike', iso3: 'FRA', center: [2.2, 46.2] },
  BN: { en: 'Benin', nb: 'Benin', iso3: 'BEN', center: [2.3, 9.3] },
  TO: { en: 'Togo', nb: 'Togo', iso3: 'TGO', center: [0.8, 8.6] },
  GG: { en: 'Georgia', nb: 'Georgia', iso3: 'GEO', center: [43.4, 42.3] },
  BL: { en: 'Bolivia', nb: 'Bolivia', iso3: 'BOL', center: [-63.6, -16.3] },
  HO: { en: 'Honduras', nb: 'Honduras', iso3: 'HND', center: [-86.2, 15.2] },
  BE: { en: 'Belgium', nb: 'Belgia', iso3: 'BEL', center: [4.5, 50.5] },
};

export function countryName(fips: string, lang: 'en' | 'nb'): string {
  return COUNTRY[fips]?.[lang] ?? fips;
}

export function joinNames(names: string[], lang: 'en' | 'nb'): string {
  const and = lang === 'en' ? 'and' : 'og';
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}
