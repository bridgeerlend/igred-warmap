/**
 * Established Norwegian forms of place names the news stream gives in English, for the
 * status lines in Norwegian. A name without an established Norwegian form is left as it is.
 * Used by the map in the browser and by the crisis build (src/core/crises/build.ts).
 */

/** @type {Record<string, string>} */
export const PLACE_NB = {
  'Blue Nile': 'Blå Nil', 'White Nile': 'Hvite Nil', 'Upper Nile': 'Øvre Nil', Nile: 'Nilen', 'River Nile': 'Nilen',
  'North Kordofan': 'Nord-Kordofan', 'South Kordofan': 'Sør-Kordofan', 'West Kordofan': 'Vest-Kordofan',
  'North Darfur': 'Nord-Darfur', 'South Darfur': 'Sør-Darfur', 'West Darfur': 'Vest-Darfur', 'East Darfur': 'Øst-Darfur', 'Central Darfur': 'Sentral-Darfur',
  'Red Sea': 'Rødehavet', 'Gulf Of Aden': 'Adenbukta', 'Gulf of Aden': 'Adenbukta', 'Gulf Of Oman': 'Omanbukta', 'Gulf of Oman': 'Omanbukta',
  'Persian Gulf': 'Persiabukta', 'Strait Of Hormuz': 'Hormuzstredet', 'Strait of Hormuz': 'Hormuzstredet', 'Black Sea': 'Svartehavet',
  'Sea Of Azov': 'Azovhavet', 'Sea of Azov': 'Azovhavet', 'Mediterranean Sea': 'Middelhavet', 'Lake Chad': 'Tsjadsjøen',
  'Gaza Strip': 'Gazastripen', 'Gaza City': 'Gaza by', 'West Bank': 'Vestbredden', 'Golan Heights': 'Golanhøydene', 'Jordan Valley': 'Jordandalen',
  'Southern Lebanon': 'Sør-Libanon', 'South Lebanon': 'Sør-Libanon', Damascus: 'Damaskus', Tehran: 'Teheran', Sanaa: "Sana'a",
  Balochistan: 'Belutsjistan', 'Khyber Pakhtunkhwa': 'Khyber Pakhtunkhwa', Moscow: 'Moskva', Crimea: 'Krim', Zaporizhzhia: 'Zaporizjzja',
  'North Kivu': 'Nord-Kivu', 'South Kivu': 'Sør-Kivu', 'Mexico City': 'Mexico by', Ndjamena: "N'Djamena", Mekele: 'Mekelle',
  'Democratic Republic Of The Congo': 'DR Kongo', 'Democratic Republic of the Congo': 'DR Kongo', 'Republic Of The Congo': 'Republikken Kongo',
  'Central African Republic': 'Den sentralafrikanske republikk', 'South Sudan': 'Sør-Sudan', 'Ivory Coast': 'Elfenbenskysten',
  'Far North Region': 'Extrême-Nord', 'Northwest Region': 'Nordvest-regionen', 'Southwest Region': 'Sørvest-regionen',
};

/**
 * A place in the language asked for: each comma-separated part in its Norwegian form where one is known.
 * @param {string} name
 * @param {string} lang
 * @returns {string}
 */
export function placeName(name, lang) {
  if (lang !== 'nb') return name;
  return name.split(',').map((/** @type {string} */ part) => { const p = part.trim(); return PLACE_NB[p] ?? p; }).join(', ');
}
