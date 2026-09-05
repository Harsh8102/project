# How the rate card and vendor scores are calculated

Every number in this doc is real, pulled live from the actual RFx dataset
(not hypothetical) — useful for walking a demo audience through "why does
the screen say this" with a real example instead of a made-up one.

Everything described here is deterministic code, never an LLM guess (the
chat co-pilot can *read* these numbers and explain them, but never computes
them itself — see `docs/DECISIONS_AND_SCOPE.md`).

---

## 1. Landed cost — turning a vendor's charge lines into one ₹ number per lane

For every (vendor, lane) pair, `computeLandedCost` walks every charge line
item the vendor quoted and resolves it to a per-shipment ₹ amount, using the
charge's pricing basis:

| Basis | How it resolves |
|---|---|
| `flat` | used as-is |
| `per_kg` | value × reference weight (kg) |
| `per_unit` | value × unit count (boxes/cartons) |
| `pct_of_invoice_value` | value% × reference invoice value |
| `pct_of_freight` | value% × the freight charge already resolved for this lane |
| `slab_on_weight`, unmapped header, unreadable cell, unusual basis | **excluded** — flagged with a reason, never guessed |

The per-shipment amounts of every *included* line item are summed into
`totalInr`. If every line item included, `status = "resolved"`. If at least
one resolved but at least one had to be excluded, `status = "partial"` — the
total is real, but incomplete (see §2 for why that matters).

### Real example — Mumbai → Ahmedabad, Vendor A (Bharat Roadlines)

Lane weight band: 1000–2500 kg → reference weight = 1,750 kg (band midpoint).
With an RFx-wide default of 10 kg/unit and ₹50,000 reference invoice value set (see §2):

| Charge | Basis | Raw value | Resolved (₹) |
|---|---|---:|---:|
| Freight Charge | per_kg | ₹4.71/kg | 4.71 × 1,750 = **8,242.50** |
| Fuel Surcharge | pct_of_freight | 9.1% | 9.1% × 8,242.50 = **750.07** |
| Loading Charge | per_unit | ₹7/unit | 7 × 175 units (1,750kg ÷ 10kg/unit) = **1,225.00** |
| FOV/Liability | pct_of_invoice_value | 0.24% | 0.24% × 50,000 = **120.00** |
| State Charge | flat | ₹159 | **159.00** |
| Pickup Charge | flat | ₹178 | **178.00** |
| Green Tax | flat | ₹69 | **69.00** |
| **Total** | | | **₹10,743.57** — `status: resolved` |

---

## 2. Cost assumptions — the numbers no vendor document provides

`per_unit` and `pct_of_invoice_value` charges need a unit count / invoice
value that's never in a rate card — the buyer has to supply it. Nothing is
ever silently guessed; an unset assumption just leaves that charge excluded.

**Precedence** (`lib/scoring/costAssumptions.ts`), highest wins:

1. **Lane override** — set from *Lane detail*'s sliders, only affects that one lane
2. **RFx-wide default** — set once from the *Overall cost assumptions* panel above the Charges grid, applies to every lane that doesn't have its own override
3. **Band midpoint** (weight only) — the lane's own weight band, e.g. "1000-2500 kg" → 1,750 kg
4. **Unset** — the charge stays excluded, visibly, until one of the above is set

This is the "overall assumption layer": a buyer sets one avg-weight-per-unit
and one reference-invoice-value for the whole RFx, and every lane resolves
those charge types immediately — no per-lane data entry needed. If a
specific lane genuinely ships a different profile (bulkier cargo, higher
declared value), the buyer opens that lane in *Lane detail* and overrides
just that lane; every other lane keeps using the RFx-wide default.

### Real example — same lane, before the RFx-wide default was set

Before any assumption was set, Vendor A's Loading Charge and FOV/Liability
had nowhere to resolve, so they were excluded and the total was **missing
₹1,345** of real cost:

```
totalInr = 8,242.50 + 750.07 + 159 + 178 + 69 = 9,398.57   status: partial
excludedReasons: [
  "Loading Charge: Priced per unit — no unit-count assumption set...",
  "FOV / Liability Charge: Priced as % of invoice value — no invoice value assumption set..."
]
```

That ₹9,398.57 made Vendor A look like the second-cheapest vendor on this
lane (see §3) — purely because two real charges were invisible, not because
the vendor is actually that cheap.

---

## 3. Rate competitiveness — ranking vendors relative to each other, per lane

There's no absolute "good freight rate" benchmark — cheap only means
something *relative to who else bid on that lane*. So per lane:

1. Take every vendor whose total for that lane is **fully resolved**
   (`status === "resolved"` — see the box below for why this matters)
2. The cheapest resolved vendor scores **100**
3. Every other resolved vendor scores `max(0, 100 - pctMoreExpensive)`,
   where `pctMoreExpensive = (their total − cheapest total) / cheapest total × 100`
