/**
 * Adds and removes a hotel's own web address on our Vercel project, so
 * nobody has to open Vercel for it. Needs VERCEL_TOKEN and
 * VERCEL_PROJECT_ID (and VERCEL_TEAM_ID when the project belongs to a team).
 * The token can change the project's domains, so it stays in the server's
 * settings and is never sent to a page.
 */

const API = "https://api.vercel.com";
export const NOT_SET_UP = "Own web addresses are not switched on yet. Please contact us.";

const ready = () => Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);

async function call(path, method = "GET", body) {
  const url = new URL(`${API}${path}`);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const project = () => `/v10/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains`;

/** Puts the address on the project. Already being on it is fine. */
export async function addDomain(domain) {
  if (!ready()) return { error: NOT_SET_UP };
  const r = await call(project(), "POST", { name: domain });
  if (r.ok || r.json?.error?.code === "domain_already_in_project") return { ok: true };
  console.error("Vercel add domain failed:", r.status, r.json?.error?.code);
  if (r.json?.error?.code === "domain_taken" || r.status === 409) {
    return { error: "That address is already in use somewhere else. Check it is typed right." };
  }
  return { error: "We could not add that address. Please try again, or contact us." };
}

/** Takes the address off the project. Not being there is fine. */
export async function removeDomain(domain) {
  if (!ready() || !domain) return { ok: true };
  const r = await call(`${project()}/${encodeURIComponent(domain)}`, "DELETE");
  if (!r.ok && r.status !== 404) console.error("Vercel remove domain failed:", r.status);
  return { ok: true };
}

/**
 * Where the address stands: "live" when its record is in place, otherwise
 * "waiting" with the record the hotel must add. www addresses use a CNAME;
 * a bare address uses an A record.
 */
export async function domainStatus(domain) {
  if (!ready()) return { error: NOT_SET_UP };
  const [added, config] = await Promise.all([
    call(`${project()}/${encodeURIComponent(domain)}`),
    call(`/v6/domains/${encodeURIComponent(domain)}/config`),
  ]);
  if (!added.ok) return { state: "missing", records: [] };
  const www = domain.startsWith("www.");
  const records = [];
  if (www || domain.split(".").length > 2) {
    records.push({ type: "CNAME", name: domain.split(".")[0], value: config.json?.recommendedCNAME?.[0]?.value || "cname.vercel-dns.com" });
  } else {
    records.push({ type: "A", name: "@", value: config.json?.recommendedIPv4?.[0]?.value?.[0] || "76.76.21.21" });
  }
  // A domain Vercel could not verify is owned elsewhere; its proof record is added to the list.
  for (const v of added.json?.verification || []) records.push({ type: String(v.type || "TXT").toUpperCase(), name: v.domain, value: v.value });
  const live = added.json?.verified === true && config.ok && config.json?.misconfigured === false;
  return { state: live ? "live" : "waiting", records: live ? [] : records };
}
