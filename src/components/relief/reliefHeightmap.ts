import type { ReliefParams } from "@/components/relief/ReliefControls";

export type HeightmapResult = {
  width: number;
  height: number;
  grayU8: Uint8ClampedArray; // preview 0..255
  normF32: Float32Array; // heightmap vera 0..1
  min: number;
  max: number;
};

export type HeightmapOptions = {
  /** If true, invert grayscale (useful when you want dark areas raised). */
  invert?: boolean;

  /**
   * Normalize to use full range (0..1) based on min/max.
   * Helps contrast for relief.
   */
  normalize?: boolean;

  /**
   * (Compat) Keep for callers. If present, you can later implement
   * percentile clipping in float. For now it's accepted to avoid TS errors.
   */
  percentileClip?: number;

  /**
   * (Compat) Keep for callers. For now it's accepted to avoid TS errors.
   */
  gamma?: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/* =========================================================
   FLOAT PIPELINE (0..1) — BASE SERIA PER STL PULITO
   ========================================================= */

export function rgbaToGrayF32(imageData: ImageData): Float32Array {
  const { data } = imageData;
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    out[j] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return out;
}

export function boxBlurF32(
  src: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  if (radius <= 0) return src;
  const r = Math.floor(radius);
  const dst = new Float32Array(src.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let yy = y - r; yy <= y + r; yy++) {
        if (yy < 0 || yy >= h) continue;
        for (let xx = x - r; xx <= x + r; xx++) {
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx];
          cnt++;
        }
      }
      dst[y * w + x] = sum / cnt;
    }
  }
  return dst;
}

export function enhanceDetailF32(
  src: Float32Array,
  w: number,
  h: number,
  detail: number
): Float32Array {
  if (detail <= 0) return src;
  const blurred = boxBlurF32(src, w, h, 1);
  const dst = new Float32Array(src.length);
  const k = detail * 1.2;

  for (let i = 0; i < src.length; i++) {
    dst[i] = src[i] + (src[i] - blurred[i]) * k;
  }
  return dst;
}

export function applyEdgeModeF32(
  src: Float32Array,
  edge: "round" | "sharp"
): Float32Array {
  if (edge !== "sharp") return src;
  const dst = new Float32Array(src.length);

  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    dst[i] = v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
  }
  return dst;
}

export function invertF32(src: Float32Array): Float32Array {
  const dst = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) dst[i] = 1 - src[i];
  return dst;
}

export function minMaxF32(src: Float32Array): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}

export function normalizeF32(
  src: Float32Array,
  lo: number,
  hi: number
): Float32Array {
  const dst = new Float32Array(src.length);
  const d = Math.max(1e-9, hi - lo);
  for (let i = 0; i < src.length; i++) {
    dst[i] = clamp((src[i] - lo) / d, 0, 1);
  }
  return dst;
}

export function floatToGrayU8(src: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = Math.round(clamp(src[i], 0, 1) * 255);
  }
  return out;
}

/* =========================================================
   MAIN PIPELINE
   ========================================================= */

export function buildHeightmapFromImageData(
  imageData: ImageData,
  params: Pick<ReliefParams, "smooth" | "detail" | "edge">,
  options: HeightmapOptions = {}
): HeightmapResult {
  const w = imageData.width;
  const h = imageData.height;

  let f = rgbaToGrayF32(imageData);

  const blurRadius = Math.round(lerp(0, 3, clamp(params.smooth, 0, 1)));
  if (blurRadius > 0) f = boxBlurF32(f, w, h, blurRadius);

  f = enhanceDetailF32(f, w, h, clamp(params.detail, 0, 1));
  f = applyEdgeModeF32(f, params.edge);

  if (options.invert) f = invertF32(f);

  const mm = minMaxF32(f);
  const fn = options.normalize ? normalizeF32(f, mm.lo, mm.hi) : f;

  const grayU8 = floatToGrayU8(fn);

  return {
    width: w,
    height: h,
    grayU8,
    normF32: fn,
    min: mm.lo,
    max: mm.hi,
  };
}

/* =========================================================
   PREVIEW CANVAS
   ========================================================= */

export function drawHeightmapToCanvas(
  canvas: HTMLCanvasElement,
  grayU8: Uint8ClampedArray,
  w: number,
  h: number
) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  canvas.width = w;
  canvas.height = h;

  const out = ctx.createImageData(w, h);
  for (let i = 0, j = 0; j < grayU8.length; j++, i += 4) {
    const v = grayU8[j];
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

/* =========================================================
   POST-PROCESS su heightmap GIÀ normalizzata [0..1].
   Riusa la stessa logica smooth/detail/edge della pipeline immagine,
   così gli slider Dettaglio/Smussatura agiscono anche sulle depth map caricate.
   Non muta l'array sorgente (può essere in cache).
   ========================================================= */
export function postProcessHeightmapF32(
  src: Float32Array,
  w: number,
  h: number,
  params: Pick<ReliefParams, "smooth" | "detail" | "edge">,
  options: { normalize?: boolean } = {}
): Float32Array {
  let f = src.slice();

  const blurRadius = Math.round(lerp(0, 3, clamp(params.smooth, 0, 1)));
  if (blurRadius > 0) f = boxBlurF32(f, w, h, blurRadius);

  f = enhanceDetailF32(f, w, h, clamp(params.detail, 0, 1));
  f = applyEdgeModeF32(f, params.edge);

  if (options.normalize) {
    const mm = minMaxF32(f);
    f = normalizeF32(f, mm.lo, mm.hi);
  }
  return f;
}
