import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  inferColumnKind,
  parseDelimitedLine,
  parseTableFile,
} from '../../src/parsers';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/parsers/${name}`, import.meta.url), 'utf8');

describe('parseTableFile', () => {
  it('parses a TSV with BOM and CRLF: gene_id header, slugified ids, typed columns, nulls', () => {
    const { columns, table, rowCount, warnings } = parseTableFile(fixture('genes.tsv'));
    expect(warnings).toEqual([]);
    expect(rowCount).toBe(3);
    expect(columns).toEqual([
      { id: 'expression_level', label: 'Expression Level', kind: 'number' },
      { id: 'is_expressed', label: 'Is Expressed', kind: 'boolean' },
      { id: 'count', label: 'Count', kind: 'number' },
      { id: 'tissue', label: 'Tissue', kind: 'string' },
    ]);
    expect(table['G1']).toEqual({ expression_level: 1.5, is_expressed: true, count: 0, tissue: 'leaf' });
    expect(table['G2']).toEqual({ expression_level: 2.5, is_expressed: false, count: 1, tissue: 'root' });
    // Empty cells become null; "yes" coerces to true.
    expect(table['G3']).toEqual({ expression_level: null, is_expressed: true, count: 1, tissue: null });
  });

  it('parses a CSV: quoted commas, escaped quotes, first-column fallback, duplicate headers and gene ids', () => {
    const { columns, table, rowCount, warnings } = parseTableFile(fixture('genes.csv'));
    expect(columns.map((c) => c.id)).toEqual(['score', 'label', 'flag', 'score_2']);
    expect(columns.map((c) => c.kind)).toEqual(['number', 'string', 'number', 'string']);
    expect(table['G1']!['label']).toBe('plain');
    expect(table['G2']!['label']).toBe('He said "hi"');
    // 0/1 column stays numeric.
    expect(table['G2']!['flag']).toBe(0);
    expect(table['G1']!['score']).toBe(30);
    expect(rowCount).toBe(2);
    expect(warnings).toEqual([
      'No gene-id column found (expected one of gene_id, geneid, id, gene); using the first column "name"',
      'Duplicate gene id "G1" — last row kept',
    ]);
  });

  it('detects the gene-id column by header gene_id / geneId / id / gene (case-insensitive, any position)', () => {
    for (const header of ['Gene_ID', 'geneId', 'ID', 'Gene', 'gene id']) {
      const { table, columns, warnings } = parseTableFile(`x,${header}\n1,G1\n2,G2\n`);
      expect(warnings).toEqual([]);
      expect(columns.map((c) => c.id)).toEqual(['x']);
      expect(Object.keys(table)).toEqual(['G1', 'G2']);
    }
  });

  it('honours geneIdHeader and delimiter overrides', () => {
    const { table, columns } = parseTableFile('a;b;id\nG1;2;Z1\n', { delimiter: ';', geneIdHeader: 'b' });
    expect(columns.map((c) => c.id)).toEqual(['a', 'id']);
    expect(table['2']).toEqual({ a: 'G1', id: 'Z1' });
  });

  it('reports empty input and files without data rows through warnings, never throws', () => {
    expect(parseTableFile('')).toEqual({ columns: [], table: {}, rowCount: 0, warnings: ['File is empty or has no data rows'] });
    expect(parseTableFile('gene_id\tx')).toEqual({ columns: [], table: {}, rowCount: 0, warnings: ['File is empty or has no data rows'] });
    // Header present, all rows blank gene ids → zero rows, columns still typed as string.
    const r = parseTableFile('gene_id,x\n,1\n');
    expect(r.rowCount).toBe(0);
    expect(r.columns).toEqual([{ id: 'x', label: 'x', kind: 'string' }]);
  });

  it('slugifies odd headers and de-duplicates empty ones', () => {
    const { columns } = parseTableFile('id,Fold Change (log2),,,%GC\nG1,1,2,3,4\n');
    expect(columns.map((c) => c.id)).toEqual(['fold_change_log2', 'column_2', 'column_3', 'gc']);
    expect(columns.map((c) => c.label)).toEqual(['Fold Change (log2)', 'column_2', 'column_3', '%GC']);
  });
});

describe('detectDelimiter', () => {
  it('prefers tab when tabs outnumber commas, else comma', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a\tb,c,d')).toBe(',');
    expect(detectDelimiter('a')).toBe(',');
  });
});

describe('parseDelimitedLine', () => {
  it('splits on the delimiter, honouring quotes and "" escapes', () => {
    expect(parseDelimitedLine('a,b,,c', ',')).toEqual(['a', 'b', '', 'c']);
    expect(parseDelimitedLine('"x, y",z', ',')).toEqual(['x, y', 'z']);
    expect(parseDelimitedLine('"say ""hi""",1', ',')).toEqual(['say "hi"', '1']);
    expect(parseDelimitedLine('a\tb', '\t')).toEqual(['a', 'b']);
    expect(parseDelimitedLine('', ',')).toEqual(['']);
  });
});

describe('inferColumnKind', () => {
  it('types numbers, booleans and strings; 0/1 stays numeric', () => {
    expect(inferColumnKind([])).toBe('string');
    expect(inferColumnKind(['1', '2.5', '-3e2'])).toBe('number');
    expect(inferColumnKind(['0', '1', '1'])).toBe('number');
    expect(inferColumnKind(['true', 'FALSE', 'yes', 'n', 't', 'f'])).toBe('boolean');
    expect(inferColumnKind(['1', 'true'])).toBe('boolean');
    expect(inferColumnKind(['1', 'maybe'])).toBe('string');
    expect(inferColumnKind(['Infinity'])).toBe('string');
    expect(inferColumnKind(['abc'])).toBe('string');
  });
});
