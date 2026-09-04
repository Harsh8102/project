# Kill the Quote Spreadsheet — Submission Documentation

**An AI-assisted PTL freight RFx comparison tool** — a buyer compares 5 vendors bidding on 30 lanes, using AI to read whatever documents vendors actually send, deterministic code to turn those documents into one comparable landed-cost view, and a grounded analyst co-pilot to interrogate the comparison in plain language.

---

## 1. Objective

Freight procurement teams currently compare vendor quotes by manually re-typing numbers from PDFs, scanned images, and inconsistently-formatted spreadsheets into a master Excel sheet — one row per lane, one column per vendor, computed by hand. This is slow, error-prone, and gets harder exactly when it matters most: when vendors quote the same charge on different bases (a flat fee vs. a per-kg rate vs. a percentage), the "obvious" cheapest number in the sheet is often wrong.

The objective of this build was to replace that spreadsheet with a tool that:

1. **Reads real vendor documents** (PDF, XLSX, scanned images) in whatever format a vendor actually sends, using AI purely for extraction — never for arithmetic.
2. **Normalizes every charge onto a common, comparable basis** deterministically, so "who's cheapest" is a real computed answer, not an eyeballed guess.
3. **Is honest about what it can't safely compute** — a charge that would require inventing a number (an unknown unit count, an unknown invoice value) stays visibly excluded rather than silently guessed, unless a buyer explicitly supplies a real reference value.
4. **Lets a buyer ask questions in plain language** ("which vendors have a loading charge on this lane," "who's cheapest if we split the award by lane") and get an answer that's grounded — every number traceable to a real computation, never invented by the model mid-conversation.
5. **Makes the sensitivity of a decision visible**, not hidden — when the answer to "who's cheapest" depends on an assumption (how heavy is the shipment really, what's a typical box size), the tool shows *that dependency*, not a false sense of certainty.

Throughout the build, one rule governed every design decision: **the AI extracts and converses; deterministic code computes.** Every score, every landed-cost total, every ranking is produced by plain, auditable TypeScript functions. The LLM's job is reading documents and holding a conversation — never arithmetic, never a "best guess" presented as a fact.

---

## 2. Problem Statements Solved

| # | Problem with the spreadsheet-based status quo | How this tool solves it |
|---|---|---|
| 1 | Vendors send quotes in wildly different formats — a photographed rate card, a PDF, an Excel sheet in their own layout, a region-to-region matrix instead of a per-lane table. | AI extraction reads the document as submitted (no vendor-side template compliance required) and turns it into structured data, chunked automatically for large spreadsheets. |
| 2 | Charges are quoted on different bases — flat fee, per-kg, per-unit, a percentage of freight, a percentage of declared invoice value, weight slabs — so raw numbers aren't comparable side by side. | A deterministic normalization engine (`computeLandedCost.ts`) resolves every basis into one ₹ figure for a real reference shipment, applying the same rules to every vendor. |
| 3 | Some charges are genuinely ambiguous without more context — "₹6.6 per box" is meaningless without knowing how many boxes — and spreadsheets typically either ignore this or guess. | These charges are honestly excluded from the total by default (never guessed), and become resolvable only when a buyer supplies a real, visibly-labeled reference value — never a silent assumption. |
| 4 | The "obviously cheapest" vendor in a spreadsheet is sometimes wrong once every charge is properly counted. | Verified concretely during this build: one vendor's landed cost on a real lane looked like ₹18,542 (partial — 2 charges excluded); once its per-unit loading charge was properly resolved, the real total was **₹29,980 — 62% higher**. The tool surfaces this instead of hiding it behind "partial" totals nobody checks. |
| 5 | Buyers without spreadsheet/formula skills can't easily ask ad hoc questions of the data ("who passed the mandatory compliance gates," "what if we split the award"). | A chat co-pilot with 9 deterministic tools answers these questions directly, citing the real computation behind every number. |
| 6 | Procurement decisions often hinge on inputs nobody has exact numbers for yet (average shipment weight, typical box size, declared goods value) — spreadsheets force a single guessed number with no visibility into how much it matters. | A breakeven/sensitivity analysis panel makes this explicit: it shows whether a ranking is robust across the realistic range of an assumption, or exactly where it flips — instead of asserting a false certainty. |
| 7 | Procurement decisions need to be defensible after the fact — "why did we pick this vendor" has to have a real, inspectable answer. | Every landed-cost total, score, and flag traces back to a specific document, a specific extraction, and a specific deterministic formula — nothing is a black-box AI judgment call. |

---

## 3. Landed Cost Calculation — Detailed Logic

### 3.1 The charge taxonomy

Every charge a vendor quotes is mapped onto one of **9 canonical charge types**, each with a plain-language definition and a set of valid pricing bases:

| Canonical charge | What it means | Valid bases |
|---|---|---|
| Freight Charge | Base transportation charge for moving goods along the lane | flat, per_kg, per_unit, slab_on_weight |
| Fuel Surcharge | Variable surcharge tracking fuel price movements | flat, pct_of_freight |
| ODA Charge | Out-of-delivery-area charge for remote destinations | flat, per_kg, per_unit, slab_on_weight |
| Pickup Charge | Charge for collecting goods from the origin | flat, per_unit |
| Loading Charge | Handling/labour charge for loading (and typically unloading) | flat, per_unit |
| State Charge | Inter-/intra-state statutory or entry charges | inter/intra-state flat or per-kg |
| Green Tax | Flat environmental/eco charge for certain states | flat |
| Additional Location Charge | Extra charge for hard-to-reach drop points | flat, per_unit, slab_on_weight |
| FOV / Liability Charge | Freight-on-value / cargo liability, usually a % of invoice value | pct_of_invoice_value, flat |

**Header mapping is two-stage, cheapest first:** a deterministic alias lookup (e.g. "FSC," "fuel adjustment," "diesel surcharge" all map to Fuel Surcharge with 100% confidence, for free) runs first; only what it can't resolve falls back to the AI's own semantic guess from the same extraction call, with that guess's own confidence carried through rather than assumed. Anything neither stage can confidently place is flagged `unmapped_header` and shown with the vendor's raw wording — never silently dropped, never silently guessed.

### 3.2 Resolving a basis into a real ₹ number — step by step

This is the deterministic core of the whole system (`lib/scoring/computeLandedCost.ts`). Worked through on real, verified data — **Vendor A, Ahmedabad → Indore, weight band "1000–2500 kg":**

**Step 0 — establish the reference weight.** The lane's weight band is buyer-declared (required on every lane, not optional). The midpoint is taken as the reference shipment weight: `(1000 + 2500) / 2 = 1750 kg`. This single number feeds every `per_kg` charge on the lane.

**Step 1 — Freight Charge** (`per_kg`, vendor quoted ₹8.93/kg):
`resolved = 8.93 × 1750 = ₹15,627.5`

**Step 2 — Fuel Surcharge** (`pct_of_freight`, vendor quoted 12%) — depends on Step 1's result, not weight directly:
`resolved = (12 / 100) × 15,627.5 = ₹1,875.3`

**Step 3 — Pickup Charge** (`flat`, ₹219) and **Step 4 — State Charge** (`inter_state_flat`, ₹115) — flat charges pass through unchanged, no weight involved.

**Step 5 — Loading Charge** (`per_unit`, ₹6.6/box) — **excluded by default**: there's no reference box-count anywhere in the system unless a buyer supplies one (§3.5). Contributes ₹0 to the default total.

**Step 6 — FOV/Liability Charge** (`pct_of_invoice_value`, 0.3%) — **excluded by default** for the same reason: no reference invoice value unless supplied.

**Step 7 — sum only what resolved:**
`Total = 15,627.5 + 1,875.3 + 219 + 115 = ₹17,836.8`, marked **partial** (2 of 6 charges excluded, with the reason for each preserved and shown).

This exact derivation was checked against the live database and matches the figure the app actually shows — not a constructed example.

A **bundled all-in rate** (one vendor quotes a single number covering everything, no component breakdown) is resolved through the *same* basis logic rather than treated as an already-final total — a bundled rate that's itself quoted per-kg (e.g. "₹10.6/kg, all-in") still needs the same weight resolution as any other per-kg charge. Missing this was a real bug caught and fixed during scoring development, worth ~750x error on one vendor before the fix.

### 3.3 Cost Assumptions — resolving what used to be permanently excluded

The largest late-stage extension to this logic: `per_unit` and `pct_of_invoice_value` charges no longer have to stay excluded forever. A buyer can supply real reference values, and the same deterministic engine resolves them exactly like any other charge — **only when a real value is supplied, never invented.**

**Resolution precedence**, per field, evaluated fresh for every lane:

```
lane-specific override  >  RFx-wide default  >  (weight only) band midpoint  >  unset
```

- **Reference weight** — already had a default (the band midpoint); now also overridable per lane.
- **Avg weight per unit** (kg per box/carton) — no default exists anywhere in the system; stays unset until a buyer sets one.
- **Reference invoice value** — same: no default exists until a buyer sets one.
- **Unit count is *derived*, not independently settable**: `unitCount = referenceWeight ÷ avgWeightPerUnit`. This was a deliberate correction mid-build — giving weight and unit count two *independent* sliders would let a buyer set physically impossible combinations (a 500kg shipment with 5,000 boxes). Deriving one from the other keeps every combination physically consistent.

**A lane override changes only that lane** — setting an assumption while analyzing one lane never silently changes the other 29. This was an explicit design correction: the first design let a slider write straight to an RFx-wide default, which would have meant "explore this one lane" secretly mutated the whole RFx. Every consumer of landed cost (the comparison grid, the vendor scorecard, the rate-competitiveness score, the chat co-pilot) reads from the same underlying computation, so a lane's override is reflected everywhere that lane appears, automatically, with no separate sync step.

**Verified real effect of this feature**: on Ahmedabad → Indore, before any assumption was set, Vendor C's landed cost showed ₹18,542 (partial). After a buyer supplied a real avg-weight-per-unit and invoice value, the same lane fully resolved to **₹29,980** — a dramatically different, and correct, comparison. This is the concrete problem statement #4 (above) solved in practice, not just in theory.

### 3.4 Rate-competitiveness scoring

Unlike questionnaire or terms fields (which have a buyer-set "ideal" target to benchmark against), price has no external target — cheapest is inherently a comparison between whoever actually bid on a lane. This was an explicit, documented product decision: **rate competitiveness is scored *relatively*, not against an absolute benchmark.** Per lane, the cheapest vendor with a usable total scores 100; every other vendor scores `max(0, 100 − % more expensive than cheapest)`. A vendor's overall rate score is the average of its per-lane scores, counted only over lanes where at least one *other* vendor also had a usable total (a lane where a vendor is the sole quoter doesn't trivially score it 100).

