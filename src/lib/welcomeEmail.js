/**
 * The welcome email a hotel gets after signing up through an onboarding
 * link: its login email, the password it chose, and the login link. The
 * password is included on purpose -- hotels forget what they typed at
 * sign-up, and the email is their reference.
 *
 * Sent through the ops mailbox's own mail server (Google), so a copy sits in
 * its Sent folder. Needs SMTP_USER and SMTP_PASS (an app password), and
 * SMTP_HOST when the mailbox is not on Google. Without them nothing is sent,
 * and sign-up still works.
 */

import nodemailer from "nodemailer";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function sendWelcomeEmail({ to, propertyName, contactName, password, loginUrl }) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.warn("Welcome email not sent: SMTP_USER or SMTP_PASS is not set.");
    return;
  }

  const greeting = contactName ? `Hello ${contactName},` : "Hello,";
  const text = [
    greeting,
    "",
    `Your account for ${propertyName} is ready.`,
    "",
    `Login link: ${loginUrl}`,
    `Login email: ${to}`,
    `Password: ${password}`,
    "",
    "Keep this email safe, and do not forward it.",
    "",
    "OnlineHotelier",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1f;line-height:1.5">
<p>${esc(greeting)}</p>
<p>Your account for <b>${esc(propertyName)}</b> is ready.</p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 12px 4px 0;color:#6b6b75">Login link</td><td style="padding:4px 0"><a href="${esc(loginUrl)}">${esc(loginUrl)}</a></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b6b75">Login email</td><td style="padding:4px 0">${esc(to)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b6b75">Password</td><td style="padding:4px 0">${esc(password)}</td></tr>
</table>
<p><a href="${esc(loginUrl)}" style="display:inline-block;padding:8px 16px;border:1px solid #2b5cd9;border-radius:6px;background:#2b5cd9;color:#fff;text-decoration:none">Log in</a></p>
<p style="color:#6b6b75">Keep this email safe, and do not forward it.</p>
<p>OnlineHotelier</p>
</div>`;

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transport.sendMail({
    from: { name: "OnlineHotelier", address: user },
    to,
    subject: `Your OnlineHotelier login for ${propertyName}`,
    text,
    html,
  });
}
