/**
 * Wall-clock budgets for the render benchmarks.
 *
 * Shared CI runners are slow and noisy — measured 65ms for a pass that takes
 * ~17ms on a dev machine — so a threshold tight enough to be meaningful
 * locally is a flake generator in CI. The budget is therefore relaxed on CI
 * while staying strict locally.
 *
 * This costs less than it looks: the real regression signal in these tests is
 * the STRUCTURAL assertion (rendered cells stay O(viewport), not O(rows) or
 * O(columns)) which is deterministic and always enforced. The timing check is
 * the backstop for order-of-magnitude regressions, and a 4x CI allowance
 * still catches those.
 */
const ON_CI = process.env.CI === 'true' || process.env.CI === '1';

export const PERF_SCALE = ON_CI ? 4 : 1;

/** Budget in ms, scaled for the environment. */
export function budget(ms: number): number {
  return ms * PERF_SCALE;
}
