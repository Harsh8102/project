# Kill the Quote Spreadsheet — What We Decided, What We Left Out

A one-page summary of the business reasoning behind this build — not the mechanics, the judgment calls.

## What We Decided

**Compare vendors fairly, even though they don't quote the same way.** Some vendors charge a flat fee, some charge per kilo, some charge a percentage of something else. Rather than asking vendors to standardize (unrealistic) or comparing their raw numbers side by side (misleading — a "cheaper-looking" number can be more expensive once fully worked out), the tool converts every vendor's pricing onto one common, comparable footing before anyone reads a total.

**Never guess a number to make a comparison look complete.** Some charges can't be compared without a piece of information the tool doesn't have yet — for example, a per-box charge means nothing without knowing roughly how many boxes are in a shipment. Rather than quietly assuming a number to make the total look tidy, the tool shows that charge as "not yet counted" until a real figure is available. A wrong guess baked into a total is more dangerous than an honest gap, especially for a decision of this size.

**Let the buyer supply the missing pieces themselves, one lane at a time.** For the handful of things the tool can't know on its own (roughly how heavy a shipment usually is, what a typical package weighs, what goods are typically worth on this route), the buyer can fill in a real number for the specific route they're examining. Filling this in for one route never quietly changes the numbers on any of the other routes — each stays independent, so exploring one comparison can't silently distort another.

**Judge price competitiveness against real bidders, not an imaginary "fair price."** There's no external benchmark for what freight "should" cost on a given route — only what the vendors who actually bid are offering. So price is scored relative to the cheapest real bid on each lane, not against a made-up target.

**Show how fragile a "cheapest vendor" conclusion is, not just the conclusion.** Two vendors can look close, with the actual winner depending on exactly how heavy the shipment turns out to be or how valuable the goods are. Instead of hiding that, the tool can show whether today's answer would survive a heavier shipment, a lighter one, or a different declared value — so a buyer isn't caught off guard later by an assumption that didn't hold.

**Let the buyer ask questions in plain language, with every answer traceable.** A conversational assistant answers questions like "who passed our compliance requirements" or "what if we split the business across two vendors instead of one" — but every number it gives back is pulled from the same real, underlying comparison, never invented in the moment.

**Make every recommendation defensible after the fact.** Every score, flag, and "why this vendor" explanation traces back to a real document and a real calculation — nothing is a black-box judgment call that can't be walked back through and justified to a stakeholder or auditor later.

## What We Deliberately Left Out

- **Letting the AI estimate numbers we don't have real data for** (typical package weight, typical shipment value). We decided a gap the buyer can fill in is safer than a confident-looking invented figure.
- **One global assumption for the whole deal.** We deliberately kept these figures specific to each route rather than one setting for all 30 lanes — a global switch is faster to build but too easy to misuse by accident.
- **Reading vendor quotes automatically out of an inbox.** For this version, documents are still uploaded manually rather than pulled from email automatically — a real but self-contained piece of future work, not core to proving the comparison logic works.
- **Multiple buyer accounts or team logins.** This is built as a single buyer's workspace, not a shared multi-user tool with permissions — appropriate for demonstrating the core decision-making value first.
- **What happens after a vendor is picked.** The tool stops at "here's who we should choose and why" — it doesn't generate purchase orders, notify the winning vendor, or track the relationship going forward.
- **A backup AI provider if the primary one is briefly unavailable.** There's one AI provider behind the scenes; if it's temporarily overloaded, that shows up as a delay rather than an automatic switch to a different one — a solvable reliability gap, not a fundamental one, and a buyer can supply their own access in the meantime to keep working.
- **A settings screen for changing how price, compliance, and terms are weighted by default.** The weighting can be adjusted for a single question by asking the assistant directly, but there's no permanent control panel to change the default for everyone — kept simple deliberately, since it's a refinement, not a requirement to prove the core idea.
- **One less-common pricing structure** (rates that step up in tiers as shipment weight crosses certain thresholds) isn't counted into totals yet — getting it right needs more certainty than this version could guarantee, so it's flagged for a human to check rather than risk a silently wrong number.

**The throughline:** every "left out" item was a choice to keep the core promise — a trustworthy, explainable comparison — intact, rather than to rush a wider surface area that would have made the tool faster to demo but harder to actually trust.
