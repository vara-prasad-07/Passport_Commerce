/* Formatting helpers shared across pages. All money in this project moves in
   MINOR units (paise) — these are the only place that division happens, so a
   display bug can never become a payment bug. */

export function formatMinor(minor, currency = "INR") {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return "—";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const major = minor / 100;
  const hasPaise = Math.round(minor) % 100 !== 0;
  return `${symbol}${major.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact form for tight spaces — no decimals ever. */
export function formatMinorShort(minor, currency = "INR") {
  if (minor === null || minor === undefined) return "—";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${Math.round(minor / 100).toLocaleString("en-IN")}`;
}

/** 24-hour, so log rows stay one line and column-align regardless of locale. */
export function timeOnly(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso ?? "";
  }
}

export function dateTime(iso) {
  try {
    return new Date(iso).toLocaleString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso ?? "";
  }
}

export function relativeTime(iso) {
  try {
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 5) return "just now";
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  } catch {
    return "";
  }
}

/** mm:ss, floored at zero. */
export function countdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function truncateMiddle(str, head = 10, tail = 8) {
  if (!str || str.length <= head + tail + 1) return str ?? "";
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

/** "request_payment" -> "Request payment" */
export function humanize(str) {
  if (!str) return "";
  const s = String(str).replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pretty(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
