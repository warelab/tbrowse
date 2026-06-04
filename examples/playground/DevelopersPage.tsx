import { Link } from 'react-router-dom';
import { Prose, Code, CodeBlock, h2Style, listStyle } from './Prose';

const REPO_URL = 'https://github.com/warelab/tbrowse';

/** Developer guide (`/developers`). How to install TBrowse, feed it
 *  data, configure zones, and persist view state. */
export function DevelopersPage() {
  return (
    <Prose>
      <h1 style={{ margin: '0 0 6px', fontSize: 30, letterSpacing: -0.4 }}>
        Embedding TBrowse
      </h1>
      <p
        style={{
          margin: '0 0 8px',
          fontSize: 17,
          color: 'var(--tbrowse-text-muted)',
        }}
      >
        TBrowse ships as a single React component. You bring the data and the
        layout; it owns the interaction.
      </p>

      <h2 style={h2Style}>Install</h2>
      <CodeBlock>{`npm install tbrowse react react-dom`}</CodeBlock>
      <p style={{ marginTop: 4, color: 'var(--tbrowse-text-muted)', fontSize: 14 }}>
        <Code>react</Code> and <Code>react-dom</Code> (18+) are peer
        dependencies. The theme stylesheet is injected automatically on first
        render — there is no CSS file to import.
      </p>

      <h2 style={h2Style}>Minimal example</h2>
      <p>
        Render <Code>&lt;TBrowse&gt;</Code> inside a sized container — it fills
        its parent. The only required prop is <Code>tree</Code>, plus the{' '}
        <Code>zones</Code> you want to show.
      </p>
      <CodeBlock>{`import { TBrowse, treeZone, labelsZone, msaZone } from 'tbrowse';

function GeneTree({ tree, taxonomy, msa, geneMetadata }) {
  return (
    <div style={{ height: '100vh' }}>
      <TBrowse
        tree={tree}
        taxonomy={taxonomy}
        msa={msa}
        geneMetadata={geneMetadata}
        zones={[treeZone, labelsZone, msaZone]}
      />
    </div>
  );
}`}</CodeBlock>

      <h2 style={h2Style}>The data model</h2>
      <p>
        Inputs are independent and mostly optional. The component never
        fetches — you pass already-loaded data as props:
      </p>
      <ul style={listStyle}>
        <li>
          <Code>tree</Code> <em>(required)</em> — topology only: each node's
          parent, branch <Code>distance</Code>, <Code>taxonomyId</Code>, and a{' '}
          <Code>geneId</Code> for leaves.
        </li>
        <li>
          <Code>taxonomy</Code> — id → scientific / common name, for labels and
          tooltips.
        </li>
        <li>
          <Code>msa</Code> — the multiple sequence alignment (DNA or protein)
          consumed by the MSA zone.
        </li>
        <li>
          <Code>geneMetadata</Code>, <Code>proteinDomains</Code>,{' '}
          <Code>geneStructures</Code>, <Code>neighborhood</Code>,{' '}
          <Code>nodeAnnotations</Code> — per-gene/per-node extras that light up
          the corresponding zones.
        </li>
      </ul>
      <p style={{ color: 'var(--tbrowse-text-muted)', fontSize: 14 }}>
        A zone whose data is absent simply doesn&apos;t render, so the tree
        stays generic across very different datasets.
      </p>

      <h2 style={h2Style}>Zones</h2>
      <p>
        <Code>zones</Code> is an ordered array of zone definitions. Some are
        ready-made singletons; others are factories you configure:
      </p>
      <CodeBlock>{`import {
  treeZone, labelsZone, msaZone, neighborhoodZone,
  createGenomeZone, createTableZone,
} from 'tbrowse';

const zones = [
  treeZone,
  labelsZone,
  msaZone,
  createGenomeZone({ /* track + window options */ }),
  createTableZone({ id: 'expression', data: expressionTable }),
];`}</CodeBlock>
      <p style={{ color: 'var(--tbrowse-text-muted)', fontSize: 14 }}>
        Zones are pluggable: a zone is a <Code>{`{ id, Header, Body }`}</Code>{' '}
        contract, so you can register your own alongside the built-ins.
      </p>

      <h2 style={h2Style}>View state &amp; URL sharing</h2>
      <p>
        TBrowse is controllable. Pass <Code>viewState</Code> and{' '}
        <Code>onViewStateChange</Code> to own selection, collapsed/pruned
        subtrees, zone widths and order, the MSA viewport, and search — then
        serialize that object into a URL to make any view shareable.
      </p>
      <CodeBlock>{`const [viewState, setViewState] = useState();

<TBrowse
  tree={tree}
  zones={zones}
  viewState={viewState}
  onViewStateChange={setViewState}   // persist / round-trip through a URL
  nodeOfInterest="ENSG00000139618"   // focus a gene on first paint
/>`}</CodeBlock>
      <p style={{ color: 'var(--tbrowse-text-muted)', fontSize: 14 }}>
        Omit both props to run uncontrolled — TBrowse keeps its own state. This
        very playground encodes <Code>viewState</Code> into the page hash; try
        it under{' '}
        <Link to="/playground" style={{ color: 'var(--tbrowse-accent)' }}>
          Playground
        </Link>
        .
      </p>

      <h2 style={h2Style}>Adapters</h2>
      <p>
        Source-shaped payloads are converted with helper adapters, keeping the
        core data-source-agnostic:
      </p>
      <CodeBlock>{`import { fromEnsemblGeneTree, fromGrameneGenetree } from 'tbrowse';

const { tree, taxonomy, msa, geneMetadata } = fromEnsemblGeneTree(payload);`}</CodeBlock>

      <h2 style={h2Style}>Theming</h2>
      <p>
        Pass <Code>theme=&quot;light&quot;</Code> or{' '}
        <Code>theme=&quot;dark&quot;</Code>. Styling is intentionally a small
        surface — a set of <Code>--tbrowse-*</Code> CSS custom properties — so
        embeds stay visually consistent. <Code>rowHeight</Code> and{' '}
        <Code>fontSize</Code> tune density.
      </p>

      <p
        style={{
          marginTop: 32,
          paddingTop: 20,
          borderTop: '1px solid var(--tbrowse-divider)',
          color: 'var(--tbrowse-text-muted)',
          fontSize: 14,
        }}
      >
        Full prop and type reference lives with the source on{' '}
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