### 3.5 Overall vendor score

`Overall = 0.5 × RateCompetitiveness + 0.3 × Questionnaire + 0.2 × Terms` — a documented weighting, adjustable on request through the chat co-pilot's `rank_vendors` tool (which re-normalizes any custom weights automatically), though there's no persistent UI to change the default (see §6). A vendor that fails any mandatory gate question (in either the questionnaire or terms sections) is excluded from ranking entirely, regardless of its numeric scores — a hard rule, not a scored penalty.

---

## 4. Breakeven Analysis — Detailed Logic

### 4.1 The core idea

Every vendor's landed cost on a lane can be expressed as a **linear function of the variables that actually apply to it**:

```
Total(weight, invoiceValue) = fixed + (weightCoefficient × weight) + (invoiceValueCoefficient × invoiceValue)
```

Flat charges contribute to `fixed`. Per-kg charges (and per-unit charges, once `avgWeightPerUnit` is fixed, since unit count is itself weight ÷ that constant) contribute to `weightCoefficient`. Percentage-of-invoice-value charges contribute to `invoiceValueCoefficient`. This formula is built directly from a vendor's already-resolved charge line items — never a separate calculation path that could drift from the real landed cost.

### 4.2 Dominance check — always first, before any algebra

If Vendor A's fixed cost *and* every one of its coefficients are ≤ Vendor B's, A is cheaper-or-equal **for any non-negative weight or invoice value** — no breakeven exists, and no further exploration is needed. This is checked before anything else, because it's the cheapest and most certain conclusion available.

