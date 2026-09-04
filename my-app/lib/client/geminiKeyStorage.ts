"use client";

// A hosted demo shares one Gemini key/quota across every viewer of the link
// — a single evaluator's session (or a shared free-tier outage, see
// .env.local's dated notes on real 429/503s hit during this build) can
// starve everyone else with no way for a viewer to recover on their own.
// This lets a viewer paste their own free Gemini key (aistudio.google.com/
// apikey) so their session stops depending on the shared one at all.
//
// Stored ONLY in this browser's localStorage — never sent anywhere but as a
// per-request header to this app's own API routes (see geminiKeyHeader),
// which use it to scope that one request's Gemini calls and never persist
// or log it (lib/ai/gemini.ts's runWithApiKeyOverride).

const STORAGE_KEY = "kts_gemini_api_key";
// `storage` only fires in OTHER tabs, never the tab that wrote the value —
// this custom event is how ApiKeyControl's useSyncExternalStore hears its
// own write and updates the "on" badge without an effect-driven setState.
const CHANGE_EVENT = "kts-gemini-key-changed";

export function getStoredGeminiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredGeminiKey(key: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (key && key.trim()) {
      localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // private-browsing / storage-disabled — the viewer just falls back to
    // the shared demo key, same as if they'd never opened the dialog
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore — fires on this tab's own writes (custom event) and other tabs' (`storage`). */
export function subscribeToGeminiKeyChanges(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Spread into a fetch's `headers` — empty object when no key is stored, so this is always safe to spread. */
export function geminiKeyHeader(): Record<string, string> {
  const key = getStoredGeminiKey();
  return key ? { "x-gemini-api-key": key } : {};
}
