import { defineConfig } from 'tsup';

/**
 * Eight entries (root barrel + one per subpath) built as ESM + CJS with
 * declaration files for both. `splitting: true` for both formats so every
 * shared module is emitted exactly once as a chunk — a class like
 * `HttpError` imported from `tbrowse-core/fetch` must be the same object
 * that `tbrowse-core/sources` throws (`instanceof` across subpaths).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'tree/index': 'src/tree/index.ts',
    'parsers/index': 'src/parsers/index.ts',
    'cluster/index': 'src/cluster/index.ts',
    'fetch/index': 'src/fetch/index.ts',
    'sources/index': 'src/sources/index.ts',
    'view/index': 'src/view/index.ts',
    'zone/index': 'src/zone/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2020',
  platform: 'neutral',
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' };
  },
});
