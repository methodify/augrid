import { describe, expect, it } from 'vitest';
import { formatMs, frameStats, percentile } from './bench';

describe('percentile', () => {
  it('handles empty input', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('returns the single element for any p', () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 100)).toBe(7);
  });

  it('computes nearest-rank percentiles', () => {
    const samples = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // unsorted on purpose
    expect(percentile(samples, 50)).toBe(5);
    expect(percentile(samples, 95)).toBe(10);
    expect(percentile(samples, 100)).toBe(10);
    expect(percentile(samples, 10)).toBe(1);
  });

  it('does not mutate its input', () => {
    const samples = [3, 1, 2];
    percentile(samples, 50);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe('frameStats', () => {
  it('handles empty input', () => {
    expect(frameStats([])).toEqual({ frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0 });
  });

  it('computes avg, p95 and max', () => {
    const deltas = [16, 16, 16, 16, 16, 16, 16, 16, 16, 160];
    const s = frameStats(deltas);
    expect(s.frames).toBe(10);
    expect(s.avgMs).toBeCloseTo(30.4);
    expect(s.p95Ms).toBe(160);
    expect(s.maxMs).toBe(160);
  });
});

describe('formatMs', () => {
  it('shows one decimal under 100ms, whole numbers above', () => {
    expect(formatMs(16.6667)).toBe('16.7 ms');
    expect(formatMs(123.4)).toBe('123 ms');
  });
});
