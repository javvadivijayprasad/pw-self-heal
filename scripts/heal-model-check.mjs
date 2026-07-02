/**
 * Browser-free real-case check of the trained model + ranking pipeline.
 *
 *   npm install -D onnxruntime-node
 *   npm run build
 *   node scripts/heal-model-check.mjs
 *
 * Exercises the ACTUAL exported ONNX model through the Ranker on two realistic
 * scenarios: a locator drift that must heal, and an unrelated page that must
 * NOT heal (no false green). Exits non-zero if either expectation fails.
 * Unlike the Playwright e2e spec, this needs no browser — good for CI.
 */
import { Ranker } from '../dist/index.js';

const meta = (o) => ({ tag: '', text: '', element_id: '', name: '', class_name: '',
  placeholder: '', aria_label: '', parent_tag: 'body', dom_depth: 3, type_attr: '',
  locator_type: 'testid', ...o });
const cand = (o) => ({ tag: '', text: '', element_id: '', name: '', class_name: '',
  placeholder: '', aria_label: '', type_attr: '', value_attr: '', parent_tag: 'body',
  dom_depth: 3, sibling_count: 3, ...o });

// Original locator: getByTestId('add-to-cart') on the "Add to cart" button.
const original = meta({ tag: 'button', text: 'Add to cart', element_id: 'add-to-cart', name: 'add-to-cart' });

const drift = [
  cand({ tag: 'button', text: 'Add to cart', element_id: 'add-to-cart-btn', name: 'add-to-cart-btn' }),
  cand({ tag: 'input', element_id: 'search', name: 'q', placeholder: 'Search', type_attr: 'text' }),
  cand({ tag: 'a', text: 'Privacy', element_id: 'privacy' }),
];
const noMatch = [
  cand({ tag: 'input', element_id: 'search', name: 'q', placeholder: 'Search', type_attr: 'text' }),
  cand({ tag: 'a', text: 'Home', element_id: 'home' }),
];

const r = new Ranker({ mode: 'hybrid' });
let ok = true;

const drifted = await r.rank(original, drift);
console.log('DRIFT      -> healed:', drifted.healed,
  '| best:', drifted.bestCandidate?.candidate.element_id,
  '| score:', drifted.bestCandidate?.finalScore.toFixed(3),
  '| suggested:', drifted.suggestedLocator);
if (!drifted.healed || drifted.bestCandidate?.candidate.element_id !== 'add-to-cart-btn') {
  console.error('FAIL: drift case should heal to add-to-cart-btn'); ok = false;
}

const unrelated = await r.rank(original, noMatch);
console.log('UNRELATED  -> healed:', unrelated.healed);
if (unrelated.healed) {
  console.error('FAIL: unrelated case must NOT heal (false green)'); ok = false;
}

console.log(ok ? '\nOK: model heals real drift and rejects unrelated elements.' : '\nFAILED');
process.exit(ok ? 0 : 1);
