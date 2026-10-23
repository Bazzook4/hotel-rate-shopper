/**
 * A hotel's own money.
 *
 * Every hotel sells in one currency (properties.currency, an ISO 4217 code
 * such as "INR", "USD" or "EUR"). It is filled from the hotel's country at
 * sign-up and can be changed in Property Setup. New bookings are taken in
 * it, and every price on screen is written in it: "₹9,000" for a hotel in
 * India, "$180" for one in New York, "€150" for one in Lisbon.
 *
 * A booking keeps the currency it was made in (reservations.currency), so a
 * booking sent by a channel in another currency is still shown as sent.
 *
 * Shared by the server and the browser. In the browser the currency of the
 * hotel being worked on is set once, when the session loads
 * (setHotelCurrency), as the time zone is (lib/hotelTime.js).
 */

/** Every hotel signed up before currencies existed is in India. */
export const DEFAULT_CURRENCY = "INR";

const GROUPS = {
  EUR: "AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM VA XK YT",
  USD: "AS BQ EC FM GU IO MH MP PA PR PW SV TC TL UM US VG VI ZW",
  XOF: "BF BJ CI GW ML NE SN TG",
  XAF: "CF CG CM GA GQ TD",
  XCD: "AG AI DM GD KN LC MS VC",
  XPF: "NC PF WF",
  AUD: "AU CC CX HM KI NF NR TV",
  NZD: "CK NU NZ PN TK",
  GBP: "GB GG GS IM JE",
  DKK: "DK FO GL",
  NOK: "BV NO SJ",
  CHF: "CH LI",
  MAD: "EH MA",
  ANG: "CW SX",
  ILS: "IL PS",
  ZAR: "ZA",
};

const SINGLE =
  "AE:AED AF:AFN AL:ALL AM:AMD AO:AOA AR:ARS AW:AWG AZ:AZN BA:BAM BB:BBD BD:BDT BH:BHD BI:BIF BM:BMD " +
  "BN:BND BO:BOB BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CD:CDF CL:CLP CN:CNY CO:COP CR:CRC " +
  "CU:CUP CV:CVE CZ:CZK DJ:DJF DO:DOP DZ:DZD EG:EGP ER:ERN ET:ETB FJ:FJD FK:FKP GE:GEL GH:GHS GI:GIP " +
  "GM:GMD GN:GNF GT:GTQ GY:GYD HK:HKD HN:HNL HT:HTG HU:HUF ID:IDR IN:INR IQ:IQD IR:IRR IS:ISK JM:JMD " +
  "JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KM:KMF KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LK:LKR " +
  "LR:LRD LS:LSL LY:LYD MD:MDL MG:MGA MK:MKD MM:MMK MN:MNT MO:MOP MR:MRU MU:MUR MV:MVR MW:MWK MX:MXN " +
  "MY:MYR MZ:MZN NA:NAD NG:NGN NI:NIO NP:NPR OM:OMR PE:PEN PG:PGK PH:PHP PK:PKR PL:PLN PY:PYG QA:QAR " +
  "RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SL:SLE SO:SOS SR:SRD " +
  "SS:SSP ST:STN SY:SYP SZ:SZL TH:THB TJ:TJS TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TW:TWD TZ:TZS UA:UAH " +
  "UG:UGX UY:UYU UZ:UZS VE:VES VN:VND VU:VUV WS:WST YE:YER ZM:ZMW";

let byCountry = null;

/** "IN" -> "INR", "PT" -> "EUR". Null for a country not known here. */
export function currencyForCountry(countryCode) {
  if (!byCountry) {
    byCountry = new Map();
    for (const [currency, codes] of Object.entries(GROUPS)) {
      for (const c of codes.split(" ")) byCountry.set(c, currency);
    }
    for (const pair of SINGLE.split(" ")) {
      const [c, currency] = pair.split(":");
      byCountry.set(c, currency);
    }
  }
  return byCountry.get(String(countryCode || "").toUpperCase()) || null;
}

/** True for a three-letter code this machine can format. */
export function isCurrency(code) {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

export function currencyOr(code) {
  return isCurrency(code) ? code : DEFAULT_CURRENCY;
}

/** Indian grouping (1,00,000) for rupees; thousands everywhere else. */
export function moneyLocale(currency) {
  return currencyOr(currency) === "INR" ? "en-IN" : "en-US";
}

const formats = new Map();

function formatter(currency, decimals, min = 0) {
  const key = `${currency}:${decimals}:${min}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(moneyLocale(currency), {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: min,
      maximumFractionDigits: decimals,
    });
    formats.set(key, f);
  }
  return f;
}

/**
 * An amount as the hotel writes it: "₹9,000", "$180.50", "€150".
 * `decimals` is the most shown; whole amounts show none.
 */
export function formatMoney(value, { currency, decimals = 0 } = {}) {
  const code = currencyOr(currency || currentCurrency);
  const n = Number(value) || 0;
  if (decimals === 0) return formatter(code, 0).format(Math.round(n));
  // 180.5 is written 180.50; a whole 180 stays 180.
  return formatter(code, decimals, Number.isInteger(n) ? 0 : decimals).format(n);
}

/** A number in the hotel's grouping without a symbol: "1,00,000" or "100,000". */
export function formatAmount(value, { currency, decimals = 0 } = {}) {
  return (Number(value) || 0).toLocaleString(moneyLocale(currency || currentCurrency), {
    maximumFractionDigits: decimals,
  });
}

/** "₹", "$", "€", or the code itself where there is no short sign ("AED"). */
export function currencySymbol(currency) {
  const code = currencyOr(currency || currentCurrency);
  const part = formatter(code, 0)
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value || code;
}

/** Every currency, by name, for the picker. */
export function currencyOptions() {
  let codes = [];
  try {
    codes = Intl.supportedValuesOf("currency");
  } catch {
    codes = [DEFAULT_CURRENCY, "USD", "EUR", "GBP"];
  }
  let names = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    names = null;
  }
  return codes
    .filter(isCurrency)
    .map((code) => ({ value: code, label: `${names?.of(code) || code} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ------------------------------------------------------------------
// The hotel being worked on, in the browser
// ------------------------------------------------------------------

let currentCurrency = DEFAULT_CURRENCY;

/** Called when the session loads or the hotel is switched. */
export function setHotelCurrency(code) {
  currentCurrency = currencyOr(code);
}

/** The currency of the hotel open in this tab. */
export function hotelCurrency() {
  return currentCurrency;
}
