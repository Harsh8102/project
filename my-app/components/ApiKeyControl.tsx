"use client";

// A hosted demo runs on one shared Gemini key/quota — this lets a viewer
// swap in their own free key (aistudio.google.com/apikey) so their session
// stops depending on it. Stored only in this browser's localStorage; see
// lib/client/geminiKeyStorage.ts for the storage contract and
// lib/ai/gemini.ts's runWithApiKeyOverride for how a request scopes to it
// server-side (never logged, never persisted server-side).

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
import { getStoredGeminiKey, setStoredGeminiKey, subscribeToGeminiKeyChanges } from "@/lib/client/geminiKeyStorage";

// localStorage is an external system React doesn't know about, and its
// value can differ from what the server rendered (which has no access to
// it at all) — useSyncExternalStore is React's own tool for exactly this
// (a real subscription + a server-safe snapshot), not an effect that would
// setState after mount and risk a lint-flagged cascading render.
function getServerSnapshot() {
  return null;
}

export function ApiKeyControl() {
  const [open, setOpen] = useState(false);
  const storedKey = useSyncExternalStore(subscribeToGeminiKeyChanges, getStoredGeminiKey, getServerSnapshot);
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

  function save() {
    setStoredGeminiKey(draft);
    setOpen(false);
  }

  function clear() {
    setStoredGeminiKey(null);
    setDraft("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            API key
            {hasKey && <Badge className="ml-0.5 h-4 bg-success-soft px-1.5 text-[10px] text-success-foreground">on</Badge>}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use your own Gemini API key</DialogTitle>
          <DialogDescription>
            This demo runs on one shared key — if it&rsquo;s slow or rate-limited, paste your own free key here and
            your session will use it instead. Get one at{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
            . Stored only in this browser, sent only to this app&rsquo;s own server, never logged or saved
            server-side.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gemini-key-input">Gemini API key</Label>
          <Input
            id="gemini-key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {hasKey ? "Using your key for chat and document processing." : "Currently using the demo's shared key."}
          </p>
        </div>

        <DialogFooter>
          {hasKey && (
            <Button variant="ghost" onClick={clear}>
              Remove my key
            </Button>
          )}
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={save} disabled={!draft.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
