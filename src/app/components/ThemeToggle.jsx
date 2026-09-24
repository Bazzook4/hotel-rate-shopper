"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";

/**
 * Light is the default; the choice is remembered per browser. The value is
 * applied to <html data-theme> by an inline script in the layout before
 * paint, so there is no flash of the wrong theme on load.
 */
export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const saved =
      document.documentElement.getAttribute("data-theme") || "light";
    setTheme(saved);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing: the choice simply will not persist.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn btn-ghost ${className}`}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
      <span className="text-xs">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
