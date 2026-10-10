/**
 * FIPS 10-4 (what GDELT and the register use) to ISO 3166 numeric (what Natural Earth's
 * world-atlas geometry carries), for every country the map can draw. A country missing here
 * can still be clicked: it opens under its ISO number, with no incidents to show.
 */
export const FIPS_TO_ISO_N = {
  AF: '004', AL: '008', AG: '012', AN: '020', AO: '024', AC: '028', AR: '032', AM: '051', AS: '036', AU: '040',
  AJ: '031', BF: '044', BA: '048', BG: '050', BB: '052', BO: '112', BE: '056', BH: '084', BN: '204', BT: '064',
  BL: '068', BK: '070', BC: '072', BR: '076', BX: '096', BU: '100', UV: '854', BM: '104', BY: '108', CB: '116',
  CM: '120', CA: '124', CV: '132', CT: '140', CD: '148', CI: '152', CH: '156', CO: '170', CN: '174', CF: '178',
  CG: '180', CS: '188', IV: '384', HR: '191', CU: '192', CY: '196', EZ: '203', DA: '208', DJ: '262', DO: '212',
  DR: '214', EC: '218', EG: '818', ES: '222', EK: '226', ER: '232', EN: '233', WZ: '748', ET: '231', FJ: '242',
  FI: '246', FR: '250', GB: '266', GA: '270', GG: '268', GM: '276', GH: '288', GR: '300', GJ: '308', GT: '320',
  GV: '324', PU: '624', GY: '328', HA: '332', HO: '340', HU: '348', IC: '352', IN: '356', ID: '360', IR: '364',
  IZ: '368', EI: '372', IS: '376', IT: '380', JM: '388', JA: '392', JO: '400', KZ: '398', KE: '404', KN: '408',
  KS: '410', KU: '414', KG: '417', LA: '418', LG: '428', LE: '422', LT: '426', LI: '430', LY: '434',
  LS: '438', LH: '440', LU: '442', MA: '450', MI: '454', MY: '458', MV: '462', ML: '466', MT: '470', MR: '478',
  MP: '480', MX: '484', MD: '498', MG: '496', MJ: '499', MO: '504', MZ: '508', WA: '516', NP: '524', NL: '528',
  NZ: '554', NU: '558', NG: '562', NI: '566', MK: '807', NO: '578', MU: '512', PK: '586', PM: '591', PP: '598',
  PA: '600', PE: '604', RP: '608', PL: '616', PO: '620', QA: '634', RO: '642', RS: '643', RW: '646', SA: '682',
  SG: '686', RI: '688', SE: '690', SL: '694', SN: '702', LO: '703', SI: '705', BP: '090', SO: '706', SF: '710',
  OD: '728', SP: '724', CE: '144', SU: '729', NS: '740', SW: '752', SZ: '756', SY: '760', TW: '158', TI: '762',
  TZ: '834', TH: '764', TT: '626', TO: '768', TD: '780', TS: '788', TU: '792', TX: '795', UG: '800', UP: '804',
  AE: '784', UK: '826', US: '840', UY: '858', UZ: '860', NH: '548', VE: '862', VM: '704', YM: '887', ZA: '894',
  ZI: '716', WE: '275', GZ: '275', WI: '732', PS: '585', FM: '583', RM: '584', ST: '662', VC: '670',
  GL: '304', NC: '540', FK: '238', PR: '630', BD: '060', TN: '776', WS: '882', TP: '678', SM: '674',
  MN: '492', KR: '296', NR: '520', HK: '344', MC: '446',
};

/** The reverse, preferring the first FIPS listed for a shared ISO code (Gaza over the West Bank). */
export const ISO_N_TO_FIPS = (() => {
  const out = {};
  for (const [fips, iso] of Object.entries(FIPS_TO_ISO_N)) if (!(iso in out)) out[iso] = fips;
  out['275'] = 'GZ';
  return out;
})();

/** Natural Earth draws a few places with no ISO number; they are matched by name instead. */
export const NAME_TO_FIPS = { Kosovo: 'KV', Somaliland: 'SO', 'N. Cyprus': 'CY' };
