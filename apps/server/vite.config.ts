import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds the browser bundle (react-native-web) served by the LAN server.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  resolve: {
    alias: { 'react-native': 'react-native-web' },
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  define: {
    __DEV__: 'false',
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/web/index.html'),
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return; // react-native-web "use client"
        warn(warning);
      },
    },
  },
});
