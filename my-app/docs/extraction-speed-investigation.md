# Investigation: can rate extraction be made as fast as the chat co-pilot got?

## The complaint

Chat got a real, verified fix (a 3-tier Groq → Cerebras → OpenRouter fallback
chain — see `SUBMISSION_DOCUMENTATION.md` §8.3) that took it from Gemini's
24–51s per turn down to ~1–3s in the common case. The natural next question:
does the same move work for rate extraction, which was taking **1–1.5
minutes per document**, sometimes worse (a real 4-chunk xlsx document
measured at **156.6 seconds** end to end)? Five real providers/model
combinations were tested against real documents and real ground truth before
answering. Unlike chat, the answer here is no — and the *why* is the useful
part.

## What was tried, in order, on real documents

Every test below used the project's own real fixture documents and their
real, known-in-advance ground truth (`lib/fixtures/vendorDataset/rateModel.ts`
for Vendor A's per-lane rates, `generateVendorD.ts`'s own `bundledRate()`
formula for Vendor D's photographed card, including its one deliberately
illegible lane) — not synthetic prompts.

### 1. Groq (`openai/gpt-oss-120b`) on Vendor A's real xlsx text

Faster per call than Gemini (10.3–18.0s vs. Gemini's 24–51s observed on the
same chunks) — but on a full 4-chunk run, one entire 8-lane chunk came back
with **every freight value wrong**, even though the model correctly reported
which lane indices it was answering for. The pattern wasn't random: lane 0's
wrong answer was lane 1's correct answer, lane 1's wrong answer was lane 2's
correct answer, and so on — a clean one-row shift. Confirmed via explicit
index logging that this wasn't a mapping bug in the surrounding code; the
model itself lost track of which row's number belonged to which lane. Groq's
free tier (8,000 tokens/minute) also proved too tight for this workload on
its own, independent of the accuracy problem.

### 2. Mistral OCR, standalone

Excellent, and worth separating from what came after: **129/129 real values
correct** across two different real documents — 29/29 on Vendor D's genuine
photographed rate card (correctly leaving the one deliberately-illegible
lane blank rather than guessing through it), 90/90 on Vendor B's PDF, both
in ~3.3–3.5 seconds. Mistral's own OCR is not the weak link anywhere in this
investigation.

### 3. Mistral OCR → Gemini text classification (the "hybrid" pipeline)

This is where it went wrong, and instructively so. Feeding Mistral's
byte-perfect OCR text of Vendor D's photo into Gemini's own **text-mode**
classifier (the same model, same schema, same taxonomy prompt used
everywhere else in this app) produced only **5/29 correct** freight values,
with the same one-row-shift signature as the Groq failure above, and it
missed the illegible-lane flag entirely. The same Gemini model's **vision**
mode, reading the identical image directly, had already gotten 29/29 right
in the existing production path. So the failure wasn't "Gemini is bad at
this" — it was specifically "Gemini's text-mode, reading a reformatted
transcript, loses the row alignment its own vision-mode preserves."

On a *simpler* document (Vendor B's clean, digitally-generated flat-rate
PDF — no photograph, no illegible cell, no bundled-rate ambiguity), the same
hybrid approach worked fine: 30/30 lanes agreed exactly with the direct-vision
baseline, and it was faster (42.0s vs. 63.3s). The failure is specific to
documents with an irregularity for the model to trip on, not universal.

### 4. Groq vision (`qwen/qwen3.8-27b`) on Vendor D's real photo

A genuinely new angle — a fast provider reading the *original* image
directly, not a text transcript, on the theory that preserving visual
layout was what let Gemini's vision mode succeed where its own text mode
failed. Real result: the model consistently left the structured `value`
field malformed or empty, even though it correctly quoted the right number
in a separate `sourceQuote` field in the same response — a real generation
defect under the combination of vision input and strict JSON-schema mode,
not a truncation artifact (confirmed by testing with a token budget far
larger than the response needed). Compounded by a free-tier ceiling of just
1,000 output tokens/minute, too tight to reliably extract even one 8-lane
chunk.

### 5. DeepSeek, split by input type (via OpenRouter)

- **Text mode** (`deepseek/deepseek-v4-flash`) on Vendor A's clean xlsx-derived
  text: **8/8 correct** — the only fast alternative that got a real chunk
  completely right. But not fast: 53.7 seconds, no better than Gemini's own
  baseline for the same chunk.
