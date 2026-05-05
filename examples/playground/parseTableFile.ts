import type { TableColumn, TableData } from 'tbrowse';

export interface ParsedTable {
  columns: TableColumn[];
  table: TableData;
  /** Count of input rows that linked to a unique gene id. */
  rowCount: number;
  /** Diagnostics so the host can surface failures (empty file,
   *  duplicate header, etc.). */
  warnings: string[];
}

export interface ParseTableOptions {
  /** Override the auto-detected delimiter. Defaults to tab when the
   *  first non-empty line has more tabs than commas, else comma. */
  delimiter?: string;
  /** Header for the gene-id column. Falls back to the first header
   *  cell. Case-insensitive match against `gene_id`, `geneId`, `id`,
   *  or `gene` if not specified. */
  geneIdHeader?: string;
}

const BOOLEAN_TRUE = new Set(['true', 't', 'yes', 'y', '1']);
const BOOLEAN_FALSE = new Set(['false', 'f', 'no', 'n', '0']);
const COMMON_GENE_HEADERS = ['gene_id', 'geneid', 'id', 'gene'];

/** Parse a delimited text file into a `{ columns, table }` pair ready
 *  to feed `createTableZone`. The first column whose header matches a
 *  common gene-id name (or `geneIdHeader`) keys the rows; remaining
 *  columns get auto-typed (boolean, number, string) by scanning every
 *  non-empty cell. Quoted fields, escaped quotes (`""`), and CRLF line
 *  endings are handled. */
export function parseTableFile(
  text: string,
  opts: ParseTableOptions = {},
): ParsedTable {
  const warnings: string[] = [];
  const trimmed = text.replace(/^﻿/, '');
  const lines = splitLines(trimmed);
  if (lines.length < 2) {
    return {
      columns: [],
      table: {},
      rowCount: 0,
      warnings: ['File is empty or has no data rows'],
    };
  }
  const delimiter = opts.delimiter ?? detectDelimiter(lines[0]);
  const headerRow = parseDelimitedLine(lines[0], delimiter);
  const dataRows = lines
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => parseDelimitedLine(l, delimiter));

  if (headerRow.length === 0) {
    return {
      columns: [],
      table: {},
      rowCount: 0,
      warnings: ['Could not parse a header row'],
    };
  }

  const geneIdIdx = pickGeneIdColumn(headerRow, opts.geneIdHeader);
  if (geneIdIdx < 0) {
    warnings.push(
      `No gene-id column found (expected one of ${COMMON_GENE_HEADERS.join(', ')}); using the first column "${headerRow[0]}"`,
    );
  }
  const idIdx = geneIdIdx >= 0 ? geneIdIdx : 0;

  // Build the column list (everything except the gene-id column).
  const dataColumnIndices: number[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    if (i === idIdx) continue;
    dataColumnIndices.push(i);
  }

  // Collect raw values per data column for type inference.
  const rawValuesByCol: string[][] = dataColumnIndices.map(() => []);
  const tableEntries: { gene: string; cells: (string | undefined)[] }[] = [];
  for (const row of dataRows) {
    const gene = row[idIdx]?.trim();
    if (!gene) continue;
    const cells: (string | undefined)[] = [];
    for (let j = 0; j < dataColumnIndices.length; j++) {
      const idx = dataColumnIndices[j];
      const cell = row[idx];
      const v = cell?.trim();
      cells.push(v);
      if (v !== undefined && v !== '') rawValuesByCol[j].push(v);
    }
    tableEntries.push({ gene, cells });
  }

  // Header de-duplication so columns get unique ids.
  const seenIds = new Set<string>();
  const columns: TableColumn[] = dataColumnIndices.map((origIdx, j) => {
    const label = headerRow[origIdx]?.trim() || `column_${j + 1}`;
    let id = slugify(label);
    if (id === '' || seenIds.has(id)) {
      let n = 2;
      const base = id || `col${j + 1}`;
      while (seenIds.has(`${base}_${n}`)) n++;
      id = `${base}_${n}`;
    }
    seenIds.add(id);
    const kind = inferKind(rawValuesByCol[j]);
    return { id, label, kind };
  });

  const table: TableData = {};
  for (const { gene, cells } of tableEntries) {
    const row: Record<string, string | number | boolean | null> = {};
    for (let j = 0; j < columns.length; j++) {
      const v = cells[j];
      if (v === undefined || v === '') {
        row[columns[j].id] = null;
        continue;
      }
      row[columns[j].id] = coerce(v, columns[j].kind!);
    }
    if (gene in table) {
      warnings.push(`Duplicate gene id "${gene}" — last row kept`);
    }
    table[gene] = row;
  }

  return {
    columns,
    table,
    rowCount: Object.keys(table).length,
    warnings,
  };
}

function pickGeneIdColumn(
  headerRow: string[],
  override: string | undefined,
): number {
  if (override) {
    const want = override.toLowerCase();
    const idx = headerRow.findIndex((h) => h.trim().toLowerCase() === want);
    return idx;
  }
  for (const candidate of COMMON_GENE_HEADERS) {
    const idx = headerRow.findIndex(
      (h) => h.trim().toLowerCase().replace(/\s+/g, '') === candidate,
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectDelimiter(line: string): string {
  const tabs = line.split('\t').length - 1;
  const commas = line.split(',').length - 1;
  if (tabs > commas) return '\t';
  return ',';
}

function splitLines(text: string): string[] {
  // Strip stray \r from CRLF-terminated files; preserve embedded
  // newlines that were inside quoted cells (rare, but possible).
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function inferKind(values: string[]): 'string' | 'number' | 'boolean' {
  if (values.length === 0) return 'string';
  let allNum = true;
  let allBool = true;
  for (const v of values) {
    const lower = v.toLowerCase();
    if (allBool && !BOOLEAN_TRUE.has(lower) && !BOOLEAN_FALSE.has(lower)) {
      allBool = false;
    }
    if (allNum) {
      const n = Number(v);
      if (!Number.isFinite(n) || v === '') allNum = false;
    }
    if (!allBool && !allNum) return 'string';
  }
  // Boolean wins when every cell is in the bool vocabulary; numbers
  // like "0"/"1" can also satisfy that, so prefer boolean only if at
  // least one non-numeric token (true/yes/no/etc.) appears — otherwise
  // a 0/1 column should stay numeric.
  if (allBool) {
    const hasNonNumericBool = values.some((v) => {
      const lower = v.toLowerCase();
      return BOOLEAN_TRUE.has(lower) || BOOLEAN_FALSE.has(lower)
        ? Number.isNaN(Number(v))
        : false;
    });
    if (hasNonNumericBool) return 'boolean';
  }
  if (allNum) return 'number';
  return 'string';
}

function coerce(
  raw: string,
  kind: 'string' | 'number' | 'boolean',
): string | number | boolean {
  if (kind === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (kind === 'boolean') {
    return BOOLEAN_TRUE.has(raw.toLowerCase());
  }
  return raw;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