**Real example (Vendor A vs. Vendor C, Ahmedabad → Indore, once assumptions were set):** A's formula had a lower weight-coefficient *and* a lower unit-coefficient than C's, with equal fixed cost — dominance, confirmed. No exploration of "what if weight were different" was needed; A is unconditionally cheaper.

### 4.3 Single-variable breakeven — real algebra, when only one variable differs

If two vendors' formulas differ in exactly one variable's terms (everything else cancels), set the two formulas equal and solve.

**Real example (Vendor A vs. Vendor D, Ahmedabad → Indore, before any per-unit/invoice assumptions were involved):**
- A(weight) = 10.0016 × weight + 334
- D(weight) = 10.6 × weight

Setting equal: `10.0016w + 334 = 10.6w` → **breakeven ≈ 558 kg**. Since the lane's real weight band (1000–2500kg) sits entirely above that breakeven, Vendor A is cheaper throughout the lane's *actual* realistic range — a genuine, checkable conclusion, verified by plugging the lane's real reference weight (1750kg) back into both formulas and confirming they match the app's real displayed totals exactly (₹17,836.8 and ₹18,550).

### 4.4 Multi-variable — no forced single answer

If **two or more** variables differ between two vendors' formulas, and dominance didn't already resolve it, the system does **not** invent a single crossing number — that would be exactly the kind of fabricated precision this project's trust rule forbids. Instead it reports the *direction* each variable pulls the ranking:

