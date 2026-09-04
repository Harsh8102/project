"use client";

// The analyst chat panel (§8.3/§9 of the functional plan) — docked
// alongside the Comparison UI, not a separate page. History is seeded from
// the DB (lib/db/queries/getChatHistory.ts, loaded server-side) so a reload
// picks up the same conversation; new turns hit /api/chat, which persists
// both sides before returning.

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessageSummary, ToolCallTrace } from "@/lib/db/queries/getChatHistory";
import { ToolResultView } from "./ToolResultView";
import { TimingBadge } from "./TimingBadge";

type LocalMessage = ChatMessageSummary | { id: string; role: "user"; text: string; toolCalls: null; timings: null };

function AiAvatar() {
  return (
    <div className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ai-accent">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
        <path d="M5.5 0.8L6.5 4L9.8 5.5L6.5 7L5.5 10.2L4.5 7L1.2 5.5L4.5 4L5.5 0.8Z" fill="white" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-[9.5px] font-bold text-accent-foreground">
      HG
    </div>
  );
}

// `min-w-0` on both the flex row and the bubble is load-bearing: without it,
// a wide table inside ToolResultView forces the flex item past its intended
// max-width instead of scrolling internally, which was pushing the whole
// panel (and page) into horizontal scroll.
function MessageBubble({ message }: { message: LocalMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex min-w-0 max-w-[94%] items-end gap-2 ${isUser ? "flex-row-reverse self-end" : "self-start"}`}>
      {isUser ? <UserAvatar /> : <AiAvatar />}
      <div
        className={`min-w-0 rounded-lg px-3 py-2 text-sm ${
          isUser ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted text-foreground"
        }`}
      >
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
        {!isUser && message.toolCalls?.map((tc: ToolCallTrace, i: number) => <ToolResultView key={i} trace={tc} />)}
        {!isUser && message.timings && <TimingBadge timings={message.timings} />}
      </div>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  "What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?",
  "Re-rank vendors ignoring questionnaire score entirely.",
  "Which vendors failed a mandatory gate?",
];

export function ChatPanel({
  rfxId,
  initialMessages,
  onHide,
}: {
  rfxId: string;
  initialMessages: ChatMessageSummary[];
  onHide?: () => void;
}) {
  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setInput("");
    setPending(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", text: trimmed, toolCalls: null, timings: null }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfxId, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chat request failed");
      setMessages((prev) => [...prev, { id: data.id, role: "model", text: data.text, toolCalls: data.toolCalls, timings: data.timings ?? null }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "model",
          text: "Something went wrong reaching the analyst agent. Try again.",
          toolCalls: null,
          timings: null,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  const panel = (
    <Card className="flex h-full min-w-0 flex-col gap-0 overflow-hidden p-0!">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-ai-accent-soft/50 px-4.5 py-3.5">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-ai-accent">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.2L9 6L13.8 7.5L9 9L7.5 13.8L6 9L1.2 7.5L6 6L7.5 1.2Z" fill="white" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold">Analyst co-pilot</div>
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-ai-accent-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Grounded to this RFx — every number cited
          </div>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse" : "Expand chat"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ai-accent-foreground hover:bg-black/5"
        >
          {expanded ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M8 5H2M2 5V2M2 5L6 1M5 8H11M11 8V11M11 8L7 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M8 1H12V5M5 12H1V8M12 1L7.5 5.5M1 12L5.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {onHide && (
          <button
            onClick={onHide}
            title="Hide co-pilot"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ai-accent-foreground hover:bg-black/5"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2L11 11M11 2L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-0!">
        <ScrollArea className="min-h-0 min-w-0 flex-1 px-4.5 py-4">
          <div className="flex min-w-0 flex-col gap-3.5 pb-2">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Ask about lanes, costs, gates, or rankings — try:</p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    className="block w-full rounded-md border border-border p-2 text-left text-xs text-muted-foreground hover:bg-muted"
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
          className="flex shrink-0 items-center gap-2 border-t border-border px-4.5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the analyst co-pilot…"
            disabled={pending}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M2 7.5H12M12 7.5L7.5 3M12 7.5L7.5 12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </CardContent>
    </Card>
  );

  if (!expanded) return panel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 md:p-12">
      <div className="h-full w-full max-w-3xl">{panel}</div>
    </div>
  );
}
