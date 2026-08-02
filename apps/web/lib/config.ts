const raw = process.env.NEXT_PUBLIC_ORCH_URL?.trim();

/**
 * The orchestrator's public base URL. Must be an absolute http(s) URL — an
 * empty or relative value would make the app fetch its OWN domain and get HTML
 * back ("Unexpected token '<'"), so we fall back to localhost and warn instead.
 */
export const ORCH_URL =
  raw && /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : "http://localhost:4000";

/** True when we're on a real domain but still pointed at localhost — a misconfig. */
export const ORCH_MISCONFIGURED =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1" &&
  ORCH_URL.includes("localhost");

/**
 * Public contact address. Lives here rather than in the route handler because
 * Next only permits route exports (GET/POST/…) from a route file.
 */
export const CONTACT_EMAIL = "contact@opencommunication.app";
