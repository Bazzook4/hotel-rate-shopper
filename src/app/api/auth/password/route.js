import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getUserById, setUserPassword } from "@/lib/database";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { clearLoginFailures, clientIp, loginAllowed, recordLoginFailure } from "@/lib/rateLimit";

/**
 * Change the signed-in person's own password. The current one is asked for,
 * so a desk left signed in cannot be taken over, and wrong guesses count
 * towards the same lock-out as signing in.
 */
export async function POST(request) {
  const session = await getSessionFromRequest(request);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const current = body?.current ?? "";
  const next = body?.next ?? "";

  const problem = passwordProblem(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const ip = clientIp(request);
  if (!(await loginAllowed(user.email, ip))) {
    return NextResponse.json(
      { error: "Too many wrong passwords. Wait 15 minutes and try again." },
      { status: 429 }
    );
  }

  if (!verifyPassword(current, user.password_hash || "")) {
    await recordLoginFailure(user.email, ip);
    return NextResponse.json({ error: "Your current password is not right." }, { status: 400 });
  }
  await clearLoginFailures(user.email);

  try {
    await setUserPassword(user.id, hashPassword(next));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Password change failed", err);
    return NextResponse.json({ error: "Password not changed. Please try again." }, { status: 500 });
  }
}
