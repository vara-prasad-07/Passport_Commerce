import { useCallback, useEffect, useState } from "react";

const ROUTES = [
  "overview",
  "demo",
  "registry",
  "passport",
  "merchant",
  "policy",
  "redteam",
  "audit",
  // Kept so an old bookmark or a link in START.md still lands somewhere
  // sensible rather than silently bouncing to the overview.
  "guardrails",
];
export const DEFAULT_ROUTE = "overview";

function readHash() {
  const raw = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return ROUTES.includes(raw) ? raw : DEFAULT_ROUTE;
}

/**
 * Minimal hash router. A dependency-free router is deliberate here: the app
 * has five static routes and no data loaders, so react-router would add a
 * package and an upgrade surface without changing a single thing the user sees.
 */
export function useHashRoute() {
  const [route, setRoute] = useState(readHash);

  useEffect(() => {
    const onChange = () => {
      setRoute(readHash());
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next) => {
    window.location.hash = `#/${next}`;
  }, []);

  return [route, navigate];
}

const THEME_KEY = "pc-theme";

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* private mode / blocked storage — fall through to the default */
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#08090c" : "#f6f7f9");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* not fatal — the theme just won't persist across reloads */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle];
}

/** Re-renders on an interval; used for live countdowns and relative times. */
export function useTicker(intervalMs = 1000, enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}

/** Eases a number up to `target` — used for headline stats so they land, not blink. */
export function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (typeof target !== "number" || Number.isNaN(target)) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const from = 0;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
