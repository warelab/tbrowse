import { Link } from 'react-router-dom';
import { TBrowseLogo } from 'tbrowse';
import { Prose, Code, CodeBlock, h2Style, listStyle } from './Prose';

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

      <h2 style={h2Style}>Two packages: the viewer and the core</h2>
      <p>
        TBrowse is published as two npm packages that share one data model.{' '}
        <Code>tbrowse</Code> is the React component — the chassis, the
        built-in zones, the toolbar and the theme. <Code>tbrowse-core</Code> is
        everything that prepares data for it and nothing that draws: it has no
        dependencies, ships ESM and CommonJS builds, and runs in a browser or in
        Node. The viewer depends on the core and re-exports its types, so a
        host can import <Code>Tree</Code> from either package and get the same
        type.
      </p>
      <ul style={listStyle}>
        <li>
          <strong>Data model.</strong> A tree is a flat map of nodes with
          parent pointers (<Code>{'{ rootId, nodes }'}</Code>); everything
          attached to it is a separate map keyed by the leaf&apos;s gene id
          (sequences, protein domains, neighborhoods, gene structures, genotype
          calls, germplasm) or by taxon id. The view state — selection,
          collapsed and pruned subtrees, zone layout, search — is a plain
          serializable object. All of these types live in the core.
        </li>
        <li>
          <strong>Parsers and adapters.</strong> Newick, Nexus and PhyloXML
          files, CSV/TSV tables, and the JSON shapes served by Ensembl REST,
          the Gramene API and BrAPI genotyping servers all convert into the
          data model through pure functions (<Code>parseTreeFile</Code>,{' '}
          <Code>fromEnsemblGeneTree</Code>, <Code>fromGrameneGenetree</Code>,{' '}
          <Code>fromBrAPIAlleleMatrix</Code>, …). No network access is involved,
          so they are easy to test and to reuse in scripts.
        </li>
        <li>
          <strong>Data sources.</strong> A <Code>TreeDataSource</Code> loads a
          root (the tree and whatever arrives with it) and declares{' '}
          <em>slots</em> — independently fetched per-leaf data that becomes
          host props as it lands, each with its own loading, progress and error
          state. Built-in sources cover Ensembl gene trees, Gramene gene trees,
          BrAPI allele matrices and uploaded tree files; a host extends one by
          adding its own slot. A <Code>Loader</Code> runs a source with
          retry/backoff and bounded fan-out, and maps slot status onto the zones
          the host says they feed.
        </li>
        <li>
          <strong>Algorithms.</strong> Tree walks and roll-ups (per-node counts
          over a subtree, the clades excluded by a filter), pruning to a leaf
          set, the node-of-interest pivot, Newick serialization, and UPGMA
          clustering of genotype dosages that yields a tree the viewer can
          display directly.
        </li>
        <li>
          <strong>React glue.</strong> In the viewer, <Code>useLoader</Code>{' '}
          runs a source and returns the props to spread onto{' '}
          <Code>{'<TBrowse>'}</Code>, and <Code>useInitialViewState</Code> keeps
          a controlled view state in step with it — rebuilt when a new tree
          arrives, kept when only the endpoint changes.
        </li>
      </ul>
      <p>
        A host that already has the data can skip all of this and hand the
        component its props; one that wants the full pipeline wires it in a
        few lines:
      </p>
      <CodeBlock>{`import { TBrowse, treeZone, labelsZone, msaZone, useLoader, useInitialViewState } from 'tbrowse';
import { ensemblGeneTreeSource } from 'tbrowse-core';

const zones = [treeZone, labelsZone, msaZone];
const { hostProps, snapshot } = useLoader(ensemblGeneTreeSource, { geneId }, {
  zoneSlots: { msa: ['proteinDomains'] },
});
const [viewState, setViewState] = useInitialViewState(zones, snapshot);
if (!hostProps || !viewState) return snapshot.error ?? 'Loading…';
return <TBrowse {...hostProps} zones={zones} viewState={viewState} onViewStateChange={setViewState} />;`}</CodeBlock>
      <p>
        The same core runs headless: a Node script can fetch a gene tree,
        prune it to a set of genomes and write Newick without the viewer, and a
        server can cluster genotypes with the same UPGMA the browser uses. This
        playground, the Homology and Taxonomic-distribution views of the
        Gramene and SorghumBase search apps, and the Gramene genotype
        service are all built on it.
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