**Real example (Vendor D vs. Vendor A, after assumptions were set):** *"No single breakeven point — weight and invoice value pull the ranking in opposite directions. ↑ as weight rises: A pulls ahead. ↑ as invoice value rises: D pulls ahead."* This is computed live from the real formulas each time, not hand-written per scenario — verified by hand-guessing the direction while designing the UI mockup and getting it backwards, then confirming the live engine (driven by real math, not copied text) produced the correct direction automatically.

### 4.5 Same-basis unit economics — a safer, separate comparison

A related but distinct capability: when two vendors quote the *same* charge type per-unit (₹6.6/box vs. ₹129/carton), their rates are directly comparable **without any reference count at all** — the unknown count would multiply through identically on both sides of a ranking and cancel out. This needed no invented assumption and was built as a real, code-computed ranking surfaced directly in the chat co-pilot's charge-breakdown tool.

### 4.6 Why this had to be designed carefully, not just built

An earlier version of this idea proposed letting a buyer pick one arbitrary reference count and multiplying it through — this was caught as a real flaw before being built: if the reference count is arbitrary, the "comparison" it produces is not a real comparison, it's whatever the picked number decides, dressed up as a fact. The system explicitly separates what's *safe to compute without any assumption* (same-basis ranking, dominance checks) from what *genuinely requires a real-world number nobody has yet* (cross-basis bridging), and never blurs the two.

### 4.7 UI realization

Surfaced in the Lane Detail view as an on-demand right-hand drawer — sliders plus the breakeven explanation — rather than permanently inline, so the primary charge-comparison table (the actual thing being decided on) keeps the majority of the screen. Within the drawer, the explanation itself has real typographic hierarchy: the conclusion is the most prominent thing on the panel, a worked numeric example is separated as supporting evidence, and the underlying formulas are tucked into a collapsed disclosure for anyone who wants to verify the algebra — not competing with the headline for attention.

---

## 5. Assumptions Made

| Assumption | Where it applies | Why |
|---|---|---|
| Reference shipment weight = the lane's weight-band midpoint | Every `per_kg` charge, by default | A real shipment on a "500–1000kg" lane could be anywhere in that range; the midpoint is a simple, disclosed proxy for "a typical shipment," not a claim about any specific one. Documented product decision, now overridable per lane. |
| Rate competitiveness is scored *relatively*, not against an absolute benchmark | Rate scoring only | Unlike questionnaire/terms fields, price has no external "ideal" — only a comparison between whoever actually bid. Documented product decision. |
| USD is converted to INR at a fixed rate (₹83) | Any vendor quoting in USD | No live FX feed in scope for this build; a fixed rate is disclosed via a `currency_converted` flag on every affected field, never silent. |
| Avg weight-per-unit and reference invoice value have no historical data to default from | Cost-assumption sliders | Nothing in this system tracks past shipments yet — defaults are arbitrary round numbers, and are *always* visibly labeled "unbacked, adjust if you know better" rather than presented as informed. |
| Extraction confidence below 0.6 is flagged for review | Every extracted field | A deliberately conservative bar — better to over-flag for human review than under-flag a genuinely uncertain read. |
| Only `.xlsx` rate documents are chunked (>10 lanes → batches of 8) | Large rate-sheet extraction | Testing showed the model reliably extracts everything visible in a prompt regardless of "please only look at these rows" instructions unless the input itself is pre-filtered — `.xlsx` rows can be filtered before the call; PDFs/images can't be, without further work (see §6). |
| Header mapping trusts a deterministic alias match completely (confidence 1.0) before ever asking the model | Every charge header | A known, exact synonym should never be second-guessed by a probabilistic read of the same text. |
| A resubmission never overwrites — extraction is append-only, versioned, filtered by `isLatest` | Every extracted field | Preserves a full audit trail; nothing a re-extraction produces can silently erase what an earlier read produced. |

