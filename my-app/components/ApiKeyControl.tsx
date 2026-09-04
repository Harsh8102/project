"use client";

// A hosted demo runs on shared provider keys — this lets a viewer swap in
// their own free key(s) so their session stops depending on the shared
// quota. Stored only in this browser's localStorage; see
// lib/client/apiKeyStorage.ts for the storage contract and
// lib/ai/gemini.ts's runWithApiKeyOverride / lib/ai/groq.ts's
// runWithGroqApiKeyOverride for how a request scopes to it server-side
// (never logged, never persisted server-side).
//
// Two independent keys because two different providers are in play: chat
// is provider-selectable (CHAT_PROVIDER env var — Groq by default after a
// real benchmark found it ~10-20x faster with identical tool selection),
// while document processing always runs through Gemini regardless.

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { geminiKey, groqKey } from "@/lib/client/apiKeyStorage";

// localStorage is an external system React doesn't know about, and its
// value can differ from what the server rendered (which has no access to
// it at all) — useSyncExternalStore is React's own tool for exactly this
// (a real subscription + a server-safe snapshot), not an effect that would
// setState after mount and risk a lint-flagged cascading render.
function getServerSnapshot() {
  return null;
}

function ProviderKeyField({
  open,
  store,
  label,
  fieldId,
  placeholder,
  helpUrl,
  helpLabel,
}: {
  open: boolean;
  store: typeof geminiKey;
  label: string;
  fieldId: string;
  placeholder: string;
  helpUrl: string;
  helpLabel: string;
}) {
  const storedKey = useSyncExternalStore(store.subscribe, store.get, getServerSnapshot);
  const hasKey = !!storedKey;

  const [draft, setDraft] = useState(storedKey ?? "");
  // Re-seed the draft from the real stored value each time the dialog
  // opens (adjusted during render, not an effect — same pattern as
  // CostAssumptionSliders' prop sync) so a cancelled edit never lingers
  // into the next open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(storedKey ?? "");
  }

  function clear() {
    store.set(null);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={fieldId}>{label}</Label>
        {hasKey && <Badge className="h-4 bg-success-soft px-1.5 text-[10px] text-success-foreground">using yours</Badge>}
      </div>
      <div className="flex gap-1.5">
        <Input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button variant="outline" size="sm" onClick={() => store.set(draft)} disabled={!draft.trim() || draft === storedKey}>
          Save
        </Button>
        {hasKey && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {hasKey ? "Using your key." : "Using the demo's shared key."} Get one at{" "}
        <a href={helpUrl} target="_blank" rel="noreferrer">
          {helpLabel}
        </a>
        .
      </p>
    </div>
  );
}

export function ApiKeyControl({ chatProvider = "groq" }: { chatProvider?: "groq" | "gemini" }) {
  const [open, setOpen] = useState(false);
  const geminiStoredKey = useSyncExternalStore(geminiKey.subscribe, geminiKey.get, getServerSnapshot);
  const groqStoredKey = useSyncExternalStore(groqKey.subscribe, groqKey.get, getServerSnapshot);
  const anyKeySet = !!geminiStoredKey || !!groqStoredKey;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            API key
            {anyKeySet && <Badge className="ml-0.5 h-4 bg-success-soft px-1.5 text-[10px] text-success-foreground">on</Badge>}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use your own API keys</DialogTitle>
          <DialogDescription>
            This demo runs on shared keys — if either is slow or rate-limited, paste your own free key below and your
            session uses it instead. Stored only in this browser, sent only to this app&rsquo;s own server, never
            logged or saved server-side.
          </DialogDescription>
        </DialogHeader>

        <ProviderKeyField
          open={open}
          store={groqKey}
          label={`Groq API key${chatProvider === "groq" ? " (chat)" : ""}`}
          fieldId="groq-key-input"
          placeholder="gsk_…"
          helpUrl="https://console.groq.com/keys"
          helpLabel="console.groq.com/keys"
        />
        <ProviderKeyField
          open={open}
          store={geminiKey}
          label={`Gemini API key (document processing${chatProvider === "gemini" ? " & chat" : ""})`}
          fieldId="gemini-key-input"
          placeholder="AIza…"
          helpUrl="https://aistudio.google.com/apikey"
          helpLabel="aistudio.google.com/apikey"
        />

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
