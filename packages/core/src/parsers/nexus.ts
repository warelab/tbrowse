import { parseNewick, type ParseNewickOptions, type ParsedTreeFile } from './newick';

/**
 * Parse a Nexus file by extracting the first tree from its TREES block
 * and feeding it to `parseNewick`. Honours TRANSLATE blocks that map
 * shorthand integers back to taxon names — common in MrBayes / BEAST /
 * RAxML output — substituting the full names (quoted when needed) before
 * the Newick parser sees them. Throws when the `#NEXUS` header, the
 * TREES block, or a `tree NAME = ...;` statement is missing. `opts` are
 * forwarded to `parseNewick`. Lifted from
 * `examples/playground/parseTreeFile.ts:203-239`.
 */
export function parseNexus(text: string, opts: ParseNewickOptions = {}): ParsedTreeFile {
  const head = text.match(/#nexus/i);
  if (!head) throw new Error('Nexus: missing #NEXUS header');
  const treesMatch = text.match(/begin\s+trees\s*;([\s\S]*?)end\s*;/i);
  if (!treesMatch) throw new Error('Nexus: no TREES block found');
  const block = treesMatch[1] ?? '';
  // TRANSLATE mapping (optional): `translate <id1> <name1>, <id2> <name2>, ...;`
  const translate: Record<string, string> = {};
  const transMatch = block.match(/translate\s+([\s\S]*?);/i);
  if (transMatch) {
    const pairs = (transMatch[1] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const p of pairs) {
      // First whitespace-separated token is the id, rest is the name.
      const m = p.match(/^(\S+)\s+(.+)$/);
      if (m) translate[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
    }
  }
  const treeMatch = block.match(/tree\s+\S+\s*=(?:\s*\[[^\]]*\])?\s*([\s\S]*?);/i);
  if (!treeMatch) throw new Error('Nexus: no `tree NAME = ...;` line found in TREES block');
  let newick = (treeMatch[1] ?? '').trim() + ';';
  // Substitute translated ids with their full names. Done BEFORE
  // parsing so the Newick parser sees the resolved labels.
  if (Object.keys(translate).length > 0) {
    newick = newick.replace(/([(,])\s*(\w+)/g, (full, sep: string, tok: string) => {
      const name = translate[tok];
      return name ? `${sep}${quoteIfNeeded(name)}` : full;
    });
  }
  const inner = parseNewick(newick, opts);
  return { ...inner, format: 'nexus' };
}

function quoteIfNeeded(s: string): string {
  return /[\s,():;]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}
