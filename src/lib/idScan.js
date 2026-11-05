// Reads the text of a photo ID and picks out the guest's details.
// Browser-safe and plain: no outside service. The text itself comes from
// idScanReader.js (Tesseract running on the desk's own device).

const MRZ_WEIGHTS = [7, 3, 1];

function mrzCheck(value) {
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const n = c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    sum += n * MRZ_WEIGHTS[i % 3];
  }
  return sum % 10;
}

// The strip reads 0 and O, 1 and I, 8 and B alike: fix by what the spot holds.
const toDigits = (s) => s.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/B/g, "8").replace(/S/g, "5").replace(/Z/g, "2");
const toLetters = (s) => s.replace(/0/g, "O").replace(/1/g, "I").replace(/8/g, "B").replace(/5/g, "S").replace(/2/g, "Z");

function isoFromYYMMDD(s, past) {
  if (!/^\d{6}$/.test(s)) return "";
  const now = new Date().getFullYear() % 100;
  let yy = Number(s.slice(0, 2));
  // A birth year ahead of today is last century; an expiry is this one.
  const year = past ? (yy > now ? 1900 + yy : 2000 + yy) : 2000 + yy;
  return `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

/** male, female or other, from the words on a card ("FEMALE", "Sex: M") or a passport strip letter. */
function genderFrom(text) {
  const t = String(text || "");
  if (/\bfemale\b/i.test(t)) return "female";
  if (/\bmale\b/i.test(t)) return "male";
  if (/\btransgender\b/i.test(t)) return "other";
  const m = t.match(/\b(?:sex|gender)\s*[:\-]?\s*([MF])\b/i);
  return m ? (m[1].toUpperCase() === "F" ? "female" : "male") : "";
}

function titleCase(s) {
  return s
    // Specks on a card read as a lone letter at either end of a name.
    .replace(/^(?:[A-Za-z]\s+)+/, "")
    .replace(/(?:\s+[A-Za-z])+$/, "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

// ISO alpha-3 codes seen on passports to the 2-letter codes the app uses.
const ALPHA3 = {
  IND: "IN", USA: "US", GBR: "GB", CAN: "CA", AUS: "AU", NZL: "NZ", DEU: "DE", FRA: "FR", ITA: "IT", ESP: "ES",
  NLD: "NL", CHE: "CH", SWE: "SE", NOR: "NO", DNK: "DK", FIN: "FI", RUS: "RU", CHN: "CN", JPN: "JP", KOR: "KR",
  SGP: "SG", MYS: "MY", THA: "TH", IDN: "ID", PHL: "PH", VNM: "VN", LKA: "LK", NPL: "NP", BTN: "BT", BGD: "BD",
  PAK: "PK", AFG: "AF", ARE: "AE", SAU: "SA", QAT: "QA", KWT: "KW", OMN: "OM", BHR: "BH", ISR: "IL", TUR: "TR",
  ZAF: "ZA", KEN: "KE", NGA: "NG", EGY: "EG", BRA: "BR", ARG: "AR", MEX: "MX", IRL: "IE", PRT: "PT", BEL: "BE",
  AUT: "AT", POL: "PL", CZE: "CZ", GRC: "GR", UKR: "UA", MMR: "MM", MDV: "MV", HKG: "HK", TWN: "TW",
};

/** The two machine lines at the foot of a passport. Check digits make this the surest read. */
export function readPassportStrip(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, "").toUpperCase())
    .filter((l) => l.length >= 28 && /^[A-Z0-9<]+$/.test(l) && l.includes("<"));
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (!a.startsWith("P") || b.length < 28) continue;
    const country = a.slice(2, 5);
    const names = a.slice(5).split("<<");
    const surname = (names[0] || "").replace(/</g, " ").trim();
    const given = (names.slice(1).join(" ") || "").replace(/</g, " ").trim();
    const numRaw = b.slice(0, 9);
    const number = numRaw.replace(/</g, "");
    const checkOk = String(mrzCheck(numRaw)) === toDigits(b[9] || "");
    const nat = b.slice(10, 13);
    const dob = isoFromYYMMDD(toDigits(b.slice(13, 19)), true);
    if (!number) continue;
    return {
      id_type: "passport",
      id_number: number,
      name: titleCase(`${toLetters(given)} ${toLetters(surname)}`),
      date_of_birth: dob,
      gender: { F: "female", M: "male" }[b[20]] || "",
      nationality: ALPHA3[nat] || ALPHA3[country] || "",
      sure: checkOk,
    };
  }
  return null;
}

function dobFrom(text) {
  const m = text.match(/(?:DOB|D\.O\.B|Date of Birth|Birth)[^0-9]{0,12}(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/i) || text.match(/\b(\d{2})[\/\-.](\d{2})[\/\-.]((?:19|20)\d{2})\b/);
  if (!m) return "";
  const [, d, mo, y] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return "";
  return `${y}-${mo}-${d}`;
}

const NOT_A_NAME = /government|india|unique|identification|authority|aadhaar|male|female|dob|birth|year|address|download|licen|driving|union|election|commission|father|husband|signature|valid|issue|class|vehicle|card|permanent|account|number|income|tax|department|photo/i;

/** The name: after a "Name" label, else the line just above the birth date. */
function nameFrom(lines, dobLine) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:[A-Za-z']+\s+)?Name\s*[:\-]?\s*(.*)$/i);
    if (m && !/father|husband|mother/i.test(lines[i])) {
      const same = m[1].replace(/[^A-Za-z .]/g, "").trim();
      if (same.length >= 3) return titleCase(same);
      const next = (lines[i + 1] || "").replace(/[^A-Za-z .]/g, "").trim();
      if (next.length >= 3) return titleCase(next);
    }
  }
  if (dobLine > 0) {
    for (let i = dobLine - 1; i >= Math.max(0, dobLine - 3); i--) {
      const l = lines[i].replace(/[^A-Za-z .]/g, "").trim();
      if (l.length >= 4 && l.split(/\s+/).length >= 2 && !NOT_A_NAME.test(l)) return titleCase(l);
    }
  }
  return "";
}

/** What the text of a photo ID says about its holder. Anything not found stays blank. */
export function readIdText(text) {
  const raw = String(text || "");
  const strip = readPassportStrip(raw);
  if (strip) return strip;

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = lines.join(" ");
  const dobLine = lines.findIndex((l) => /DOB|D\.O\.B|Birth|\b\d{2}[\/\-.]\d{2}[\/\-.](?:19|20)\d{2}\b/i.test(l));
  const base = { name: nameFrom(lines, dobLine), date_of_birth: dobFrom(flat), gender: genderFrom(flat), nationality: "", sure: false };

  // Driving licence: state code, 2 digit RTO, year, 7 digit serial.
  const dl = flat.toUpperCase().match(/\b([A-Z]{2})[\s-]?(\d{2})[\s-]?((?:19|20)\d{2})(\d{7})\b/);
  if (dl && /licen[cs]e|driving|transport/i.test(flat)) {
    return { ...base, id_type: "driving_licence", id_number: `${dl[1]}${dl[2]}${dl[3]}${dl[4]}`, nationality: "IN" };
  }

  // Aadhaar: 12 digits in threes of four, never starting 0 or 1. Not a VID (16 digits).
  const digits = flat.replace(/[Oo]/g, "0");
  const aadhaar = [...digits.matchAll(/(?<!\d)([2-9]\d{3})\s?(\d{4})\s?(\d{4})(?!\d)/g)].find((m) => !/\d{4}\s\d{4}\s\d{4}\s\d{4}/.test(digits.slice(m.index, m.index + 24)));
  if (aadhaar && !/passport|republic of india.*passport/i.test(flat)) {
    return { ...base, id_type: "aadhaar", id_number: `${aadhaar[1]}${aadhaar[2]}${aadhaar[3]}`, nationality: "IN", sure: /aadhaar|uidai|unique identification/i.test(flat) };
  }

  const voter = flat.toUpperCase().match(/\b([A-Z]{3}\d{7})\b/);
  if (voter && /election|elector|voter|epic/i.test(flat)) {
    return { ...base, id_type: "voter_id", id_number: voter[1], nationality: "IN" };
  }

  // A passport photographed without its strip: the number on the page.
  const pp = flat.toUpperCase().match(/\b([A-Z]\d{7})\b/);
  if (pp && /passport/i.test(flat)) return { ...base, id_type: "passport", id_number: pp[1] };

  const pan = flat.toUpperCase().match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  if (pan && /income tax|permanent account/i.test(flat)) return { ...base, id_type: "other", id_number: pan[1], nationality: "IN" };

  return { ...base, id_type: "", id_number: "" };
}
