// Reference data used by deterministic rules. Each entry records where it comes from.

/** ISO 3166-1 alpha-2 officially assigned codes (ISO 3166 Maintenance Agency list). */
export const ISO_ALPHA2 = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
    'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
    'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' '),
);

/** EU Member States + XI, exactly as enumerated by EuropeanCountryType in the DDS V3 reference. */
export const EUROPEAN_COUNTRY_TYPE = new Set(
  'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK XI'.split(' '),
);

/**
 * Approximate country bounding boxes [minLon, minLat, maxLon, maxLat], padded by ~0.5 degrees.
 * Used only to detect likely latitude/longitude swaps and plots far outside the declared country.
 * Approximate extents from public map data; a plot inside the box is NOT proof it is inside the country.
 */
export const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  CI: [-9.1, 3.9, -2.0, 11.2],
  GH: [-3.8, 4.2, 1.7, 11.7],
  CM: [8.0, 1.2, 16.7, 13.6],
  NG: [2.2, 3.8, 15.2, 14.4],
  TG: [-0.6, 5.6, 2.3, 11.6],
  LR: [-11.9, 3.9, -7.0, 9.0],
  SL: [-13.8, 6.4, -10.0, 10.5],
  GN: [-15.6, 6.7, -7.1, 13.2],
  EC: [-92.5, -5.5, -74.8, 2.0],
  PE: [-81.9, -18.9, -68.2, 0.5],
  BR: [-74.5, -34.3, -28.3, 5.8],
  CO: [-79.5, -4.7, -66.4, 13.0],
  DO: [-72.5, 17.0, -67.8, 20.4],
  ID: [94.5, -11.5, 141.5, 6.5],
  PG: [140.4, -12.2, 160.0, -0.5],
  UG: [29.1, -1.9, 35.5, 4.7],
  MX: [-118.9, 14.0, -86.2, 33.2],
};

/**
 * Supported product scope: cocoa beans only. Annex I of Regulation (EU) 2023/1115 lists HS 1801
 * "Cocoa beans, whole or broken, raw or roasted". The official DDS V3 sample uses hsHeading 1801 with
 * scientificName Theobroma cacao. EUR-Lex could not be retrieved from the build environment; see
 * docs/SOURCES.md. Other cocoa headings (1802–1806) are deliberately out of this prototype's scope.
 */
export const SUPPORTED_PRODUCT = {
  hsHeading: '1801',
  description: 'Cocoa beans, whole or broken, raw or roasted',
  scientificName: 'Theobroma cacao',
  commonName: 'Cocoa',
} as const;

export type ProductCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'other_cocoa_product' | 'not_cocoa'; message: string };

export function checkHsCode(raw: string | null | undefined): ProductCheck {
  const v = (raw ?? '').replace(/[\s.]/g, '');
  if (!v) return { ok: false, reason: 'missing', message: 'HS code is missing.' };
  if (!/^[0-9]{2,10}$/.test(v)) return { ok: false, reason: 'malformed', message: `"${raw}" is not a 2–10 digit HS code.` };
  if (v.startsWith('1801') ) return { ok: true, normalized: v };
  if (/^180[2-6]/.test(v))
    return { ok: false, reason: 'other_cocoa_product', message: `HS ${v} is a cocoa product other than beans. This prototype only supports HS 1801 (cocoa beans).` };
  return { ok: false, reason: 'not_cocoa', message: `HS ${v} is not cocoa beans (HS 1801). LotHold supports one product entry only.` };
}

export const ACTIVITY_TYPES = ['IMPORT', 'EXPORT', 'DOMESTIC'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
