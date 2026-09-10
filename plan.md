# Kill the Quote Spreadsheet — Implementation Plan

**Category:** PTL (Part Truck Load) domestic freight lanes
**Stack:** Next.js (TypeScript, App Router) + Gemini API + MongoDB
**Source:** Aerchain PM take-home brief, "Kill the Quote Spreadsheet"

---

## 0. What this is actually graded on

The brief states its rubric explicitly (page 2) — everything below is built to answer these, not to look busy:

| Rubric axis (brief's words) | What the plan does about it |
| --- | --- |
| **The ugly edges** — angled photo, 27/30 lines quoted, USD quote, "per box" ≠ "per 100 pieces," and *what the system shows the buyer when it isn't sure* | §5 edge-case matrix is built directly from the brief's own examples (not generic ones) — every row ends in a visible flag state, never a silent guess |
| **Trust** — "would a buyer with ₹4 crore on the line act on what's on your screen?" | §7 is a dedicated section: every number is clickable to its source, nothing is silently computed by the LLM, every award action leaves an audit trail |
| **Judgment and taste** — "a thousand decisions have no correct answer... we want to see how you made them" | §2 keeps the reasoning column; every non-obvious call in this doc has a *why* next to it |

Two more axes came from the person actually being graded, not the brief — hold the whole plan to these too:

- **Does extraction visibly reduce decision time?** Not just "extraction happened" — the UI has to show the *time-saved story* (fields auto-populated vs. manually retyped, docs processed, review time vs. the brief's "three days gone" baseline). See §8.4.
- **Does the chat agent drive a decision, not just answer trivia?** The brief's own worked example — *"what if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?"* — is the single most important capability in this build. It gets a first-class tool, not a hope that general-purpose querying stumbles onto it. See §9.

---

## 1. Personas

- **Buyer (primary)** — category/procurement manager. Runs the RFx co-pilot, reviews the comparison, drives the analyst chat, makes the award.
- **VP (referenced, not a separate login)** — the source of the brief's split-award question. Used to justify why `simulate_split_award` (§9) exists as a named tool rather than an implicit hope, and as one of the scripted questions for the recorded walkthrough (§14).

No multi-user auth, no approval workflow — out of scope. Single buyer session is enough to demonstrate the flow end to end, which is what's being evaluated.

---

## 2. Scoping decisions (and why)

| Decision | Reasoning |
| --- | --- |
| PTL only, no FTL | FTL is point-to-point, single rate, few edge cases. PTL has multiple charge components with different bases (flat / % / per-unit / slab) — this is where real extraction and normalization complexity lives. |
| Questionnaire & terms accepted as `.xlsx` only; rates accepted in any format | The brief's own edge-case examples (angled photo, PDF footnote, prose in a Word doc, USD quote) are all about **rate quotes**, not questionnaires. Concentrating format-diversity effort where the brief points is intentional scope discipline. One vendor deliberately breaks the terms-format rule to prove the system *detects and flags* a wrong-format submission rather than silently failing or silently parsing it anyway. |
| Currency handling is **in scope**, not dropped | Earlier draft of this plan dropped FX as "not applicable — domestic INR only." That was wrong: the brief explicitly names *"the one who quoted in USD"* as a target edge case. One vendor now quotes rates in USD (plausible for an international 3PL bidding on Indian lanes). Conversion uses a fixed, hardcoded FX rate applied in deterministic code (never by the LLM), and every converted value is flagged — *"converted from USD at ₹X/$, confirm"* — so it never silently blends into INR totals unlabeled. |
| Unit-basis ambiguity is a first-class edge case | The brief's other named example — *"the one whose 'per box' is someone else's 'per 100 pieces'"* — becomes: one vendor defines "per box" as a 20-unit carton, another as a single unit, for what's nominally the same charge header. The system must not silently equate them (§5, edge case 6). |
| Vendor "distribution" = direct upload UI, not simulated email | Interprets "stub the plumbing" literally — the buyer uploads documents on behalf of each vendor, as if received over whatever channel. No SMTP, no inbox simulation needed. Framed in the UI as "documents received via RFx portal" so the demo narrative stays coherent without building a fake mail path. |
| RFx co-pilot kept minimal but genuinely conversational | Confirms lanes, questionnaire template, and terms via a real Gemini conversation loop — not a scripted wizard with canned responses. The brief's hard rule — *"the AI loops must be real"* — applies here too, so this can't be a form with LLM-flavored copy on it. Intentionally low-investment relative to extraction/reasoning/trust, which is what's actually being evaluated, but the loop itself is not faked. |
| Exports and charts are in scope | The brief explicitly lists *"text answers, tables, charts, exports"* as expected chat output modes. Comparison grid gets CSV export; chat agent can return structured table/chart payloads the frontend renders (not just prose) (§8.3, §9). |
| Award decisions are logged, not just clicked | The brief frames the end state as *"a defensible award decision."* An award action without a retained record of what data justified it isn't defensible — it's just a click. See `DecisionRecord` in §3 and §7. |

---

## 3. Data model — MongoDB (Mongoose)

Document-shaped storage fits this problem better than a relational one: the rate/charge schema is inherently variable per vendor (bundled vs. itemized, different charge headers, nested slab tables), and MongoDB Atlas has a genuinely free tier. Mongoose gives typed schemas and query builders; the analyst-chat tool functions (§9) are written as typed aggregation pipelines, never raw string queries — same "no LLM writes queries" reliability property a relational choice would have given, without fighting the data shape.

### 3.1 Collections

- **`rfx`** — `_id, title, status, createdAt, laneListId, questionnaireTemplateId, termsTemplateId`
- **`lanes`** — `_id, originCity, originState, destCity, destState, expectedVolume, weightBand, rfxId`
- **`vendors`** — `_id, name`
- **`vendorSubmissions`** — `_id, vendorId, rfxId, section (rates | questionnaire | terms), blobUrl, fileType, submittedAt, status (uploaded | processing | needs_review | done), chunksTotal, chunksDone`
  — the `status`/`chunks*` fields exist because extraction is chunked, not one call per document (§6.1)
- **`extractedFields`** — `_id, submissionId, fieldKey, laneRef (nullable), rawValue, normalizedValue, unit, basis, confidence (0–1), sourceSnippet (page/cell/quote), flagType (nullable), flagNote, extractedAt, version`
  — `version` + append-only writes: re-extraction never overwrites a prior value in place (§7)
- **`decisionRecords`** — `_id, rfxId, laneId (nullable = whole-RFx award), vendorId, awardedBy, awardedAt, justificationSnapshot` — `justificationSnapshot` is a frozen copy of the scores/flags that were on screen at award time, so the record stays defensible even if data changes later

### 3.2 Rate / charge schema (embedded per lane, per vendor submission)

| Field | Notes |
| --- | --- |
| `laneRef` | matched against canonical lane list (fuzzy-matched if spelling/city-state mismatch) |
| `freightCharge` | value + basis (`flat` / `per_kg` / `per_unit` / `slab_on_weight`) |
| `fuelSurcharge` | value + basis (`flat` / `pct_of_freight`) |
| `odaCharge` | value + basis (`flat` / `per_kg` / `per_unit` / `slab_on_weight`), nullable |
| `pickupCharge` | value + basis (`flat` / `per_unit`), nullable |
| `loadingCharge` | value + basis (`flat` / `per_unit`, unit ∈ `kg`/`tonne`/`box`/`roll`/`bale`), nullable |
| `stateCharge` | value + basis (`flat` / `inter_state_flat` / `intra_state_flat` / `inter_state_per_kg` / `intra_state_per_kg`), nullable |
| `greenTax` | value + basis, nullable |
| `additionalLocationCharge` | value + basis (`per_unit` / `slab_on_weight`), nullable — the Kerala-drop-off-style surcharge |
| `fovLiability` | value as % of invoice value, nullable |
| `currency` | `INR` / `USD` — if `USD`, `normalizedValueInr` is populated by deterministic conversion and flagged |
| `unitDefinition` | free text captured verbatim when a vendor's "per box"/"per unit" needs disambiguation — carried alongside `basis` so the mismatch is visible, not silently normalized away |
| `bundledAllIn` | boolean — true if vendor gave one number without breaking out components |
| `minChargeableWeight` | nullable |
| `regionMatrix` | optional nested structure for from-region/to-region rate tables with min guaranteed weight, where a vendor quotes at region rather than lane granularity |

### 3.3 Questionnaire schema

Categories, each field tagged **gate**, **scored**, or **informational** (unchanged from original design):

| Category | Example fields | Type |
| --- | --- | --- |
| Compliance | Under investigation? Outstanding legal issues? | Gate |
| Financials | Revenue (3yr), profit % | Scored |
| Fleet | Fleet size, % BS-6 compliant, average vehicle age | Scored |
| Technology | GPS enabled, GPS coverage %, ERP integration | Scored |
| Regional presence | Coverage checklist vs. requested lane regions | Scored |
| Certifications | Count + status | Scored |
| Business info | Company name, address, directors | Informational |

### 3.4 Terms schema

| Field | Type |
| --- | --- |
| Payment terms (days) | Scored — distance from buyer's stated ideal |
| Contract duration | Scored |
| SLA / penalty clause present | Gate (mandatory) |
| Insurance coverage confirmed | Gate (mandatory) |
| Termination notice period | Informational |

### 3.5 Scoring

```
vendor_score = w1 × rate_competitiveness
             + w2 × questionnaire_score
             + w3 × terms_score
(any gate failure in questionnaire or terms → vendor excluded from ranking, shown separately)
```

Weights are buyer-adjustable **at query time via the analyst chat** (`rank_vendors`, §9), not a settings panel — this is deliberate: it keeps the "buyer stops clicking and starts asking" framing from the brief true even for the weighting step, not just the Q&A.

**How a raw answer becomes a score, concretely:** every `scored` field in §3.3/§3.4 declares one benchmark — `higher_is_better` (target value, e.g. fleet size ≥ 300 trucks = 100), `lower_is_better` (e.g. average vehicle age ≤ 4 years = 100), `boolean_true_is_better` (Yes = 100, No = 0), or `closest_to_target` with a tolerance (e.g. payment terms — 45 days = 100, decaying to 0 at ±30 days). Benchmarks are absolute, buyer-set targets, not relative min-max scaling across the 5 vendors — relative scaling lets a vendor score 100 just for being the least-bad of five weak submissions, which isn't defensible to a buyer with ₹4 crore on the line (§0/§7). A section's score is the simple average of its dimension scores; `informational` fields (company name, directors, top customers, certifications list — the genuinely free-text, subjective content) are never scored, by design, not by omission. This is implemented in `lib/scoring/computeScores.ts` and has been run against the real fixture answers (`npm run score:fixtures`) — not just described here.

**Product decision — `rate_competitiveness` is the one exception to "absolute benchmark, not relative scaling," and deliberately so.** Everything above holds for questionnaire/terms fields because there's a buyer-set "ideal" to benchmark against (a target fleet size, a target payment-terms window). Price has no such external target — "cheapest wins" is inherently a comparison between the vendors who actually bid on a lane. So `rate_competitiveness` is scored relatively: per lane, the cheapest vendor with a usable landed-cost total scores 100, and every other vendor on that lane scores `max(0, 100 − pctMoreExpensiveThanCheapest)`. A vendor's overall rate score is the average of its per-lane scores, taken only over lanes where at least one other vendor also had a usable total — a lane where a vendor is the sole quoter is excluded from its average rather than trivially scored 100. Implemented in `lib/scoring/rateCompetitiveness.ts`.

**Product decision — landed cost per lane needs a reference shipment weight, and some charge bases can't be safely totaled.** `normalizeCharge.ts` deliberately stops at "value + basis" — it never resolves `per_kg`/`slab_on_weight`/`pct_of_freight` into an actual per-shipment number, because that requires a shipment-weight assumption the extraction layer has no business inventing. `lib/scoring/computeLandedCost.ts` adds that resolution as a separate, deterministic step, per lane per vendor:
- `flat`, `inter_state_flat`, `intra_state_flat` → added directly.
- `per_kg`, `inter_state_per_kg`, `intra_state_per_kg` → value × reference weight, where reference weight is the **midpoint of the lane's `weightBand`** (e.g. "500-1000 kg" → 750 kg). This applies uniformly, including to a vendor's `bundledAllIn` line — "bundled" means one line item covers every charge, not that the number is already a per-shipment total (vendor D's bundled rate is itself quoted per_kg).
- `pct_of_freight` → value% × that same vendor/lane's resolved `freight_charge`.
- `per_unit`, `slab_on_weight` (when not otherwise resolved), and `pct_of_invoice_value` (fov_liability) are **excluded from the total** — there's no reliable unit count or invoice value in the data model, and guessing one would be the same kind of silent-invention the trust rule forbids the LLM from doing, just committed in code instead. These still display as line items; the lane's total is marked `partial` and the excluded components are named.
- A lane's total stays **usable for the relative rate-competitiveness ranking even when it's `partial`** — requiring a fully-resolved total turned out to disqualify almost every vendor from ever being ranked, because `fov_liability` and per-unit loading charges appear on nearly every lane across the dataset (confirmed by running the real pipeline: vendor A's and C's rate scores came back `null` under the stricter rule). The `partial` flag stays visible to the buyer on the grid and in the source-snippet dialog either way — this only affects whether the automated ranking uses the lane at all, not what's shown.

---

## 4. Fabricated dataset

### 4.1 Buyer-side (downloadable from the UI, for demo transparency)

- RFx definition: 30 PTL lanes (origin/destination/state, expected volume/weight band)
- Blank questionnaire template (`.xlsx`)
- Blank terms template (`.xlsx`)

All three downloadable as real files from the front end so a live-demo reviewer can open and inspect exactly what was sent — directly supports the "trust" rubric axis: nothing about the request side is hidden.

### 4.2 Vendor-side — 5 vendors, each issue traceable to a brief-named edge case

| Vendor | Rates | Questionnaire | Terms | Deliberate issue(s) |
| --- | --- | --- | --- | --- |
| A | Excel, matches template, per-lane breakdown, canonical charge headers | `.xlsx`, complete | `.xlsx`, complete | Happy path — baseline for comparison, and the reference point vendor headers/pricing structure deviate from |
| B | PDF, **quoted in USD**, a from-region/to-region rate **matrix** (not per-lane) with minimum guaranteed weight, an explicit "Zone Definitions" section naming which cities fall in each zone, **real-world header synonyms** ("Origin Handling Fee," "Fuel Cost Adjustment Factor," "Cargo Liability Premium" — not the canonical labels) | `.xlsx`, missing 2 mandatory gate fields | `.xlsx`, complete | Currency mismatch + a structurally different pricing mechanism that must be resolved region→lane (8 of 30 lanes have no applicable rate: 5 because the matrix omits Central/Northeast entirely, 3 more because Goa and Udaipur are explicitly excluded even though their zones are otherwise served — two different coverage-gap causes that must be told apart, not collapsed into one "missing" bucket) + header semantic mapping has real work to do + questionnaire gate failure |
| C | Word doc, rates in prose, **"per box" defined as a 20-unit carton** | `.xlsx`, complete | **PDF instead of xlsx** | Format-rule violation on terms (tests detection, not parsing depth) + unit-basis ambiguity (brief's "per box ≠ per 100 pieces," here vs. vendor A's per-box = 1 unit) |
| D | Photo of printed rate card, angled | `.xlsx`, complete but low GPS coverage | `.xlsx`, complete | Bundled "all-in" rate, no charge breakdown; one line illegible in the photo |
| E | Plain email text, a few lanes typed out | Missing entirely | `.xlsx`, complete | Unsolicited lane not on RFx list quoted; most lanes missing (brief's "quoted 27 of 30 lines" flavor, exaggerated for visibility) |

Every row now maps to a specific phrase in the brief (page 2's edge-case paragraph) rather than a generic QA-style edge case — worth stating in the one-page decision note as evidence the dataset was built *from* the brief, not just *around* it. A and B deliberately use disjoint charge-header vocabularies (A = canonical labels, B = real-world synonyms) — the point of §5.1a's semantic mapping only proves out if at least one vendor's document actually needs it.

---

## 5. Extraction pipeline & edge cases

### 5.1 Pipeline

1. Raw file → Gemini API call (multimodal for PDF/image, parsed text for xlsx/docx) against a fixed extraction schema (§3.2–3.4), using `responseSchema` for guaranteed structured JSON output
2. Output: structured fields, each with confidence score + source citation (cell ref / page / snippet)
3. Deterministic normalization pass (real code, not LLM): currency conversion, unit math, lane fuzzy-matching against canonical list, charge-basis reconciliation where confidently mappable
4. Anything not confidently resolved is flagged, not guessed — this line is the answer to the brief's *"what does it show the buyer when it isn't sure"* question, and it applies uniformly, not per-edge-case

### 5.2 Edge case matrix

| # | Edge case | System behavior |
| --- | --- | --- |
| 1 | Partial lane coverage | Missing lanes shown as empty, not zero; completeness % shown per vendor |
| 2 | Lane not requested but quoted | Flagged as "unsolicited," shown separately, not blended into the 30-lane comparison |
| 3 | Lane spelling / city-state mismatch | Fuzzy-matched against canonical list; low-confidence matches flagged for confirmation |
| 4 | Inconsistent rate column headers across vendors | Semantic mapping in the extraction prompt; unmapped headers flagged, not dropped silently |
| 5 | Illegible photo (angle, low-res) | Explicit "unreadable" state per field, distinct from "zero" or "not quoted" |
| 6 | Charge-basis / unit-basis mismatch (per-kg asked, slab given; "per box" means different things per vendor) | Flagged, not auto-converted unless the conversion is unambiguous; the raw unit definition text is retained and shown alongside the flag |
| 7 | Bundled "all-in" rate, no component breakdown | Flagged as bundled; excluded from per-component comparison, included in total-cost comparison |
| 8 | Vendor edits template structure (xlsx, renamed headers/added rows) | Extraction still attempts semantic matching; low-confidence fields flagged rather than silently misread |
| 9 | Wrong file format submitted (e.g., terms as PDF instead of required xlsx) | Detected and flagged explicitly — "wrong format submitted" — not silently parsed or ignored |
| 10 | Missing mandatory questionnaire/terms field | Gate failure — vendor excluded from ranking, reason shown |
| 11 | Missing entire document | Vendor shown as "not submitted," gate failure by default |
| 12 | Currency mismatch (USD quote in an INR RFx) | Converted at a fixed, disclosed FX rate in deterministic code; original value + rate used shown on hover; never silently merged into INR totals as if native |
| 13 | Rate given as a region matrix, not per-lane (from-region/to-region + minimum guaranteed weight, region covers multiple cities, the document itself states which cities fall in each region) | Each canonical lane's origin/destination state is resolved to a region deterministically (`lib/normalization/regions.ts`, shared with the questionnaire's regional-coverage fields — not re-derived per vendor); the matching matrix cell is applied per lane. A region the matrix omits entirely (not zero, just absent) means every lane touching it has no applicable rate |
| 14 | A city named in the RFQ's lane list falls inside a zone/region the vendor otherwise serves, but the vendor's own document excludes that specific city | Same "not quoted for this lane" outcome as edge case #13, but the cause is different and must be traced to the right one — city-level exclusion, not region-level absence — since the review-queue reason shown to the buyer differs (e.g. vendor B serves all of West India except Goa, so Pune→Goa and Mumbai→Goa show unserved while other West lanes don't) |

---

## 6. Extraction architecture, hosting, and a real platform constraint

### 6.1 Why extraction is chunked, not one call per document

Vercel's free (Hobby) tier caps serverless **function execution at 10 seconds**. A single route handler that uploads a vendor's rate document and runs one multimodal Gemini call across all 30 lanes will often exceed that, especially for the photo/PDF cases the brief is explicitly testing. So:

- Rates extraction runs in small batches (~5–8 lanes per Gemini call), not the whole document at once
- Questionnaire/terms extraction stays single-call (fixed ~30–40 fields, comfortably under 10s)
- `vendorSubmissions.status` / `chunksDone`/`chunksTotal` (§3.1) track progress; the browser advances processing with sequential "process next chunk" calls, rendering a real per-vendor progress state instead of a spinner that either finishes or times out invisibly
- This also directly serves the "quicker decisions" grading axis (§0): the buyer watches extraction actually happen, chunk by chunk, rather than waiting on an opaque black box

### 6.2 Cost discipline (per user's cost-minimal preference)

- Extraction results are cached by `(submissionId, fileHash)` — a document is never re-extracted unless its content changed
- Batch size for rate extraction is set as large as safely fits under the 10s cap (not artificially small), to minimize the number of Gemini calls per document
- Chat agent context is kept to tool-call results only (§9) — no re-sending the full comparison grid as context on every turn

### 6.3 Free-tier hosting

| Layer | Choice | Free tier limit (verified) |
| --- | --- | --- |
| App hosting | Vercel Hobby | 1M invocations/mo, 100GB bandwidth/mo, 4 CPU-hrs/mo active compute, **10s function duration cap** — drives §6.1 |
| Structured data | MongoDB Atlas M0 | 512MB storage, permanently free — trivial for extracted fields across 5 vendors × 30 lanes |
| Raw uploaded files (PDF/image/docx/xlsx) | Vercel Blob | 1GB storage, 10GB transfer/mo — kept separate from Atlas so file bytes never eat into the 512MB structured-data budget |
| Extraction + chat | Gemini API | **Not covered by any free tier** — requires the builder's own Gemini key and budget (though Google AI Studio does hand out a free-tier quota for Gemini, worth using during dev); see §6.2 for how the design keeps usage down |

Environment variables needed at deploy time: `MONGODB_URI`, `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`.

---

## 7. Trust & auditability

Directly answers the brief's *"would a buyer with ₹4 crore on the line act on what's on your screen?"* — concretely, not as a slogan:

- **Every number is clickable.** Clicking any extracted value in the comparison grid opens the source snippet (cell reference / PDF page / photo region / quoted sentence) next to the raw uploaded file, so a buyer can verify without leaving the app.
- **Confidence is visible, not buried.** Every field carries a confidence badge; anything below threshold routes automatically into the Review Queue (§8.2) rather than displaying as if it were certain.
- **The LLM never does arithmetic that ends up on screen.** Extraction produces raw structured values; all normalization, currency conversion, and scoring math is deterministic code (§5.1, §3.5), so a reviewer can audit *why* a number is what it is without re-litigating an LLM's math.
- **Extraction is append-only.** Re-processing a document creates a new `extractedFields` version rather than overwriting the old one — nothing an evaluator saw during a live demo can quietly change underneath them.
- **"Not read by AI" is a real, distinct state** — not blank, not zero, not omitted. It's the honest answer to the brief's illegible-photo example.
- **Awards are logged with a frozen justification.** `decisionRecords` (§3.1) captures the exact scores/flags on screen at the moment of award — the record stays defensible even if a document is later re-extracted or a vendor resubmits.

---

## 8. UI structure

### 8.1 Upload UI (per vendor)

Three document slots per vendor: Rates, Questionnaire, Terms. File drop, per-slot status reflecting `vendorSubmissions.status` (uploaded → processing chunk N/M → done / needs review).

### 8.2 Comparison UI — three sections + two additions

1. **Charges section** — 30 lanes × 5 vendors grid (TanStack Table), normalized rate per lane, inline flags (click → source snippet + what was assumed), toggle to show/hide unsolicited lanes, CSV export
2. **Questionnaire section** — scoreboard per vendor: gate status (pass/fail with reason), scored dimensions with breakdown, completeness %
3. **Terms section** — same pattern: gates, scored dimensions, completeness %
4. **Review queue** — every flag across all vendors and all three sections, aggregated and filterable — the direct, literal answer to "what does the system show the buyer when it isn't sure"
5. **Decision summary** — rate competitiveness + questionnaire score + terms score per vendor, gate failures called out, lightweight "mark awarded" action per lane or vendor (writes a `decisionRecord`, §3.1)

### 8.3 Chat panel

Docked alongside the comparison UI, not a separate page — answers can reference and highlight rows in the grid the buyer is already looking at. Renders three response types: prose with inline citations, tables, and simple charts (bar/column via a lightweight charting lib fed by structured tool output — the chart is rendered by the frontend from Gemini's function-call result, never guessed by the model).

### 8.4 Time-saved indicator (Decision Summary header)

A small, factual panel — not a marketing banner — showing: documents processed, fields auto-extracted vs. flagged for manual review, and an estimated manual-entry time avoided (based on a stated assumption, e.g. "~90 seconds/field manually retyped," shown so the number is auditable, not a black-box claim). This exists because "does extraction visibly reduce decision time" is an explicit grading axis (§0) — it needs to be *shown*, not asserted in the one-page note.

### 8.5 RFx co-pilot (light, but a real loop)

Short conversational step: confirm the 30 lanes, pick questionnaire/terms templates, generate the RFx record. Genuinely calls Gemini in a loop (per the brief's "AI loops must be real" rule) rather than being a wizard with static copy — intentionally low-investment relative to extraction/reasoning/trust, which is what's actually being evaluated, but not faked.

---

## 9. Analyst chat agent — the other axis this build is graded on

**Architecture:** tool-calling agent, not context-stuffing. Gemini gets real functions to call (Gemini's native function calling) against MongoDB via typed Mongoose aggregations — never raw queries, never answering from conversational memory of numbers.

### 9.1 Tools

- `filter_lanes(criteria)`
- `aggregate_cost(vendorId, filter)`
- `filter_vendors_by_gate(gateName)`
- `rank_vendors(weights, filters)` — conversational score weighting, replacing a settings panel (§3.5)
- `get_flags(vendorId, section)`
- `compare_vendors(vendorIds, dimensions)` — side-by-side pull for a specific question, not the whole grid
- `simulate_split_award(criteria)` — **built specifically to answer the brief's own worked example**: *"what if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?"* This is the single scenario the brief uses to illustrate why the current process fails ("there goes the fourth day") — it gets a dedicated, tested tool rather than being left to chance whether the agent composes it correctly from smaller tools
- `explain_flag(flagId)` — returns the source snippet and reasoning behind a specific flag, so "why is this uncertain" is itself an answerable chat question

### 9.2 Guardrails

- Every numeric claim must cite the lane/vendor/field it came from — no answering from "memory" of the conversation
- Refuses to answer questions the data doesn't support (e.g., speculative "what if" about a vendor with no submission) rather than fabricating
- Never presents a ranking without showing what drove it (gates, dimension scores) alongside
- Out-of-scope requests (legal advice, unrelated topics) are declined, not improvised
- A short adversarial test set is run before the recorded walkthrough to catch guardrail failures early (not exhaustive red-teaming — just enough to be confident the "no fabrication" rule holds under the questions likely to come up live)

### 9.3 Question set for the recorded walkthrough

The brief requires *"at least one unrehearsed"* question. Plan for a mix:

1. The brief's own split-award question, verbatim — proves `simulate_split_award` works on the exact scenario that motivated this build
2. A ranking question with an adjusted weight ("re-rank ignoring questionnaire score entirely")
3. A flag-drill-down question ("why is vendor D's Mumbai–Pune rate flagged?")
4. An out-of-scope question, to show the refusal working on camera, not just claimed in this doc
5. One genuinely unrehearsed question, decided at recording time

---

## 10. Tech stack

| Layer | Choice | Why / how used |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router) + TypeScript | Single language across FE/BE, fast to build and demo |
| UI components | Tailwind + shadcn/ui | Table, Tabs, Badge, Dialog map directly to the grid/flag/review UI needs |
| Grid | TanStack Table | Sortable/filterable 30×5 comparison grid |
| Charts | Lightweight React charting lib (e.g. Recharts), fed by tool-call output only | Chat can render charts per the brief's expected output modes (§0), never model-guessed values |
| Backend | Next.js Route Handlers | No separate service needed at this scope |
| AI | Gemini API (`@google/genai`) — multimodal for extraction, function-calling agent for analyst chat | PDFs/images passed directly, no separate OCR pipeline |
| File parsing | `exceljs` (read + generate xlsx), `mammoth` (docx → text, for the prose-rates and format-violation cases), Gemini multimodal input (PDF/image direct) | `exceljs` also generates the downloadable buyer-side templates and dataset |
| Data access | Mongoose over MongoDB Atlas M0 | Typed schemas + typed aggregation pipelines for tool functions (§9.1) — document shape fits the variable rate schema (§3.2) |
| File storage | Vercel Blob | Keeps raw uploads out of Atlas's 512MB structured-data budget (§6.3) |
| Hosting | Vercel Hobby | Free; shapes the chunked-extraction design (§6.1) |

---

## 11. Build phases

1. Data model + canonical lane list + Mongoose schemas (§3)
2. Fabricated dataset — buyer templates + 5 vendor documents with edge cases baked in, all traceable to the brief (§4)
3. Upload UI (§8.1)
4. Extraction pipeline — chunked, cost-disciplined, all formats flowing to structured fields with confidence/flags (§5, §6)
5. Scoring engine — gates + weighted dimensions, deterministic code (§3.5)
6. Trust mechanisms — source-click, confidence badges, review queue, append-only versioning (§7)
7. Comparison UI — three sections + review queue + decision summary + time-saved indicator (§8.2–8.4)
8. Analyst chat agent — tool-calling over MongoDB, including `simulate_split_award` (§9)
9. RFx co-pilot, light but real (§8.5)
10. Adversarial guardrail pass on the chat agent (§9.2)
11. Polish, record walkthrough (§9.3), write the one-page decisions note

---

## 12. Deliverable checklist (per brief, verbatim requirements)

- [ ] Working prototype, all 5 vendors ingested across all 3 sections, ready for a **live demo the evaluator drives** — not just a recording
- [ ] Recorded walkthrough of the analyst conversation, including the split-award question and at least one genuinely unrehearsed question (§9.3)
- [ ] One-page decisions note — what was built, what was deliberately left out and why (reference §2's scoping table directly), what would come next
- [ ] Optional but invited by the brief: if a more interesting problem surfaced during the build than the one in the brief, say so explicitly in the one-page note rather than silently following the brief to the letter
