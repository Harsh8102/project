# Investigation: what controls how many Gemini rounds a chat answer takes, and how to keep that number from growing forever

## The complaint

The response-time investigation (`docs/chat-response-time-investigation.md`) established that Gemini's own per-call latency, not this app's code, is the dominant cost of a chat answer. That leaves one thing fully in this app's control: **how many of those calls a single answer needs.** This doc covers a real case where that number blew up (4 rounds for one question) and what turned out to actually fix it — including one fix that looked reasonable but was too narrow, and the general pattern that replaced it.

## Round 1 of the problem: the agent didn't trust its own tool results

Question: *"For Nagpur to Delhi, who is the best transporter?"*

Real trace (from `RequestTimer`, `lib/timing.ts`):

```
round0 → filter_lanes({originCity:"Nagpur", destCity:"Delhi"})       → 0 matched
round1 → filter_lanes({originCity:"Nagpur", destState:"Delhi"})      → 0 matched
round2 → filter_lanes({originState:"Maharashtra", destCity:"Delhi"}) → 0 matched
round3 → final answer (correct: this lane isn't in the RFx)
```

Root cause: the model didn't treat "0 lanes matched" as a trustworthy, final fact — it retried the same tool with reshaped arguments (city vs. state, swapped sides), as if a different phrasing might reveal a match it "missed." Three wasted ~15-25s round-trips for a question that only needed one.

**Fix 1 — a system-prompt rule** (`lib/ai/chat/systemInstruction.ts`): explicitly told the model a zero-match lookup is itself a complete answer, and not to retry the same tool with a different argument shape. Cut this case from 4 rounds to 2. This is a *soft* fix — it changes the model's judgment, but doesn't guarantee it; a future phrasing could still slip past it.

**Fix 2 — a `finalAnswer` short-circuit** (`ToolResult.finalAnswer` in `lib/ai/chat/tools.ts`, consumed in `runAgentTurn`, `lib/ai/gemini.ts`): when a tool's own result is *provably* the complete answer — a fully-specified origin+destination lookup matching zero lanes, with nothing else muddying why — the tool sets `finalAnswer` and the orchestration loop returns that text directly, skipping the next Gemini call entirely. This is a *hard* fix: it removes the model from a decision it has no real information to add to. Cut the same case to 1 round.

The distinction matters: a prompt rule nudges probability; a short-circuit removes the round's *reason to exist*. Prefer the second wherever a tool can actually prove its result is final.

## Round 2 of the problem: a question the tools couldn't express at all

Question: *"Top 2 transporters who quoted the least to go from West to North?"*

`filter_lanes` only ever took literal city/state substrings — "West" and "North" aren't state names, so there was no way to ask this directly. Real trace:

```
round0 → filter_lanes({originState:"Maharashtra"})  → 7 lanes (all of Maharashtra's, unfiltered by destination)
round1 → filter_lanes({destState:"Delhi"})           → 0 lanes
round2 → final answer, correctly concluding no West→North lanes exist
```

The answer was actually *correct* (independently verified: this RFx genuinely has zero West→North lanes), but only by luck of the dataset being small enough to eyeball. The model:
- only ever checked "Maharashtra" as a West-region origin — never queried Gujarat or Goa, the other two West states, at all;
- only literally checked `destState:"Delhi"` — the rest of "no northern destinations" came from it visually scanning the 7-row list from round 0, not a systematic per-state check;
- got the West/North → actual-state mapping entirely from its own general geography knowledge, ungrounded by any tool call. If it had misclassified one state, nothing in the trace would have caught it.

**The tempting-but-wrong fix**: hand-write a `filter_lanes_by_region` tool. This doesn't scale — a real RFx generates arbitrarily many question shapes (region, volume tiers, distance, anything else in the data model), and hand-authoring one tool per shape means the tool count grows with every new *phrasing* a user tries, forever.

**The actual fix — generalize the data and the filter, not the tool count:**

1. **Enrich the data once.** Every lane the tools already return now also carries `originRegion`/`destRegion` (computed once via the existing `REGION_BY_STATE` table in `lib/normalization/regions.ts` — zero new business logic, just surfacing what already existed) and `expectedVolumeKgPerMonth` was already present. The model can now just call `filter_lanes({})` and *read* fully-labeled data instead of reconstructing derived facts from raw fields using its own judgment.
2. **Replace fixed named params with a small, closed filter primitive.** Added `where: [{field, op, value}]` to `filter_lanes` — a bounded set of known fields (`originRegion`, `destRegion`, `expectedVolumeKgPerMonth`, etc.) and known operators (`eq`, `contains`, `gt`, `gte`, `lt`, `lte`). This is *not* arbitrary code or a general query language — the model can't invent a field or write logic — but it composes across combinations nobody specifically wrote a tool for.

Real result after the fix, same question:

```
round0 → filter_lanes({ where: [
            {field:"originRegion", op:"eq", value:"West"},
            {field:"destRegion",   op:"eq", value:"North"}
          ]})  → 0 matches, finalAnswer short-circuit fires
```

**One round.** And now *provably* correct instead of luckily correct — the region field itself encodes the full West/North state membership, so "0 matches" really does mean all 3×6 state combinations were checked, not one representative guess.

## The general principle

Two separate levers, and only one of them scales:

- **Prompt rules** reduce the odds the model does something wasteful. Necessary, but probabilistic — every new phrasing is a fresh roll.
- **Deterministic guarantees** — enriching data with fields worth reasoning about, and making the *filter shape* itself expressive over a bounded field/operator set — remove whole categories of failure at once, and cover future phrasings nobody explicitly tested for.

The tool surface should grow with the **data model's derived attributes** (a new field, computed once), not with every new **question phrasing** a user happens to try. A hand-written `filter_lanes_by_region` tool would have fixed exactly one case; the `where`-clause generalization fixed that case *and* an unrelated numeric-range gap (`expectedVolumeKgPerMonth`) that hadn't even been reported yet, verified live: *"Which vendors quoted for lanes over 30,000 kg per month?"* resolved correctly in one call, composed cleanly with `aggregate_cost` for the second step — something the old fixed-param tool had no way to answer at all.
