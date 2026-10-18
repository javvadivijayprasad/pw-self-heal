import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  // onnxruntime-node and linkedom are optional and loaded dynamically; never
  // bundle them.
  external: ['onnxruntime-node', 'linkedom', '@playwright/test'],
});
