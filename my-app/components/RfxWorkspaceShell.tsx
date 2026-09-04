"use client";

// The fixed-viewport app shell for the RFx workspace: no browser-level
// scroll — everything below the top bar fills the remaining height, and
// each region (tabs content, chat) manages its own internal scrolling.
// Also owns the analyst co-pilot's show/hide toggle, since that changes
// how much width the comparison tabs get.
//
// Takes the already-rendered comparison tabs as `children` rather than
// importing ComparisonTabs directly — this is a client component, and
// ComparisonTabs (a server component) transitively imports the Mongoose
// model files; importing it here would pull `mongoose` into the browser
// bundle. Rendering it as a children prop keeps it server-rendered while
// still nesting inside this component's client-side layout/interactivity.

import { useState, type ReactNode } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import type { ChatMessageSummary } from "@/lib/db/queries/getChatHistory";

export function RfxWorkspaceShell({
  rfxId,
  chatHistory,
  children,
}: {
  rfxId: string;
  chatHistory: ChatMessageSummary[];
  children: ReactNode;
}) {
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div className={`grid min-h-0 flex-1 gap-5 p-6 md:p-8 ${chatOpen ? "md:grid-cols-[1fr_380px]" : "grid-cols-1"}`}>
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>

      {/* Always mounted, just hidden via CSS when closed — unmounting this
          (the old ternary) discarded ChatPanel's local message state on
          every hide, so reopening it lost the conversation even though it
          was still sitting in the database untouched. */}
      <div className={`min-h-0 ${chatOpen ? "hidden md:block" : "hidden"}`}>
        <ChatPanel rfxId={rfxId} initialMessages={chatHistory} onHide={() => setChatOpen(false)} />
      </div>

      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed right-6 bottom-6 z-20 flex items-center gap-2 rounded-full bg-ai-accent px-4 py-3 text-[13px] font-bold text-white shadow-lg shadow-ai-accent/40"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.2L9 6L13.8 7.5L9 9L7.5 13.8L6 9L1.2 7.5L6 6L7.5 1.2Z" fill="white" />
          </svg>
          Show co-pilot
        </button>
      )}
    </div>
  );
}
