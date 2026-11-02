import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserById, setUserPassword } from "@/lib/database";
import { hashPassword, passwordProblem } from "@/lib/password";
import { hashToken } from "@/lib/passwordReset";
import { clearLoginFailures } from "@/lib/rateLimit";

/**
 * Sets a new password from an emailed link. The link is claimed in one
 * update, so it works once even if sent twice at the same moment.
 * setUserPassword ends every other link that person has open.
 */
const BAD_LINK = "This link has expired or was already used. Ask for a new one.";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: BAD_LINK, badLink: true }, { status: 400 });

  const problem = passwordProblem(body?.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: claimed, error } = await db
    .from("password_resets")
    .update({ used_at: now })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id");
  if (error) {
    console.error("Reset link check failed:", error.message);
    return NextResponse.json({ error: "Password not changed. Please try again." }, { status: 500 });
  }
  const userId = claimed?.[0]?.user_id;
  if (!userId) return NextResponse.json({ error: BAD_LINK, badLink: true }, { status: 400 });

  try {
    const user = await getUserById(userId);
    await setUserPassword(userId, hashPassword(body.password));
    if (user?.email) await clearLoginFailures(user.email.trim().toLowerCase());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Password reset failed:", err.message);
    return NextResponse.json({ error: "Password not changed. Ask for a new link and try again.", badLink: true }, { status: 500 });
  }
}
