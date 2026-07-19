# Architecture Decision Records

## ADR-001: TypeScript core, no Rust/WASM in v1 — with a WASM-ready seam

**Status:** accepted (2026-07-19)

**Context.** "Extreme performance" raised the question of a Rust/WASM engine.

**Decision.** The core is optimized TypeScript. The `RowModel` abstraction is the seam where
an optional WASM columnar engine can plug in later (`@augrid/engine-wasm`, Rust + Arrow).

**Rationale.**
1. A grid's hot path is DOM mutation; WASM has no DOM access — every DOM write crosses back
   through JS. WASM adds per-frame boundary overhead to the exact path we optimize.
   Grid speed comes from O(visible) DOM, element recycling, zero layout reads, rAF batching.
2. The pipeline (sort/filter/group/pivot) is CPU-bound, but our API contract — `rowData` as
   arbitrary JS objects, JS `valueGetter`/comparator/aggregation callbacks — means a WASM
   pipeline either marshals every row across the boundary or calls back into JS per row.
   Both cost more than the compute saved. WASM wins only for columnar data that enters and
   stays in linear memory (cf. FINOS Perspective) — a different product contract.
3. Data-oriented TS (typed-array index permutations, precomputed sort keys, monomorphic
   loops, incremental dirty-stage recompute) lands within ~2× of native for this workload;
   our quality bars (100k sort <120ms etc.) have wide headroom.
4. Zero-install, zero-async-init, debuggable, contributor-friendly — matters for OSS adoption.

**Escape hatch.** `RowModel` is an interface (`client`, `infinite` in v1). A future columnar
engine for 10M+-row analytics (Arrow ingest from e.g. Microsoft Fabric) implements it without
touching renderer or public API. That is where Rust belongs if/when profiling demands it.

## ADR-002: DOM rendering with virtualization, not canvas

**Status:** accepted (2026-07-19)

Canvas grids (e.g. Glide) win raw paint throughput but forfeit native accessibility, IME/text
behavior, CSS theming, and DOM/React custom cell renderers — all core product promises.
DOM virtualization + recycling demonstrably holds 60fps at 1M rows (AG Grid proves the
ceiling). Renderer is a distinct module; a canvas/hybrid painter remains possible later
behind the same controllers.

## ADR-003: Fine-grained internal store (signals), framework-free

**Status:** accepted (2026-07-19)

Internal reactivity is a ~100-line signal/computed/effect implementation. No external state
library: zero deps is a product promise, and the store is trivial relative to integration
cost of a dependency. Public API remains imperative + events (AG-Grid-familiar).

## ADR-004: Write-back as a first-class contract

**Status:** accepted (2026-07-19)

All mutation paths (cell edit commit, paste, fill handle) funnel through one value-commit
pipeline honoring `readOnlyEdit`: when set, the grid mutates nothing and emits
`cellEditRequest` events; the host applies changes (locally or via server round-trip like
Microsoft Fabric write-back) and feeds data back via `applyTransaction`/`setRowData`.
This makes async server-authoritative editing the paved road, not a workaround.
