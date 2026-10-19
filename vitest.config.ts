import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  // vitest does not read tsconfig paths; without this alias the viewer's
  // tests would resolve the workspace symlink to packages/core/dist, which
  // is absent on a clean checkout.
  resolve: {
    alias: {
      'tbrowse-core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