---

## 6. What Was Not Included (and Why)

- **`slab_on_weight` resolution.** The taxonomy and the exclusion logic exist, but the extraction prompt doesn't currently pass a lane's target weight band to the model, so there's no guarantee it would pick the *matching* row out of a genuine multi-band slab table. Trusting it blindly could produce a silently wrong number, which is worse than the current honest exclusion — this needs a coordinated extraction-input fix plus real-document verification, deliberately left out of this pass rather than shipped half-verified.
- **A UI control for RFx-wide default assumptions.** The data model and resolution precedence already support an RFx-wide fallback (a lane override beats it, but it exists as a real second tier) — but the buyer-facing control for setting it was explicitly descoped after review: a global-only interaction would undermine "analyze *this* lane" as the actual goal, and risked one lane's exploration silently changing 29 others'. Per-lane sliders are the only interaction surface in this build; the RFx-wide tier exists in the model for a future, more careful design of that control.
- **Real inbound email ingestion.** Scoped and costed as two real options (a fake-inbox UI reusing the existing upload pipeline, ~half a day; or a real local SMTP listener with MIME parsing, ~1.5–2 days) but not built — out of scope for this demo, which focuses on the comparison/scoring/co-pilot core.
- **Historical-data-informed defaults.** The original design intent (source a default from the median of real historical values when available) has nothing to source from yet — no shipment history exists anywhere in this system. Defaults stay arbitrary-but-labeled rather than falsely informed.
- **Multi-tenant / authentication.** Single-buyer context throughout; no user accounts, roles, or permission boundaries.
- **Automatic provider fallback (Gemini ↔ Claude/Grok on outage).** A real, live 503 outage on Gemini's shared free-tier "lite" model pool was encountered and diagnosed *during this build* (confirmed by hitting the raw API directly, independent of the app, before concluding it wasn't an app bug) — a strong practical case for this exists, and the codebase's provider boundary (only one file touches the Gemini SDK directly) makes it a genuinely contained addition, but it wasn't built in this pass.
- **Contract lifecycle beyond the decision record.** Awarding a vendor is recorded with a frozen snapshot of the scores that justified it; there's no PO generation, vendor notification, or renewal/expiry tracking beyond that point.
- **A persistent UI for adjusting the default scoring weights.** The 50/30/20 weighting is a code constant; it can be overridden per chat request through the co-pilot, but there's no settings screen for a buyer to change the *default* permanently.

---

## 7. Future Expansion

