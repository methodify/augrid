import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Density, ThemeSpec } from '@augrid/core';
import { KitchenSink } from './pages/KitchenSink';
import { WriteBack } from './pages/WriteBack';
import { Infinite } from './pages/Infinite';
import { TreePivot } from './pages/TreePivot';
import { PivotPlan } from './pages/PivotPlan';
import { Benchmark } from './pages/Benchmark';

export interface PageProps {
  theme: ThemeSpec;
}

const PAGES: { hash: string; label: string; Comp: (props: PageProps) => ReactNode }[] = [
  { hash: 'kitchen', label: 'Kitchen Sink', Comp: KitchenSink },
  { hash: 'writeback', label: 'Write-Back', Comp: WriteBack },
  { hash: 'infinite', label: 'Infinite', Comp: Infinite },
  { hash: 'treepivot', label: 'Tree & Pivot', Comp: TreePivot },
  { hash: 'pivotplan', label: 'Pivot Plan', Comp: PivotPlan },
  { hash: 'benchmark', label: 'Benchmark', Comp: Benchmark },
];

function currentHash(): string {
  const h = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.hash === h) ? h : PAGES[0].hash;
}

type Scheme = 'light' | 'dark' | 'auto';

export function App() {
  const [page, setPage] = useState(currentHash);
  const [scheme, setScheme] = useState<Scheme>('light');
  const [density, setDensity] = useState<Density>('normal');

  useEffect(() => {
    const onHash = () => setPage(currentHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Keep the page chrome in sync with the grid color scheme.
  useEffect(() => {
    const dark =
      scheme === 'dark' ||
      (scheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('demo-dark', dark);
  }, [scheme]);

  const theme = useMemo<ThemeSpec>(() => ({ colorScheme: scheme, density }), [scheme, density]);
  const active = PAGES.find((p) => p.hash === page) ?? PAGES[0];

  return (
    <div className="demo-app">
      <div className="demo-topbar">
        <h1 className="demo-title">AuGrid Demo</h1>
        <nav className="demo-tabs">
          {PAGES.map((p) => (
            <button
              key={p.hash}
              className={'demo-tab' + (p.hash === active.hash ? ' active' : '')}
              onClick={() => {
                window.location.hash = '#/' + p.hash;
              }}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="demo-themebar">
          {(['light', 'dark', 'auto'] as const).map((s) => (
            <button
              key={s}
              className={scheme === s ? 'active' : ''}
              onClick={() => setScheme(s)}
            >
              {s}
            </button>
          ))}
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
            aria-label="Density"
          >
            <option value="compact">compact</option>
            <option value="normal">normal</option>
            <option value="comfortable">comfortable</option>
          </select>
        </div>
      </div>
      {/* key remounts the page (and its grids) when switching tabs */}
      <active.Comp key={active.hash} theme={theme} />
    </div>
  );
}
