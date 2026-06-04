import { Link } from 'react-router-dom';
import { TBrowseLogo } from 'tbrowse';
import { Prose, Code, h2Style, listStyle } from './Prose';

const REPO_URL = 'https://github.com/warelab/tbrowse';

/** Landing page (`/`). Explains what TBrowse is and points visitors at
 *  the live playground and the developer guide. */
export function AboutPage() {
  return (
    <Prose>
      <h1 style={{ margin: '0 0 10px' }} aria-label="TBrowse">
        <TBrowseLogo height={56} variant="light" title="TBrowse" />
      </h1>
      <p
        style={{
          margin: '0 0 24px',
          fontSize: 18,
          color: 'var(--tbrowse-text-muted)',
        }}
      >
        An embeddable React component for exploring phylogenetic trees and the
        data aligned to them.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        <Link
          to="/playground"
          style={{
            padding: '9px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            background: 'var(--tbrowse-accent)',
            color: 'var(--tbrowse-accent-fg)',
          }}
        >
          Open the playground →
        </Link>
        <Link
          to="/developers"
          style={{
            padding: '9px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            border: '1px solid var(--tbrowse-border)',
            color: 'var(--tbrowse-text)',
          }}
        >
          Embed it in your app
        </Link>
      </div>

      <p style={{ marginTop: 28 }}>
        TBrowse pairs a dynamic tree visualization with a row of{' '}
        <strong>zones</strong> — independent columns that render data keyed to
        the tree&apos;s nodes. Its primary use is <strong>gene trees</strong>:
        leaves are protein-coding genes, internal nodes are inferred ancestral
        states, and the leaves collectively define a multiple sequence
        alignment that other zones can annotate.
      </p>

      <h2 style={h2Style}>Zones</h2>
      <ul style={listStyle}>
        <li>
          <strong>Tree</strong> — a phylogram with leaf extensions; collapse,
          prune, hover-highlight, and click-to-select with a contextual action
          tooltip.
        </li>
        <li>
          <strong>Labels</strong> — user-chosen leaf fields, pulled from the
          tree metadata or external label providers.
        </li>
        <li>
          <strong>MSA</strong> — a pannable/zoomable alignment with a minimap
          header; collapsed subtrees render as a consensus summary.
        </li>
        <li>
          <strong>Neighborhood, Genome &amp; Table</strong> — gene
          neighborhoods, genome features, and arbitrary per-gene tables loaded
          as CSV/TSV.
        </li>
      </ul>

      <h2 style={h2Style}>Design principles</h2>
      <ul style={listStyle}>
        <li>
          <strong>The host owns the data.</strong> TBrowse takes Tree,
          Taxonomy, MSA, and annotations as separate props — it never fetches.
          Adapters (<Code>fromEnsemblGeneTree</Code>,{' '}
          <Code>fromGrameneGenetree</Code>, …) convert source-shaped input into
          its normalized form.
        </li>
        <li>
          <strong>Zones declare what they need.</strong> Missing an input simply
          means that zone doesn&apos;t render, so the tree stays generic and
          source-agnostic.
        </li>
        <li>
          <strong>View state is URL-shareable.</strong> Selection, collapsed and
          pruned subtrees, zone widths and order, the MSA viewport, and search
          all round-trip through a serializable <Code>viewState</Code> object.
        </li>
        <li>
          <strong>Opinionated, lightly themed.</strong> Light/dark theme tokens
          only; no per-element style overrides that could break the UX.
        </li>
      </ul>

      <p
        style={{
          marginTop: 32,
          paddingTop: 20,
          borderTop: '1px solid var(--tbrowse-divider)',
          color: 'var(--tbrowse-text-muted)',
          fontSize: 14,
        }}
      >
        Want to see it in action? Head to the{' '}
        <Link to="/playground" style={{ color: 'var(--tbrowse-accent)' }}>
          playground
        </Link>
        . Ready to integrate? Read the{' '}
        <Link to="/developers" style={{ color: 'var(--tbrowse-accent)' }}>
          developer guide
        </Link>
        , or browse the source on{' '}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--tbrowse-accent)' }}
        >
          GitHub
        </a>
        .
      </p>
    </Prose>
  );
}
