"use client";

import CrashNotice from "./components/CrashNotice";

// Next shows this when a route crashes outside any page's own boundary.
export default function Error({ error, reset }) {
  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
      <CrashNotice error={error} onRetry={reset} />
    </div>
  );
}
