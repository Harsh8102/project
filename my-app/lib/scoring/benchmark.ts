// How a raw field value becomes a 0-100 score. Every `scored` field (in
// questionnaireFields.ts and termsFields.ts) declares exactly one of these —
// this is the concrete answer to "how does a number become a score."
//
// Deliberately absolute-benchmark, not relative min-max-across-vendors:
// relative scaling means a vendor can score 100 on a dimension just for
// being the least-bad of five weak submissions, which isn't defensible to a
// buyer ("would you act on what's on your screen?" — §7 of the architecture
// plan). Benchmarks are buyer-set targets, visible and adjustable, not a
// black box — the same `buyerIdeal` idea the terms schema already used for
// payment_terms_days, just made explicit and computable.

export type ScoringBenchmark =
  | { kind: "higher_is_better"; target: number } // score = min(100, value/target * 100)
  | { kind: "lower_is_better"; target: number } // score = min(100, target/value * 100)
  | { kind: "boolean_true_is_better" } // true -> 100, false -> 0
  | { kind: "closest_to_target"; target: number; tolerance: number }; // 100 at target, decays linearly to 0 at target +/- tolerance

export function scoreAgainstBenchmark(value: unknown, benchmark: ScoringBenchmark): number {
  if (value === null || value === undefined || value === "") return 0;

  switch (benchmark.kind) {
    case "boolean_true_is_better":
      return value === true ? 100 : 0;

    case "higher_is_better": {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(100, Math.round((n / benchmark.target) * 100));
    }

    case "lower_is_better": {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(100, Math.round((benchmark.target / n) * 100));
    }

    case "closest_to_target": {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      const distance = Math.abs(n - benchmark.target);
      if (distance >= benchmark.tolerance) return 0;
      return Math.round((1 - distance / benchmark.tolerance) * 100);
    }
  }
}
