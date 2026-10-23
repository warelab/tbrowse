/**
 * File parsers for `tbrowse-core`: Newick (single and multi-tree), Nexus,
 * PhyloXML, a format-sniffing dispatcher, and delimited (CSV/TSV) tables.
 * Everything here is pure and runs in Node 18+ and in browsers; the
 * PhyloXML parser takes its XML parser by injection.
 */
export {
  parseNewick,
  parseNewickAll,
  type ParseNewickOptions,
  type ParsedTreeFile,
  type TreeFileFormat,
} from './newick';
export { parseNexus } from './nexus';
export {
  parsePhyloXML,
  type DocumentLike,
  type DOMParserLike,
  type ElementLike,
  type ParsePhyloXMLOptions,
} from './phyloxml';
export {
  detectTreeFormat,
  parseTreeFile,
  parseTreeSource,
  type ParseTreeFileOptions,
} from './treeFile';
export {
  detectDelimiter,
  inferColumnKind,
  parseDelimitedLine,
  parseTableFile,
  type ParsedTable,
  type ParseTableOptions,
} from './table';
