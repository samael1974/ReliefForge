// src/lib/relief/depth/fuseDepthDetail.ts
//
// Fusione IBRIDA: profondita' AI (macro-forma) + dettaglio ad alta frequenza
// dalla luminanza (micro-incisioni). E' qui che si supera i generatori
// commerciali, che tipicamente usano UNA sola fonte.
//
//   fused = clamp01( depth01 + detailAmount * highpass(luma01) )
//   highpass = luma01 - gaussianBlur(luma01, sigma)

import { gaussianBlurF32 } from "@/lib/relief/transform/tonemap";

export interface FuseOptions {
  /** Peso del dettaglio ad alta frequenza (0..~1.5). Default 0.6. */
  detailAmount?: number;
  /** Sigma del passa-basso usato per estrarre l'alta frequenza. Default 2. */
  detailSigma?: number;
  /** Ri-normalizza il risultato in [0..1]. Default true. */
  renormalize?: boolean;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * depth01 e luma01 devono avere la STESSA dimensione w*h.
 * (estimateDepth ritorna depth alle dimensioni dell'immagine; calcola luma
 *  dalla stessa ImageData per garantire l'allineamento.)
 */
export function fuseDepthDetail(
  depth01: Float32Array,
  luma01: Float32Array,
  w: number,
  h: number,
  opts: FuseOptions = {}
): Float32Array {
  if (depth01.length !== w * h || luma01.length !== w * h) {
    throw new Error("fuseDepthDetail: dimensioni depth/luma non coerenti con w*h");
  }
  const amount = opts.detailAmount ?? 0.6;
  const sigma = opts.detailSigma ?? 2;
  const renorm = opts.renormalize ?? true;

  const low = gaussianBlurF32(luma01, w, h, sigma);
  const out = new Float32Array(w * h);

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const high = luma01[i] - low[i];
    const v = depth01[i] + amount * high;
    out[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  if (!renorm) {
    for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i]);
    return out;
  }
  const span = Math.max(1e-9, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
  return out;
}
