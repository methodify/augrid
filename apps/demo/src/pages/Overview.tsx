import type { PageProps } from '../App';

/**
 * Landing page for the public demo site: what AuGrid is and where to look,
 * so a visitor isn't dropped face-first into a 100k-row grid with no context.
 */

interface Demo {
  hash: string;
  title: string;
  blurb: string;
  tags: string[];
}

const DEMOS: Demo[] = [
  {
    hash: 'kitchen',
    title: 'Kitchen Sink',
    blurb:
      'Up to 1M rows. Editing, grouping, pivot, multi-range selection, fill handle, clipboard, ' +
      'column menus, tool panels, find-in-grid, CSV + Excel export, state save/restore.',
    tags: ['1M rows', 'editing', 'export', 'side bar'],
  },
  {
    hash: 'writeback',
    title: 'Write-Back',
    blurb:
      'Server-authoritative editing: the grid never mutates your data. Every edit, paste and ' +
      'fill emits one event; the server answers and the truth flows back.',
    tags: ['readOnlyEdit', 'cellEditRequest'],
  },
  {
    hash: 'sparklines',
    title: 'Sparklines',
    blurb:
      'In-cell line, area, column and win/loss marks over a planning dataset — including the ' +
      'same series drawn per-cell (shape) and column-shared (magnitude) side by side.',
    tags: ['cell visuals', 'sort by trend'],
  },
  {
    hash: 'pivotplan',
    title: 'Pivot Plan',
    blurb:
      'An editable pivot: type into an aggregate cell and the event carries the full ' +
      'intersection — row keys × column keys × measure — for the app to decompose.',
    tags: ['pivot write-back', 'PivotCellContext'],
  },
  {
    hash: 'serverside',
    title: 'Server-Side',
    blurb:
      'Lazy per-parent group expansion for hierarchies too large to hold: one query per expand, ' +
      'server-computed aggregates, write-back at any grain.',
    tags: ['serverSide model', 'lazy trees'],
  },
  {
    hash: 'infinite',
    title: 'Infinite',
    blurb: 'Block-cached server scrolling with sort/filter pass-through and targeted refresh.',
    tags: ['datasource', 'block cache'],
  },
  {
    hash: 'treepivot',
    title: 'Tree & Pivot',
    blurb: 'Hierarchical tree data and full pivot mode with generated column groups.',
    tags: ['treeData', 'pivotMode'],
  },
  {
    hash: 'benchmark',
    title: 'Benchmark',
    blurb: 'Run the render, sort, filter and aggregate timings yourself, in your browser.',
    tags: ['measure it'],
  },
];

const FACTS: { value: string; label: string }[] = [
  { value: '0', label: 'runtime dependencies' },
  { value: '~47 kB', label: 'core, min+gzip' },
  { value: '1M', label: 'rows, virtualized' },
  { value: 'MIT', label: 'every feature, free' },
];

export function Overview(_props: PageProps) {
  const go = (hash: string) => () => {
    window.location.hash = '#/' + hash;
  };

  return (
    <div className="demo-page demo-overview">
      <header className="ov-hero">
        <h2>
          A free, MIT-licensed data grid that does what the expensive ones do.
        </h2>
        <p>
          Row grouping, aggregation, <strong>pivoting</strong>, cell <strong>range selection</strong>,{' '}
          <strong>fill handle</strong>, clipboard, tree data, set filters, undo/redo, Excel export,
          server-side row models and in-cell sparklines — all in the MIT core, with zero runtime
          dependencies. Everything on this site is the real grid running in your browser.
        </p>
        <div className="ov-facts">
          {FACTS.map((f) => (
            <div key={f.label} className="ov-fact">
              <span className="ov-fact-value">{f.value}</span>
              <span className="ov-fact-label">{f.label}</span>
            </div>
          ))}
        </div>
        <div className="ov-cta">
          <button className="ov-primary" onClick={go('kitchen')}>
            Open the Kitchen Sink →
          </button>
          <a
            className="ov-link"
            href="https://github.com/methodify/augrid"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
        </div>
      </header>

      <section className="ov-grid" aria-label="Demos">
        {DEMOS.map((d) => (
          <button key={d.hash} className="ov-card" onClick={go(d.hash)}>
            <span className="ov-card-title">{d.title}</span>
            <span className="ov-card-blurb">{d.blurb}</span>
            <span className="ov-card-tags">
              {d.tags.map((t) => (
                <span key={t} className="ov-tag">
                  {t}
                </span>
              ))}
            </span>
          </button>
        ))}
      </section>

      <footer className="ov-footer">
        <p>
          Install (pre-npm) from the{' '}
          <a
            href="https://github.com/methodify/augrid/releases"
            target="_blank"
            rel="noreferrer"
          >
            release tarballs
          </a>
          . Docs: architecture, recipes and the product plan live in{' '}
          <a
            href="https://github.com/methodify/augrid/tree/main/docs"
            target="_blank"
            rel="noreferrer"
          >
            /docs
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
