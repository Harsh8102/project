// Request-scoped timing instrumentation — built specifically to answer "why
// is the chat response slow, and which part is it." Each `.mark()` records
// elapsed time since the previous mark AND since the timer started, so a
// `.summary()` shows both per-step cost and where in the whole request it
// happened. See docs at the repo root for what this found in practice.

export class RequestTimer {
  private readonly start = performance.now();
  private last = this.start;
  private readonly marks: { label: string; sinceLastMs: number; sinceStartMs: number }[] = [];

  mark(label: string): void {
    const now = performance.now();
    this.marks.push({
      label,
      sinceLastMs: Math.round(now - this.last),
      sinceStartMs: Math.round(now - this.start),
    });
    this.last = now;
  }

  totalMs(): number {
    return Math.round(performance.now() - this.start);
  }

  summary(): string {
    const lines = this.marks.map((m) => `  ${m.label}: ${m.sinceLastMs}ms (t+${m.sinceStartMs}ms)`);
    return [`total: ${this.totalMs()}ms`, ...lines].join("\n");
  }

  // Plain-object form for persistence (Mongoose `Schema.Types.Mixed`) — the
  // same numbers `summary()` prints, structured so a UI can render them
  // without re-parsing a log string.
  toJSON(): { totalMs: number; marks: { label: string; sinceLastMs: number; sinceStartMs: number }[] } {
    return { totalMs: this.totalMs(), marks: this.marks };
  }
}
