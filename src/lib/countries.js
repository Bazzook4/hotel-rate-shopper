/**
 * Countries, stored as ISO 3166 two-letter codes.
 *
 * A code rather than a name, because names arrive spelt every way -- the
 * desk types "USA", one OTA sends "United States", another "US" -- and a
 * report grouping by the raw text would split one market into three. Names
 * for display come from the browser's or server's own Intl data, so there is
 * no list of names here to keep up to date.
 */

const CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
  "BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE " +
  "EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN " +
  "HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC " +
  "LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS " +
  "RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN " +
  "TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

const CODE_SET = new Set(CODES);

let displayNames = null;
function names() {
  if (!displayNames) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = { of: (code) => code };
    }
  }
  return displayNames;
}

/** "IN" -> "India". Unknown codes come back as given. */
export function countryName(code) {
  if (!code) return null;
  try {
    return names().of(code) || code;
  } catch {
    return code;
  }
}

/** Every country, alphabetical by name, for a dropdown. */
export function countryOptions() {
  return CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

/** Spellings a person or a channel is likely to use that are not the name. */
const ALIASES = {
  USA: "US",
  "UNITED STATES OF AMERICA": "US",
  AMERICA: "US",
  UK: "GB",
  "GREAT BRITAIN": "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  UAE: "AE",
  "EMIRATES": "AE",
  RUSSIA: "RU",
  "SOUTH KOREA": "KR",
  KOREA: "KR",
  VIETNAM: "VN",
  HOLLAND: "NL",
  IND: "IN",
  THA: "TH",
  SGP: "SG",
  MYS: "MY",
  ARE: "AE",
  GBR: "GB",
  DEU: "DE",
  FRA: "FR",
  AUS: "AU",
  CHN: "CN",
  JPN: "JP",
  LKA: "LK",
  NPL: "NP",
  BGD: "BD",
  CAN: "CA",
};

let byName = null;

/**
 * Whatever a person or a channel wrote, as a code: "in", "India", "USA",
 * "United Kingdom" all resolve. Returns null for anything unrecognised
 * rather than guessing -- an unknown country is honest, a wrong one is not.
 */
export function toCountryCode(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.length === 2 && CODE_SET.has(upper)) return upper;
  if (ALIASES[upper]) return ALIASES[upper];
  if (!byName) {
    byName = new Map(CODES.map((code) => [countryName(code).toUpperCase(), code]));
  }
  return byName.get(upper) || null;
}
