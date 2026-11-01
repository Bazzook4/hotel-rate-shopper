import { createHash, randomBytes } from "crypto";
import { esc, sendAppMail } from "@/lib/welcomeEmail";

/**
 * Forgot password (migration 071). The email carries a one-time link; only
 * its hash is stored, so the table gives nobody a working link.
 *
 * The link's address is fixed rather than read from the request: a forged
 * Host header must not be able to send a real person's secret to another site.
 */

const BASE_URL = process.env.APP_URL || "https://hms.onlinehotelier.com";
export const RESET_MINUTES = 60;

export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export async function sendResetEmail(to, token) {
  const link = `${BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const text = [
    "Hello,",
    "",
    "Use this link to set a new password for your OnlineHotelier login:",
    link,
    "",
    `Login email: ${to}`,
    `The link works once and lasts ${RESET_MINUTES} minutes.`,
    "",
    "If you did not ask for this, ignore this email. Your password stays the same.",
    "",
    "OnlineHotelier",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1f;line-height:1.5">
<p>Hello,</p>
<p>Use this button to set a new password for your OnlineHotelier login.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:8px 16px;border:1px solid #2b5cd9;border-radius:6px;background:#2b5cd9;color:#fff;text-decoration:none">Set a new password</a></p>
<p>Login email: ${esc(to)}<br>The link works once and lasts ${RESET_MINUTES} minutes.</p>
<p style="color:#6b6b75">If you did not ask for this, ignore this email. Your password stays the same.</p>
<p>OnlineHotelier</p>
</div>`;
  return sendAppMail({ to, subject: "Set a new OnlineHotelier password", text, html });
}
