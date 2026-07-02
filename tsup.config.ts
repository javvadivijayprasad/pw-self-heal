import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  // onnxruntime-node is optional and loaded dynamically; never bundle it.
  external: ['onnxruntime-node', '@playwright/test'],
});
