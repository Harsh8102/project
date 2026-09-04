"use client";

// A hosted demo shares one provider key/quota across every viewer of the
// link — a single evaluator's session (or a shared free-tier limit — see
// .env.local's dated notes: Gemini's free tier is a hard 20-requests-PER-DAY
// wall we hit live during testing, Groq's is a gentler 8,000-tokens/minute
// cap that resets every 60s) can starve everyone else with no way for a
// viewer to recover on their own. This lets a viewer paste their own free
// key for whichever provider is actually running the chat/extraction they're
// using (aistudio.google.com/apikey for Gemini, console.groq.com/keys for
// Groq) so their session stops depending on the shared one at all.
//
// Stored ONLY in this browser's localStorage — never sent anywhere but as a
// per-request header to this app's own API routes, which use it to scope
// that one request's calls and never persist or log it (lib/ai/gemini.ts's
// runWithApiKeyOverride, lib/ai/groq.ts's runWithGroqApiKeyOverride).

function makeProviderKeyStorage(storageKey: string, headerName: string) {
  // `storage` only fires in OTHER tabs, never the tab that wrote the value
  // — this custom event is how ApiKeyControl's useSyncExternalStore hears
  // its own write and updates the "on" badge without an effect-driven setState.
  const changeEvent = `kts-key-changed-${storageKey}`;

  function get(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function set(key: string | null): void {
    if (typeof window === "undefined") return;
    try {
      if (key && key.trim()) {
        localStorage.setItem(storageKey, key.trim());
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // private-browsing / storage-disabled — the viewer just falls back to
      // the shared demo key, same as if they'd never opened the dialog
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  /** For useSyncExternalStore — fires on this tab's own writes (custom event) and other tabs' (`storage`). */
  function subscribe(callback: () => void): () => void {
    window.addEventListener(changeEvent, callback);
    window.addEventListener("storage", callback);
    return () => {
      window.removeEventListener(changeEvent, callback);
      window.removeEventListener("storage", callback);
    };
  }

  /** Spread into a fetch's `headers` — empty object when no key is stored, so this is always safe to spread. */
  function header(): Record<string, string> {
    const key = get();
    return key ? { [headerName]: key } : {};
  }

  return { get, set, subscribe, header };
}

export const geminiKey = makeProviderKeyStorage("kts_gemini_api_key", "x-gemini-api-key");
export const groqKey = makeProviderKeyStorage("kts_groq_api_key", "x-groq-api-key");
