# Normalizing ambiguous charges: what's safe to resolve, what isn't, and why one tempting design was actually wrong

## The complaint

The Charges grid marks some charges "excluded" from a vendor's landed-cost total — `per_unit` (₹/box, ₹/carton — no universal unit), `slab_on_weight`, and `pct_of_invoice_value` (FOV/liability). The existing product decision (`aerchain-implementation-plan.md` §5.3) is deliberate: *"guessing [a unit count or invoice value] would be the same kind of silent-invention the trust rule forbids the LLM from doing, just committed in code instead."* But "excluded" alone isn't a useful answer to a buyer — it tells them something is missing, not what to do about it, or whether it actually matters. This is the investigation into how much of that gap can be closed safely, and where the line actually is.

## First pass: three exclusion reasons, three different root causes

Read the actual exclusion code (`lib/scoring/computeLandedCost.ts`) rather than assuming all three "excluded" cases are the same kind of problem:

- **`slab_on_weight`** is excluded unconditionally, but the doc's own wording — `"slab_on_weight (when not otherwise resolved)"` — implies it was meant to sometimes resolve. The real blocker: `TargetLane` (what the extraction prompt tells the model about a lane) doesn't include the lane's weight band at all, so a genuine multi-row slab table has no guarantee the model picks the matching row. Fixable, but needs an extraction-input change first, and real-document verification before trusting it (a wrong silent number is worse than an honest exclusion) — flagged as a separate, higher-risk follow-up, not done in this pass.
- **`per_unit`**: the extraction pipeline already asks Gemini for a unit definition when the document states one (`unitDefinitionNote`, e.g. "1 carton = 20 units") — but it's captured and then silently discarded before ever reaching the database (`normalizeCharge()`'s return type doesn't include it). A real bug against the existing spec (edge-case table row 6: *"not auto-converted unless the conversion is unambiguous; the raw unit definition text is retained and shown alongside the flag"*), not a new problem. Not yet fixed in this pass — noted as the next piece of this work.
- **`pct_of_invoice_value`**: correctly excluded today, and should stay that way by default — there's no invoice value anywhere in the data model, and inventing one is exactly what the existing trust rule forbids.

## The tempting idea that turned out to be wrong

The obvious next step for `per_unit` looked like: let the buyer supply a reference count (e.g. "assume 1000 units per shipment"), then `resolvedInr = ratePerUnit × referenceCount`, same pattern as the reference-weight convention already used for `per_kg`.

This breaks. If Vendor A quotes a **flat** ₹1000 and Vendor C quotes ₹20/box, the buyer's reference-count guess entirely decides the outcome: at 1000 units, Vendor C's derived total (₹20,000) looks 20x worse than Vendor A's; at 10 units, the opposite. The number *looks* like a real comparison but is actually just reflecting whatever was typed into one input box — worse than "excluded," because it hides its own uncertainty behind a confident-looking total. This is exactly the silent-invention the original design already ruled out; it would have reintroduced it wearing a UI.

Converting the other direction (flat → per-unit, by dividing) hits the identical wall: there's no count to divide by either. **Bridging between "total for the whole shipment" and "amount per discrete unit" always needs a real quantity from somewhere, and there isn't one in this data model** — no amount of clever formula design gets around that; the only real options are "get a trustworthy quantity from somewhere" or "don't force the bridge."

## What's actually safe: comparing within the same basis, not across it

The insight that survived: comparing two `per_unit` charges *against each other* doesn't need a reference count at all. If Vendor A says ₹6.6/box and Vendor C says ₹129/carton, the unknown "how many boxes/cartons is this shipment" would multiply through *identically* on both sides of a ranking — it cancels out. The package name is just vocabulary; a buyer comparing "which vendor's rate is lower per unit" doesn't need to know the actual count to answer that, only to convert either one into an absolute ₹ total.

So the fix splits into two genuinely different problems:

- **Same-basis comparison** (this pass): when 2+ vendors quote the *same* charge type per-unit on the same lane, rank them directly by ₹/unit. Zero invented numbers, safe, useful today.
- **Cross-basis bridging** (deliberately deferred): comparing a per-unit charge against a flat or per-kg one. Still needs a real reference quantity. If built later, the plan is to make it an explicit, human-owned "what-if" surface — the buyer supplies a quantity they actually believe, and the result shows its own sensitivity (*"this flips below N units"*) — rather than folding a fragile number into the automatic total or score. Not built in this pass.

## What was built

`lib/scoring/unitEconomics.ts` — a small pure function, `rankUnitEconomics()`, ranking a set of `{vendorId, ratePerUnitInr}` entries by rate; returns nothing if fewer than 2 entries (nothing to rank).

Wired into the existing `get_lane_charges` chat tool (`lib/ai/chat/tools.ts`) rather than a new tool — consistent with the "enrich existing data, don't grow the tool count" principle from the earlier round-count investigation (`docs/chat-agent-round-count-and-tool-generalization.md`). Vendors are grouped by `fieldKey` (the resolved charge type), not the display label, so wording differences don't split what's really the same charge. Each qualifying row gets `unitEconomicsRank` (e.g. `"#1 of 2 by ₹/unit (cheapest)"`) and a note explaining the comparison's scope — and explicitly that it does **not** extend to flat/per-kg charges.

The landed-cost total and score are completely untouched by this — verified directly (not just typechecked): calling the tool handler against real data for the Ahmedabad→Indore lane, Vendor A's Loading Charge (₹6.6/box) ranked `#1 of 2 (cheapest)`, Vendor C's (₹129/carton) ranked `#2 of 2`, while both still show `resolvedInr: null` and the original exclusion `status` unchanged.

## The general lesson

The instinct "just pick a reasonable-looking default and multiply" is the same failure mode as an LLM inventing a number — it doesn't matter whether the invented number comes from a model or a buyer typing into a box with no ground truth behind it; either way the system would be presenting a guess with the confidence of a fact. The right question isn't "what formula converts basis A to basis B," it's "does this specific comparison need information that genuinely isn't in the data anywhere" — and if the answer is yes, the fix is to say so clearly and let the human own that assumption explicitly, not to hide it behind a plausible-looking formula.
