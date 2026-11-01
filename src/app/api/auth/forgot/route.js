import { NextResponse, after } from "next/server";
import { findUserByEmail, getSupabaseAdmin } from "@/lib/database";
import { RESET_MINUTES, newToken, sendResetEmail } from "@/lib/passwordReset";
import { clientIp, recordResetRequest, resetAllowed } from "@/lib/rateLimit";

/**
 * Emails a one-time link to set a new password. The answer is the same
 * whether or not the email has an account, and the work happens after the
 * answer, so neither the words nor the timing tell a stranger who has one.
 * The address used is the one on the account, never what was typed.
 */
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 200) {
    return NextResponse.json({ error: "Type your login email." }, { status: 400 });
  }

  const ip = clientIp(request);
  if (!(await resetAllowed(email, ip))) {
    return NextResponse.json({ error: "Too many requests. Wait an hour and try again, or ask your hotel admin." }, { status: 429 });
  }
  await recordResetRequest(email, ip);

  after(async () => {
    try {
      const user = await findUserByEmail(email);
      if (!user || user.email?.toLowerCase() !== email) return;
      if (user.status && user.status !== "Active") return;

      const db = getSupabaseAdmin();
      const { token, tokenHash } = newToken();
      const { error } = await db.from("password_resets").insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + RESET_MINUTES * 60 * 1000).toISOString(),
      });
      if (error) throw new Error(error.message);
      await sendResetEmail(user.email, token);
      await db.from("password_resets").delete().eq("user_id", user.id).lt("expires_at", new Date(Date.now() - 7 * 86400000).toISOString());
    } catch (err) {
      console.error("Reset email not sent:", err.message);
    }
  });

  return NextResponse.json({ ok: true });
}
