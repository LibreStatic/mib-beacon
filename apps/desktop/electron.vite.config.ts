import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

/**
 * Renderer runs react-native-web: alias the bare `react-native` specifier to
 * react-native-web, resolve the platform `.web.*` extensions RN packages use,
 * and inject the __DEV__ global RN code expects.
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: { external: ['net-snmp', 'electron'] },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { 'react-native': 'react-native-web' },
      extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
    },
    define: {
      global: 'globalThis',
      __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
    root: resolve(import.meta.dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/renderer/index.html'),
        // react-native-web ships "use client" directives that are meaningless
        // when bundled for Electron; silence the resulting rollup noise.
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(warning);
        },
      },
    },
  },
});
