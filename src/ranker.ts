/**
 * Ranking orchestration — TS port of healer.py's scoring pipeline.
 * Computes features, applies heuristic / ML / hybrid scoring, thresholds, and
 * ranks candidates. ML inference uses the optional `onnxruntime-node` peer; if
 * the runtime or model is unavailable, ml/hybrid gracefully degrade to
 * heuristic with a one-time warning.
 */

import { computeFeatures, featureArray, heuristicScore } from './features';
import {
  CandidateElement,
  HYBRID_ALPHA,
  HealResult,
  LocatorMetadata,
  RankerMode,
  ScoredCandidate,
  SelfHealConfig,
  THRESHOLDS,
} from './types';

// Typed as `string` so tsc treats the dynamic import as an optional module
// (returns Promise<any>) rather than resolving it at build time.
const ORT_MODULE: string = 'onnxruntime-node';
let warnedNoMl = false;

interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>;
  inputNames: string[];
}

export class Ranker {
  private session: OnnxSession | null = null;
  private sessionTried = false;

  constructor(private readonly config: SelfHealConfig) {}

  private async loadModel(): Promise<OnnxSession | null> {
    if (this.sessionTried) return this.session;
    this.sessionTried = true;
    try {
      const ort: any = await import(ORT_MODULE);
      const { fileURLToPath } = await import('node:url');
      const path = await import('node:path');
      const here = path.dirname(fileURLToPath(import.meta.url));
      const modelPath =
        this.config.modelPath ?? path.resolve(here, '..', 'models', 'healing_ranker_gb.onnx');
      this.session = (await ort.InferenceSession.create(modelPath)) as OnnxSession;
    } catch {
      this.session = null;
      if (!warnedNoMl) {
        warnedNoMl = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[pw-self-heal] ONNX model/runtime unavailable — falling back to heuristic ranking.',
        );
      }
    }
    return this.session;
  }

  private async mlProbabilities(features: number[][]): Promise<number[]> {
    const session = await this.loadModel();
    if (!session) return features.map(() => 0);
    try {
      const ort: any = await import(ORT_MODULE);
      const flat = Float32Array.from(features.flat());
      const tensor = new ort.Tensor('float32', flat, [features.length, features[0].length]);
      const feeds: Record<string, unknown> = { [session.inputNames[0]]: tensor };
      const result = await session.run(feeds);
      const keys = Object.keys(result);
      const probKey = keys.find((k) => /prob/i.test(k)) ?? keys[keys.length - 1];
      const data = Array.from(result[probKey].data as ArrayLike<number>);
      const perRow = data.length / features.length;
      if (perRow === 2) return features.map((_, i) => data[i * 2 + 1]);
      return features.map((_, i) => data[i] ?? 0);
    } catch {
      return features.map(() => 0);
    }
  }

  private threshold(): number {
    return this.config.confidence ?? THRESHOLDS[this.config.mode];
  }

  async rank(original: LocatorMetadata, candidates: CandidateElement[]): Promise<HealResult> {
    const t0 = Date.now();
    const mode: RankerMode = this.config.mode;
    const threshold = this.threshold();

    if (candidates.length === 0) {
      return {
        healed: false,
        topCandidates: [],
        mode,
        algorithm: this.config.algorithm,
        thresholdUsed: threshold,
        candidatesEvaluated: 0,
        elapsedMs: Date.now() - t0,
      };
    }

    const features = candidates.map((c) => computeFeatures(original, c));
    const hScores = features.map(heuristicScore);

    let mlProbas = features.map(() => 0);
    let effectiveMode = mode;
    if (mode === 'ml' || mode === 'hybrid') {
      const arrays = features.map(featureArray);
      mlProbas = await this.mlProbabilities(arrays);
      if (!this.session) effectiveMode = 'heuristic';
    }

    const scored: ScoredCandidate[] = candidates.map((candidate, i) => {
      const h = hScores[i];
      const ml = mlProbas[i];
      let finalScore: number;
      if (effectiveMode === 'heuristic') finalScore = h;
      else if (effectiveMode === 'ml') finalScore = ml;
      else finalScore = HYBRID_ALPHA * h + (1 - HYBRID_ALPHA) * ml;
      return {
        candidate,
        features: features[i],
        heuristicScore: round6(h),
        mlProbability: round6(ml),
        finalScore: round6(finalScore),
        rank: 0,
      };
    });

    scored.sort((a, b) => b.finalScore - a.finalScore);
    scored.forEach((s, i) => (s.rank = i + 1));

    const best = scored[0];
    const healed = !!best && best.finalScore >= threshold;

    return {
      healed,
      bestCandidate: healed ? best : undefined,
      suggestedLocator: healed ? suggestLocator(best.candidate) : undefined,
      topCandidates: scored.slice(0, this.config.topK),
      mode: effectiveMode,
      algorithm: this.config.algorithm,
      thresholdUsed: threshold,
      candidatesEvaluated: candidates.length,
      elapsedMs: Date.now() - t0,
    };
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Recommend a stable locator for a healed element. */
export function suggestLocator(c: CandidateElement): string {
  if (c.element_id) return `#${c.element_id}`;
  if (c.name) return `[name="${c.name}"]`;
  if (c.placeholder) return `[placeholder="${c.placeholder}"]`;
  if (c.aria_label) return `[aria-label="${c.aria_label}"]`;
  if (c.css_path_hint) return c.css_path_hint;
  return c.tag;
}