- **AI co-pilot RFQ setup** — configuring a *new* RFx (lane list, questionnaire/terms templates, vendor selection) by conversation instead of a form. Already stubbed as "Coming Soon" on the landing page as the natural next phase, using the same trust-boundary pattern already proven for the comparison co-pilot.
- **Real inbound email ingestion**, per the two scoped options in §6 — most likely the fake-inbox-UI path first, since it reuses the entire existing upload/processing pipeline with no new backend surface.
- **Provider redundancy** — automatic fallback between Gemini, Claude, and/or Grok when one is congested or rate-limited, using the codebase's existing clean provider boundary. Directly motivated by real reliability incidents hit during this build, not a hypothetical concern.
- **Historical-data-informed breakeven defaults** — once shipment history accumulates, replace the arbitrary "unbacked" defaults for avg-weight-per-unit and invoice value with a real median, per the original breakeven-analysis design intent.
- **`slab_on_weight` support**, once the extraction-input fix (passing each lane's weight band into the model's context) is built and verified against genuinely ambiguous real slab-table documents, not just controlled test data.
- **A settings UI for scoring weights and "profiles"** — letting a buyer save more than one weighting scheme (e.g. "cost-sensitive" vs. "compliance-first") and switch between them.
- **Cross-basis breakeven bridging** ("Case B" from the design discussion) — an explicit, sensitivity-aware "what if" view for comparing a per-unit charge against a flat one, using a buyer-supplied real quantity with its own fragility shown ("this conclusion flips below N units"). Deliberately deferred to keep the automatically-graded score's trust boundary untouched by exploratory assumptions.
- **Multi-buyer collaboration** — shared RFx access, comments and @mentions on flagged fields, a real review workflow instead of a single-user session.
- **Contract lifecycle features** — PO generation, vendor notification on award, renewal/expiry tracking.

---

## 8. AI Usage — What Was Done, and Why

### 8.1 Two distinct AI roles, one shared trust boundary

**Extraction** (Gemini, native `responseSchema` structured-output mode): reads a real vendor PDF/XLSX/image and returns JSON matching a strict schema, which is then *re-validated* against a Zod schema before anything touches the database — belt and suspenders, since a schema-conformant response can still be semantically wrong. The model's output is treated as a claim, not a fact, until deterministic code (`normalizeCharge.ts`, `computeLandedCost.ts`) resolves it into a real number. The model never does the arithmetic itself.

**Analyst co-pilot** (Gemini, native function/tool-calling): a multi-turn loop where the model decides *which* of 9 deterministic tools to call — `filter_lanes`, `aggregate_cost`, `filter_vendors_by_gate`, `rank_vendors`, `get_flags`, `compare_vendors`, `simulate_split_award`, `explain_flag`, `get_lane_charges` — each a pure function over an already-computed comparison snapshot. The model synthesizes the final prose, but a hard system-prompt rule requires every numeric claim to trace to a tool call made in that same turn — the model is explicitly forbidden from doing its own arithmetic, inventing a number, or trusting its memory of an earlier turn over a fresh tool call.

### 8.2 Model tiering, and why it exists

Three independently-configurable model slots — extraction, chat, and a lighter "copilot" tier — each swappable via environment variable without a code change, because **model availability and reliability genuinely varied by account and by time of day during this build.** Concretely observed and diagnosed (not assumed):

- Free-tier quota is scoped to the **Google Cloud project**, not the individual API key — confirmed by testing 3 different keys, two of which shared a project and quota.
- `503 "overloaded"` errors are a real, common occurrence on shared free-tier capacity, requiring retry-with-exponential-backoff as a first-class part of the client, not an edge case.
- Enabling billing removed the *daily quota* class of failure, but did **not** remove shared-capacity congestion on a specific model tier — a genuine, live outage on Gemini's "lite" model was hit and correctly diagnosed *during this build* by testing the raw API directly (bypassing the app entirely) before concluding the app itself wasn't at fault, and reverting chat to a more reliable (if slower) model tier as a result.

### 8.3 Chat provider resilience — why a three-tier fallback chain

The co-pilot's provider went through three real, evidence-driven iterations, each triggered by something actually observed in use rather than anticipated in advance.

**First: Gemini alone was too slow for a conversational tool.** Every chat call carried Gemini's own ~24–51s "thinking" latency regardless of the question's complexity (confirmed via direct timing instrumentation, not assumption). A side-by-side benchmark — the same 6 real questions, the same real tools, the same live comparison data, run against both providers — found Groq answering in ~1–3s with identical tool selection to Gemini on every question, and holding both adversarial guardrail tests (a fabrication-bait prompt, a prompt-injection attempt) without even needing a tool call. Chat moved to Groq on that evidence; extraction stayed on Gemini, since a separate benchmark on real document data found Groq materially less accurate at reading dense numeric tables — a failure mode chat's small, non-tabular tool schemas don't share.

