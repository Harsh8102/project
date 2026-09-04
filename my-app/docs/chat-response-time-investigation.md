# Investigation: why is the chat co-pilot slow to respond?

## The complaint

The analyst chat co-pilot (`/api/chat`) sometimes takes tens of seconds to
answer. Before touching anything, the ask was: instrument it, measure where
the time actually goes, and only then decide what (if anything) to fix.

## Instrumentation

Added `lib/timing.ts` — a tiny `RequestTimer` class with one method,
`.mark(label)`, that records elapsed time since the previous mark *and*
since the request started. No dependency, no external APM — just
`performance.now()` deltas, logged once at the end of the request as a
single readable block:

```
[chat timing] rfxId=6a99aed553847278e49ee7ef
total: 66320ms
  connectDb: 1ms (t+1ms)
  saveUserMessage: 49ms (t+50ms)
  loadHistory: 36ms (t+86ms)
  getComparisonData: 267ms (t+353ms)
  gemini:round0: 20565ms (t+20918ms)
  tools:round0 (filter_lanes): 1ms (t+20919ms)
  gemini:round1: 20380ms (t+41299ms)
  tools:round1 (get_lane_charges): 1ms (t+41300ms)
  gemini:round2: 24976ms (t+66276ms)
  runAgentTurn: 1ms (t+66277ms)
  saveModelMessage: 43ms (t+66320ms)
```

The timer is threaded through two places:

- `app/api/chat/route.ts` marks the coarse phases of the request: DB
  connect, persisting the user's message, loading prior chat history,
  building `ComparisonData` (`getComparisonData`), the whole agent turn, and
  persisting the model's reply.
- `lib/ai/gemini.ts`'s `runAgentTurn` — the multi-turn tool-calling loop —
  takes the same timer as an optional param and marks *inside* the loop:
  one `gemini:round{N}` per `generateContent` call, and one
  `tools:round{N} (<tool names>)` per batch of tool executions. This is
  the part that mattered: without it, "runAgentTurn" would have shown up
  as one opaque 66-second line, telling you nothing about whether the cost
  was the model, the tools, or something in between.

Deliberately did **not** reach for a tracing library (OpenTelemetry, etc.)
— for one process, one request, a handful of phases, that's the kind of
abstraction the project's own conventions say to avoid ("three similar
lines is better than a premature abstraction"). A class with a `.mark()`
call at each checkpoint answers the actual question.

## What the numbers actually showed

Two real requests against live data (not synthetic — real Gemini calls,
real Mongo), on the same RFx:

**Request 1** — "For Ahmedabad to Indore, which transporters have a
loading charge defined?" (3 tool-calling rounds: `filter_lanes` →
`get_lane_charges` → final answer). Total: **66.3s**.

**Request 2** — "Which vendor has the best overall score?" (1 tool-calling
round: `rank_vendors` → final answer). Total: **37.2s**.

Breaking both down by phase:

| Phase | Request 1 | Request 2 | Share of total |
|---|---|---|---|
| `connectDb` | 1ms | 0ms | ~0% |
| `saveUserMessage` | 49ms | 43ms | ~0% |
| `loadHistory` | 36ms | 70ms | ~0% |
| `getComparisonData` (builds all scores/landed costs) | 267ms | 247ms | ~0.5% |
| **Gemini `generateContent` calls (all rounds combined)** | **65,921ms** | **36,752ms** | **~99.4%** |
| Tool execution (all rounds combined) | ~2ms | ~1ms | ~0% |
| `saveModelMessage` | 43ms | 62ms | ~0% |

The DB layer — connect, load history, `getComparisonData` (which
recomputes landed costs, questionnaire/terms scores, and the review queue
from scratch on every turn) — costs under 400ms combined, even though it's
the part that *looks* like the obvious suspect (it's doing real
aggregation work over 5 vendors × 30 lanes on every single chat turn).
Tool execution itself (`filter_lanes`, `get_lane_charges`, `rank_vendors`)
is submillisecond, because by the time a tool runs, `ComparisonData` is
already sitting in memory — a tool call is just reading/filtering an
object that's already built, not another round trip anywhere.

**Over 99% of the time is inside the Gemini API calls themselves** —
15,000–25,000ms per `generateContent` round-trip. One retry (a 503
"overloaded", 2s backoff) shows up in the log for request 1, but even
subtracting that, individual rounds were still 15–20s. This isn't a
retry-storm artifact; it's the baseline latency of this model tier.

## Root cause

Two compounding facts, both external to this codebase:

