/**
 * Smoke test for the exported ONNX ranker.
 *
 *   npm install -D onnxruntime-node   # if not already present
 *   node scripts/smoke-onnx.mjs
 *
 * Verifies that models/healing_ranker_gb.onnx:
 *   1. loads under onnxruntime-node,
 *   2. declares a 17-feature input (matches FEATURE_NAMES in the TS runtime),
 *   3. runs one inference and returns a usable probability.
 *
 * If the input dimension is not 17, ml/hybrid mode would silently fail at
 * runtime (the runtime feeds a [N,17] tensor), so this exits non-zero.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_FEATURES = 17;
const here = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(here, '..', 'models', 'healing_ranker_gb.onnx');

let ort;
try {
  ort = await import('onnxruntime-node');
} catch {
  console.error('onnxruntime-node is not installed. Run: npm install -D onnxruntime-node');
  process.exit(2);
}

console.log('Loading', modelPath);
const session = await ort.InferenceSession.create(modelPath);

console.log('inputNames :', session.inputNames);
console.log('outputNames:', session.outputNames);

const inName = session.inputNames[0];
const meta = session.inputMetadata?.[0] ?? session.inputMetadata?.[inName];
const dims = meta?.dimensions ?? meta?.shape;
console.log('input dims :', dims);

// Declared feature dimension is the last axis of the input shape.
const declared = Array.isArray(dims) ? Number(dims[dims.length - 1]) : NaN;

// One inference with a [1, 17] float32 row.
const row = new Float32Array(EXPECTED_FEATURES).fill(0.5);
const tensor = new ort.Tensor('float32', row, [1, EXPECTED_FEATURES]);
const result = await session.run({ [inName]: tensor });
const outKey =
  Object.keys(result).find((k) => /prob/i.test(k)) ??
  Object.keys(result)[Object.keys(result).length - 1];
const data = Array.from(result[outKey].data);

console.log('output key :', outKey);
console.log('output data:', data);

const okDim = !Number.isFinite(declared) || declared === EXPECTED_FEATURES;
if (!okDim) {
  console.error(
    `\nFAIL: model expects ${declared} features but the runtime feeds ${EXPECTED_FEATURES}.`,
  );
  process.exit(1);
}
if (!data.length || data.some((v) => Number.isNaN(v))) {
  console.error('\nFAIL: inference returned no usable probability.');
  process.exit(1);
}

console.log('\nOK: model loads, accepts a 17-feature row, and returns a probability.');