- **Vision mode** (`deepseek/deepseek-v4-flash-vision-exp`) on Vendor D's
  photo: 4/7 legible lanes correct, and the wrong ones showed the *same*
  one-row-shift signature as Groq's and Gemini-text's failures — cascading
  right after the illegible lane it also failed to flag.
- A follow-up hypothesis — "Mistral OCR reads (proven perfect), DeepSeek's
  *text* mode classifies (proven perfect on clean text)" — was attempted but
  never completed: the classification call was still running past two and a
  half minutes when it had to be killed, because it was consuming the same
  shared OpenRouter quota the live chat fallback chain depends on, and a
  real user was actively using chat at the time. Inconclusive on accuracy;
  already slow enough on wall-clock time alone (Mistral's ~1.4s OCR step
  plus an open-ended DeepSeek call already past 150s) that it would not have
  been a speed win even had it finished.

## The pattern

Four independent providers/models — Groq text, Groq vision, Gemini's own
text mode, DeepSeek vision — each produced the *same specific failure
shape* on a document with any irregularity (an illegible cell, a bundled
rate, a reformatted transcript instead of the original layout): correct
lane-index bookkeeping, but the actual values shift by one row from the
irregularity onward. Gemini's direct vision reading is the only approach,
across every real document tested, that got every value right, every time.
That stopped looking like "Gemini happened to win a few benchmarks" and
started looking like a genuine, repeated limit on how reliably a fast model
can track row alignment in a long, imperfect table — a materially harder
task than the tool-selection problem chat's fallback chain solved.

## Root cause

Same underlying driver as the chat investigation
(`chat-response-time-investigation.md`): Gemini's own per-call latency
(15–56s, previously measured on trivial prompts too — this is "thinking"
overhead, not congestion) dominates extraction time, and a chunked document
pays that cost once per chunk. The difference from chat: chat had a fast
*and* correct alternative (Groq). Extraction does not — every fast
alternative tested traded away correctness on exactly the task that matters
(reading a real, imperfect document without silently corrupting a number),
and this project's standing rule is that a fast wrong answer is worse than
a slow right one (the same reasoning that earlier ruled out Gemini's own
lite tier for extraction, before any of this session's testing began).

## What was changed, and what wasn't

**Changed — parallelized the chunk calls.** `extractRatesForDocument.ts`
ran chunks strictly sequentially; nothing about a per-lane chunk depends on
another chunk's result except one thing — detecting a `region_matrix`
document early enough to skip the remaining chunks. Fixed by running the
first chunk alone (to make that detection cheaply) and, only for the common
per-lane case, firing every remaining chunk concurrently instead of queued.
Verified on the real ground-truth test: **98s vs. the original 156.6s — a
38% reduction**, with accuracy unchanged (30/30, same as always), because
it is the literal same model making the literal same calls, just not
waiting for each other. Zero new accuracy risk.

**Tried and rejected — disabling Gemini's "thinking".** The SDK exposes a
real `thinkingBudget` config option (0 = disabled). `gemini-3.6-flash`
rejected `0` outright with `400 INVALID_ARGUMENT` — this model requires
some non-zero minimum. A follow-up test of a small non-zero budget was
blocked by hitting Gemini's free-tier **daily** quota wall (20
requests/day) for a second time this week, on a second API key — flagged
separately as a standing operational risk, independent of this
investigation, worth resolving at the Google Cloud billing/project level
rather than by rotating keys again. The plumbing for this experiment
(`generateStructured`'s optional `thinkingBudget` param, threaded through
`extractRatesChunk`/`extractRatesForDocument`) was kept — it's opt-in,
defaults to today's unchanged behavior, and is available whenever quota
allows finishing the test.

**Not changed — the extraction model itself.** Stays on Gemini, vision-direct
for PDF/image documents, text for xlsx. Every alternative tested either
failed the accuracy bar on the harder real documents or matched it without
being any faster.

## Why this matters as a build decision

The instinct after chat's fallback chain worked would be to reach for the
same fix here. The discipline was testing that assumption against real
documents before trusting it, the same way the chat investigation trusted
measurement over instinct. The interesting finding isn't "extraction is
still slow" — it's that the exact same class of failure (a long table
losing row alignment after one irregularity) recurred across four unrelated
providers, which is much stronger evidence that this is a genuinely hard
sub-problem than any single failed benchmark would have been. Shipping the
parallel-chunking fix — the one lever that was unambiguously safe — instead
of a provider swap that kept failing the accuracy bar is the same "measure,
then act only on what the data supports" approach used throughout this
project's AI-provider decisions.