**Second: Groq alone hit a real, live compounding-latency failure.** Groq's free tier caps at 8,000 tokens/minute. Under real (not synthetic) usage, one multi-round question needed 3 sequential tool-calling rounds, and each round independently hit the rate limit — the built-in retry logic did what it was supposed to do (wait, retry, succeed), but three stacked waits totaled **102.7 seconds**, worse than Gemini's baseline. The lesson: retrying the same rate-limited provider harder doesn't fix a problem that lives in that provider's own quota, no matter how correct the retry logic is.

**Third: two fallback candidates were evaluated with the same rigor as Groq itself** — the same 6-question benchmark, not a guess:

- **Cerebras** matched Groq exactly on correctness (100%, both guardrail tests held) and matched its best-case speed (~0.5–1.0s) — but its free tier's per-minute request cap turned out to be *tighter* than Groq's, breaking on 4 of 6 rapid-fire questions versus Groq's 2 of 6. Its value isn't "more headroom than Groq" — it's an entirely independent quota pool, so a Groq-specific limit or outage doesn't touch it.
- **OpenRouter** was meaningfully slower per call (~6–18s, a real routing hop on top of whichever backend it dispatches to) but **never hit a single rate limit** across the identical burst that broke both Groq and Cerebras. It runs the paid (non-free-tier) version of the same model tested elsewhere, at a real but negligible cost (a few cents for the full benchmark) — positioned last in the chain deliberately: slow, but it didn't choke under exactly the load that mattered.

**The resulting design**: a three-tier fallback chain, Groq → Cerebras → OpenRouter, sharing one tool-calling implementation (all three speak the same OpenAI-compatible request shape) so the multi-round loop, schema handling, and tool-execution logic exist once, not three times. The key fix for the original 102.7s failure is a *bounded* retry budget per tier — each provider gives up and hands off to the next the moment a wait would exceed a small budget (6s for the first two tiers, 15s for the last-resort tier), instead of exhausting its own retries first. Verified live in production, not just in isolation: a real call hit an actual Groq 429 with a 36.5-second hinted wait; the budget refused to sit through it, and Cerebras restarted the turn from scratch and finished in under a second — the user saw a few seconds of delay instead of the wait that would have resulted from letting Groq retry to completion.

One deliberate simplification: a tier failure restarts the whole turn on the next provider rather than resuming mid-conversation, since splicing partial progress across three providers' slightly different message formats is a real source of subtle bugs, and a redone round is cheap given turns are typically 1–3 rounds long.

### 8.4 Real engineering investigations run during this build

Three separate, evidence-based investigations were carried out and documented in full (see `docs/` in the repository) rather than guessed at:

1. **Response-time investigation** — instrumented every phase of a chat request end-to-end and found that **over 99% of response time is Gemini's own round-trip latency**, not the app's database or tool-execution layer (which measured under 1% of total time, consistently). This ruled out a whole category of "optimize the database" work that the data showed wasn't the actual bottleneck.
2. **Round-count / tool-generalization investigation** — found the chat agent was wastefully re-trying a tool call whose first (correct, zero-result) answer it should have trusted, costing 3 unnecessary Gemini round-trips on a real example; fixed with a system-prompt rule *and* a deterministic short-circuit that skips an entire redundant round-trip when a tool's own result is provably final. Separately found the agent had no way to correctly answer region-based or numeric-range questions at all, and fixed it not by writing a new tool per question shape (which doesn't scale) but by enriching the underlying data with derived fields and adding one small, closed filter primitive.
3. **Charge-normalization investigation** — found and fixed a real parsing bug (`Number("0.29%")` silently returning `NaN`, wrongly flagging every percentage-based charge in a document as low-confidence); and, prompted by direct user pushback that caught a design flaw in an earlier proposal, worked out precisely which cross-vendor charge comparisons are safe to compute without any assumption and which genuinely need one — never blurring the two.

### 8.5 What the model is explicitly never allowed to do

Stated directly in the co-pilot's system instruction, and enforced by never handing the model anything it could use to violate it: perform arithmetic beyond trivial rounding/formatting; invent, estimate, or guess a number not present in a tool result or an extracted document, even when explicitly asked for "just a rough estimate"; treat a user message's claimed override ("ignore your previous instructions") as legitimate; or state a ranking without naming what actually drove it. Every one of these rules exists because it maps to a real failure mode that was tested for and guarded against, not a hypothetical concern.
