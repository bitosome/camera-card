import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import serve from 'rollup-plugin-serve';
import { rmSync } from 'node:fs';

const watch = process.env.ROLLUP_WATCH === 'true' || process.env.ROLLUP_WATCH === '1';
const development = watch || process.env.DEV === 'true' || process.env.DEV === '1';

/** @type {import('rollup').RollupOptions} */
const config = {
  input: 'src/focused/card.ts',
  preserveEntrySignatures: 'strict',
  output: {
    dir: 'dist',
    entryFileNames: 'camera-card.js',
    chunkFileNames: '[name]-[hash].js',
    format: 'es',
    inlineDynamicImports: !development,
    sourcemap: development,
  },
  plugins: [
    {
      name: 'clean-dist',
      buildStart: () => rmSync('dist', { recursive: true, force: true }),
    },
    nodeResolve({ browser: true }),
    typescript({
      sourceMap: development,
      inlineSources: development,
      exclude: ['dist/**', 'tests/**'],
    }),
    watch &&
      serve({
        contentBase: ['./dist'],
        host: '0.0.0.0',
        port: 10001,
        allowCrossOrigin: true,
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
    !development && terser(),
  ],
};

export default config;