4. A lane with fewer than 2 resolved vendors can't be judged relatively and
   is skipped for everyone on it (not scored as a trivial 100 for the sole bidder)

A vendor's overall **rate score** is the plain average of its per-lane
scores, across only the lanes it was actually comparable on.

> **Why `status === "resolved"` only (not partial totals too):**
> A partial total only ever has charges *missing* from it, never extra —
> so comparing a partial total against a fully-resolved one structurally
> favors whoever has more missing charges, regardless of actual price.
> Requiring full resolution means a lane goes dark on ranking until the
> buyer sets the assumption it needs, rather than silently letting an
> incomplete number win. (Before this rule: a partial total was treated
> exactly like a resolved one, which is the bug the real example below shows.)

### Real example, same lane — before vs. after

**Before** the RFx-wide defaults were set, only 2 of 4 vendors on this lane
were fully resolved (A and C were partial, excluded per the rule above):

| Vendor | Total (₹) | Status | Counted? | Score |
|---|---:|---|---|---:|
| E | 8,242.50 | resolved | ✅ | **100** (cheapest) |
| D | 9,537.50 | resolved | ✅ | 100 − (9,537.50−8,242.50)/8,242.50×100 = **84** |
| A | 9,398.57 | partial | ❌ excluded from ranking | — |
| C | 9,692.33 | partial | ❌ excluded from ranking | — |

**After** the RFx-wide defaults (10 kg/unit, ₹50,000 invoice value) were
set, A and C's Loading Charge and FOV/Liability resolved — and the real
picture flipped completely. Vendor C's real per-unit loading rate turned
out to be ₹137/unit (vs. Vendor A's ₹7/unit) — a charge that was
completely invisible until the assumption was set:

| Vendor | Total (₹) | Status | Score |
|---|---:|---|---:|
| E | 8,242.50 | resolved | **100** |
| D | 9,537.50 | resolved | **84** |
| A | 10,743.57 | resolved | 100 − (10,743.57−8,242.50)/8,242.50×100 = **70** |
| C | 33,787.33 | resolved | 100 − 309.9 → max(0, ...) = **0** |

Vendor C went from looking like a reasonably-priced mid-pack bidder
(partial total ₹9,692) to by far the most expensive vendor on this lane,
once its real loading charge was actually counted. This is the exact
scenario the resolved-only rule exists to prevent — and exactly why the
RFx-wide assumption panel matters: it's what makes vendors' *real* prices
visible instead of accidentally rewarding whoever has more unresolved
charges.

---

## 4. Questionnaire / Terms scores — the other two-thirds of the overall score

Each questionnaire/terms field is either:
- a **gate** (pass/fail, e.g. "BS6 compliant fleet ≥ X%") — any gate failure
  excludes the vendor from ranking entirely (`excludedFromRanking = true`,
  `overallScore = null`), regardless of price
- a **scored dimension**, benchmarked one of four ways (`lib/scoring/benchmark.ts`):
  - `higher_is_better`: `score = min(100, value/target × 100)`
  - `lower_is_better`: `score = min(100, target/value × 100)`
  - `boolean_true_is_better`: true → 100, false → 0
  - `closest_to_target`: 100 at the target, decays linearly to 0 at ±tolerance

A section's score is the plain average of its scored dimensions (gates
don't factor into the number, only into exclusion).

---

## 5. Overall vendor score — the final weighted blend

```
overallScore = 0.5 × rateCompetitivenessScore + 0.3 × questionnaireScore + 0.2 × termsScore
```

Only computed if the vendor passed every gate, submitted both sections, and
has a rate score (i.e. was comparable on at least one resolved lane) —
otherwise `overallScore = null` ("excluded from ranking" on the scorecard).

### Real example — Vendor A, with the RFx-wide defaults set

```
rateCompetitivenessScore = 86
questionnaire.sectionScore = 93
terms.sectionScore = 100

overallScore = 0.5×86 + 0.3×93 + 0.2×100
             = 43 + 27.9 + 20
             = 90.9 → rounds to 91
```

This is exactly what the Vendor Scorecard strip shows for Vendor A once the
RFx-wide defaults are set — every number on that card traces back to a real,
inspectable calculation, not a black box.

---

## Where to see this live, for the demo

- **Charges tab → "Vendor scorecard"** (click to expand): overall / rate /
  questionnaire / terms scores per vendor, plus the new **Overall cost
  assumptions** panel right below it — set the two RFx-wide sliders here and
  watch the scores recompute live.
- **Charges tab → Lane detail**: per-lane line-item breakdown (exactly the
  table in §1) with per-lane override sliders, for when one lane's real
  profile differs from the RFx-wide average.
- **Charges tab → grid cell**: click any total to see its line items and
  exclusion reasons for that one vendor/lane.
