import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  if (command === 'build') {
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
          external: ['react', 'react-dom', 'react/jsx-runtime'],
        },
      },
    };
  }
  return {
    plugins: [react()],
    root: resolve(__dirname, 'examples/playground'),
    resolve: {
      alias: {
        tbrowse: resolve(__dirname, 'src/index.ts'),
      },
    },
  };
});
