// src/lib/relief/transform/tonemap.ts
//
// Quick-win di qualita' per l'heightmap di ReliefForge.
// Tutte le funzioni operano su Float32Array in [0..1] e ritornano un NUOVO array.
//
// Implementa cio' che in reliefHeightmap.ts era dichiarato ma NON implementato
// (gamma, percentileClip) + un blur GAUSSIANO separabile che sostituisce il box
// blur (meno banding, bordi meno sbavati a parita' di raggio).

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Kernel gaussiano 1D normalizzato per un dato sigma. */
function gaussianKernel(sigma: number): Float32Array {
  const s = Math.max(1e-3, sigma);
  const radius = Math.max(1, Math.ceil(s * 3));
  const size = radius * 2 + 1;
  const k = new Float32Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * s * s));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

/**
 * Blur gaussiano SEPARABILE (orizzontale poi verticale), bordi in clamp.
 * Costo O(n * radius) invece di O(n * radius^2) del box blur 2D ingenuo.
 */
export function gaussianBlurF32(
  src: Float32Array,
  w: number,
  h: number,
  sigma: number
): Float32Array {
  if (sigma <= 0) return src;
  const k = gaussianKernel(sigma);
  const radius = (k.length - 1) / 2;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);

  // orizzontale
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -radius; t <= radius; t++) {
        let xx = x + t;
        if (xx < 0) xx = 0;
        else if (xx >= w) xx = w - 1;
        acc += src[row + xx] * k[t + radius];
      }
      tmp[row + x] = acc;
    }
  }
  // verticale
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -radius; t <= radius; t++) {
        let yy = y + t;
        if (yy < 0) yy = 0;
        else if (yy >= h) yy = h - 1;
        acc += tmp[yy * w + x] * k[t + radius];
      }
      dst[y * w + x] = acc;
    }
  }
  return dst;
}

/**
 * Percentile clip: porta i valori sotto pLow e sopra (1-pHigh) ai limiti e
 * ri-normalizza in [0..1]. Elimina l'effetto per cui un singolo riflesso
 * speculare (o un nero pieno) stira tutto il range dell'heightmap.
 *
 * @param p frazione tagliata per lato, es. 0.02 = taglia il 2% piu' scuro e il 2% piu' chiaro.
 */
export function percentileClipF32(
  src: Float32Array,
  p: number
): Float32Array {
  const frac = Math.max(0, Math.min(0.45, p));
  if (frac <= 0) return src;

  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < src.length; i++) {
    let b = (clamp01(src[i]) * (BINS - 1)) | 0;
    hist[b]++;
  }
  const total = src.length;
  const loCount = frac * total;
  const hiCount = (1 - frac) * total;

  let acc = 0;
  let loBin = 0;
  let hiBin = BINS - 1;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= loCount) {
      loBin = b;
      break;
    }
  }
  acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= hiCount) {
      hiBin = b;
      break;
    }
  }
  const lo = loBin / (BINS - 1);
  const hi = hiBin / (BINS - 1);
  const span = Math.max(1e-6, hi - lo);

  const dst = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    dst[i] = clamp01((src[i] - lo) / span);
  }
  return dst;
}

/**
 * Correzione gamma su valori [0..1].
 * gamma > 1  -> solleva i mezzitoni/ombre (piu' materiale nelle zone scure)
 * gamma < 1  -> comprime le ombre, esalta le alte luci
 * gamma = 1  -> nessun effetto.
 */
export function gammaF32(src: Float32Array, gamma: number): Float32Array {
  const g = Math.max(0.05, gamma);
  if (Math.abs(g - 1) < 1e-3) return src;
  const inv = 1 / g;
  const dst = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    dst[i] = Math.pow(clamp01(src[i]), inv);
  }
  return dst;
}