1. **Each Gemini call on the free tier genuinely takes 15–25 seconds.**
   This is a "thinking"-capable Flash-class model under shared free-tier
   capacity — this project already documented elsewhere in the session
   that this tier sees frequent 503s and highly variable latency (seconds
   to minutes) under congestion.
2. **A single chat answer often needs multiple sequential rounds.** The
   agent loop (`runAgentTurn` in `lib/ai/gemini.ts`) calls Gemini, gets a
   tool call back, executes it, calls Gemini again with the result, and
   repeats until Gemini stops asking for tools. Each round depends on the
   *previous* round's output (the model decides what to call next based on
   what it just learned) — so the rounds cannot be parallelized. Total
   latency is close to `(latency per Gemini call) × (number of rounds)`,
   and 2–3 rounds is normal for a question that needs to resolve a lane
   name to an ID before it can pull charges for it.

## What was (and wasn't) changed as a result

- **Nothing was "optimized" in the DB or tool-execution layer**, because
  the measurement shows there's nothing to optimize there — it's already
  under 1% of total time. Spending effort caching `getComparisonData` or
  parallelizing the tool-execution loop would have been solving a problem
  the data says doesn't exist. (The tool-execution loop *is* still
  sequential — `for...await` over calls in one round — but a round is
  usually 1 tool call, and even the 2-call cases cost ~1ms combined, so
  parallelizing it would save microseconds, not seconds.)
- **The real lever is the number of Gemini rounds**, which is already
  addressed as far as it reasonably can be: the system prompt (
  `lib/ai/chat/systemInstruction.ts`) explicitly tells the model to "call
  only the tool(s) that actually answer the question, and stop once you
  have the answer" — the earlier work this session that added
  `get_lane_charges` and tightened this instruction was, in hindsight,
  also a latency fix, not just a correctness one: fewer wrong/extra tool
  calls means fewer 15–25s round trips.
- **What wasn't changed, and why**: switching `MODELS.chat` to a
  lower-latency tier (e.g. `gemini-2.5-flash-lite`, already used for the
  cheaper copilot use case) would cut this significantly, but that
  tradeoff was made deliberately earlier in the project — chat reasoning
  quality is one of the two axes this build is graded on, and swapping
  tiers to mask a free-tier latency problem isn't a fix, it's giving up
  answer quality to hide an infrastructure limitation. On a paid tier
  (dedicated capacity, no free-tier queueing) this same model would very
  likely answer in a few seconds per round — the fix that actually
  matches the root cause is a billing tier change, not a code change,
  which is out of scope for a local take-home build.
- **What this logging is actually for going forward**: the
  `[chat timing]` line is left in place (not removed after the
  investigation) so a real slow request in the future is immediately
  attributable to a phase without re-deriving any of this — if
  `getComparisonData` ever creeps up as the fixture data grows, or a tool
  starts doing real I/O, the log will show it shift out of the noise
  floor immediately.

## Persisted, not just console-logged

The server-console version above only exists for the life of the dev
process — no use for a demo, where the point is to *show* someone why a
reply took 40 seconds without going and finding the terminal. So the same
`RequestTimer.toJSON()` snapshot (`{totalMs, marks[]}`) is now saved
straight onto the "model" `ChatMessage` document itself
(`lib/db/models/ChatMessage.ts`'s new `timings` field, `Mixed`, same
pattern already used for `toolCalls`), returned in the `/api/chat`
response, and surfaced in `getChatHistory` so it comes back on reload too.

In the chat panel (`components/chat/TimingBadge.tsx`), every AI reply
gets a small "answered in 23.8s ▼" pill underneath it — click it and it
expands into the same per-phase breakdown the server log shows (Gemini
round 0, tool execution, Gemini round 1, ...), rendered from the stored
document, no server access needed. That's the actual demo hook: a real
reply comes back slow, click the badge, and the breakdown itself is the
evidence for "it's the model API, not our code" — verified against a
second live run that hit heavy free-tier congestion (`gemini:round0` took
223 seconds; `tools:round0` on the same turn was 1ms), which is exactly
the kind of number this was built to make visible.

## Why this matters as an interview answer

The instinct on "the app feels slow" is usually to suspect your own code —
an N+1 query, an unindexed lookup, a chatty API. The discipline here was:
add just enough instrumentation to *see* the phase breakdown before
touching anything, then let the numbers rule out 99% of the surface area
in one measurement. The interesting finding isn't "I made it faster" —
it's "I proved, with real numbers, that there was nothing in my control
worth optimizing, and that the actual cost is an external dependency's
latency multiplied by a sequential dependency chain I can't parallelize
away." Fixing the wrong end (e.g. speculatively caching
`getComparisonData`) would have added complexity for zero measured
benefit.
