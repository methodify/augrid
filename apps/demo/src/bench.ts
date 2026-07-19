/** Pure helpers for the Benchmark page (kept DOM-free so they are testable). */

export interface FrameStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

/** p in [0,100]; nearest-rank percentile over an unsorted sample. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function frameStats(deltasMs: number[]): FrameStats {
  if (deltasMs.length === 0) return { frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
  let sum = 0;
  let max = 0;
  for (const d of deltasMs) {
    sum += d;
    if (d > max) max = d;
  }
  return {
    frames: deltasMs.length,
    avgMs: sum / deltasMs.length,
    p95Ms: percentile(deltasMs, 95),
    maxMs: max,
  };
}

export function formatMs(ms: number): string {
  return ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`;
}
