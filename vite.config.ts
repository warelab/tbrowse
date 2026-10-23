import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { copyFileSync } from 'fs';
import { resolve } from 'path';

/**
 * GitHub Pages has no SPA rewrite, so a hard refresh on a client route
 * like `/tbrowse/playground` 404s. Copying the built index.html to
 * 404.html makes Pages serve the app shell for any unknown path, and
 * react-router then renders the right route. (The dev server already
 * does history-API fallback, so this only matters for the static build.)
 */
function spaFallback(): Plugin {
  return {
    name: 'tbrowse-spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const dir = resolve(__dirname, 'dist-playground');
      copyFileSync(resolve(dir, 'index.html'), resolve(dir, '404.html'));
    },
  };
}

/**
 * Three vite configurations live here:
 *
 * - `npm run dev`               → playground dev server.
 * - `npm run build`             → library build into ./dist (the published
 *                                 npm package).
 * - `npm run build:playground`  → static playground site into
 *                                 ./dist-playground, suitable for GitHub
 *                                 Pages. The `--mode playground` flag
 *                                 selects this branch; PLAYGROUND_BASE env
 *                                 lets the GitHub Actions workflow
 *                                 override the public path
 *                                 (default `/tbrowse/`).
 */
export default defineConfig(({ command, mode }) => {
  const isPlaygroundBuild = command === 'build' && mode === 'playground';
  const isLibraryBuild = command === 'build' && !isPlaygroundBuild;

  if (isLibraryBuild) {
    return {
      plugins: [react(), dts({ rollupTypes: true, include: ['src'] })],
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'TBrowse',
          formats: ['es', 'cjs'],
          fileName: (format) => `tbrowse.${format === 'es' ? 'js' : 'cjs'}`,
        },
        rollupOptions: {
          // Externalise every runtime dependency so consumers'
          // bundlers resolve them from their own node_modules. React
          // and react-dom are peer deps; zustand and tbrowse-core are
          // hard deps listed in `dependencies`, so npm install pulls
          // them in automatically. tbrowse-core is deliberately NOT
          // aliased in lib mode so the rolled-up d.ts keeps
          // `from 'tbrowse-core'` instead of inlining its types.
          external: ['react', 'react-dom', 'react/jsx-runtime', 'zustand', 'tbrowse-core'],
        },
      },
    };
  }

  // Dev server + playground build share the same root and aliases —
  // the playground imports `tbrowse` and `tbrowse-core` and the aliases
  // resolve directly into the sources, so it tracks the latest code
  // without a library pre-build of either package.
  const playgroundConfig = {
    plugins: [react()],
    root: resolve(__dirname, 'examples/playground'),
    resolve: {
      alias: {
        tbrowse: resolve(__dirname, 'src/index.ts'),
        'tbrowse-core': resolve(__dirname, 'packages/core/src/index.ts'),
      },
    },
    server: {
      // The playground's BrAPI mode fetches a relative
      // `/brapi/v2/allelematrix-search?…&tree=upgma` URL. Point the proxy at a
      // running gramene-g2p API (its default dev port is 8080) or any other
      // BrAPI v2 server via BRAPI_PROXY_TARGET.
      proxy: {
        '/brapi': {
          target: process.env.BRAPI_PROXY_TARGET ?? 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };

  if (isPlaygroundBuild) {
    return {
      ...playgroundConfig,
      plugins: [...playgroundConfig.plugins, spaFallback()],
      // GitHub Pages serves project sites under `/<repo>/`; override via
      // PLAYGROUND_BASE for non-default deployments.
      base: process.env.PLAYGROUND_BASE ?? '/tbrowse/',
      build: {
        outDir: resolve(__dirname, 'dist-playground'),
        emptyOutDir: true,
      },
    };
  }

  return playgroundConfig;
});
