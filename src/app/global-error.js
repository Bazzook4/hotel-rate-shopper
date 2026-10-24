"use client";

import "./globals.css";
import CrashNotice from "./components/CrashNotice";

// Last resort, when even the root layout fails. It replaces the whole page,
// so it brings its own html and body.
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ background: "var(--page)", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
          <CrashNotice error={error} onRetry={reset} />
        </div>
      </body>
    </html>
  );
}
