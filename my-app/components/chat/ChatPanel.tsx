"use client";

// The analyst chat panel (§8.3/§9 of the functional plan) — docked
// alongside the Comparison UI, not a separate page. History is seeded from
// the DB (lib/db/queries/getChatHistory.ts, loaded server-side) so a reload
// picks up the same conversation; new turns hit /api/chat, which persists
// both sides before returning.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessageSummary, ToolCallTrace } from "@/lib/db/queries/getChatHistory";
import { ToolResultView } from "./ToolResultView";

type LocalMessage = ChatMessageSummary | { id: string; role: "user"; text: string; toolCalls: null };

function MessageBubble({ message }: { message: LocalMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        {!isUser &&
          message.toolCalls?.map((tc: ToolCallTrace, i: number) => <ToolResultView key={i} trace={tc} />)}
      </div>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  "What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?",
  "Re-rank vendors ignoring questionnaire score entirely.",
  "Which vendors failed a mandatory gate?",
];

export function ChatPanel({ rfxId, initialMessages }: { rfxId: string; initialMessages: ChatMessageSummary[] }) {
  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setInput("");
    setPending(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", text: trimmed, toolCalls: null }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfxId, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chat request failed");
      setMessages((prev) => [...prev, { id: data.id, role: "model", text: data.text, toolCalls: data.toolCalls }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "model", text: "Something went wrong reaching the analyst agent. Try again.", toolCalls: null },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex h-[calc(100vh-4rem)] flex-col">
      <CardHeader>
        <CardTitle className="text-base">Analyst chat</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <ScrollArea className="min-h-0 flex-1 pr-2">
          <div className="flex flex-col gap-3 pb-2">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Ask about lanes, costs, gates, or rankings — try:</p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    className="block w-full rounded-md border p-2 text-left text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => send(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {pending && <p className="text-xs text-muted-foreground">Thinking…</p>}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the analyst agent…"
            disabled={pending}
          />
          <Button type="submit" disabled={pending || !input.trim()}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
