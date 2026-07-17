// src/lib/relief/depth/estimateDepth.ts
//
// Stima di profondita' monoculare IN-BROWSER (niente server, niente account)
// con Depth Anything V2 Small (licenza Apache-2.0) via transformers.js + WebGPU,
// con fallback automatico a WASM.
//
// Requisito: npm i @huggingface/transformers
//
// Output: heightmap normalizzata Float32Array [0..1] alle dimensioni dell'immagine
// di input, pronta per buildSolidFromHeightmap() o per la fusione ibrida.

import { pipeline, RawImage, env } from "@huggingface/transformers";

// I pesi vengono scaricati da Hugging Face e messi in cache dal browser.
// "small" = veloce, leggero (~50-100 MB). "base" = qualità più alta, più nitido,
// ma più pesante da scaricare (~190 MB fp16). Entrambi Apache-2.0.
const MODELS = {
  small: "onnx-community/depth-anything-v2-small",
  base: "onnx-community/depth-anything-v2-base",
  large: "onnx-community/depth-anything-v2-large",
} as const;
export type DepthModel = keyof typeof MODELS; // "small" | "base" | "large"

// In Electron la Cache API del browser fallisce ("Failed to execute 'open' on 'CacheStorage'").
// Disattiviamo la cache browser e usiamo la cache HTTP su disco di Electron:
// i pesi del modello restano in cache tra le sessioni (niente ri-download del Large).
if (typeof window !== "undefined" && (window as any).reliefforge?.isElectron) {
  try { (env as any).useBrowserCache = false; } catch { /* noop */ }
}

export type DepthSource = string | HTMLCanvasElement | ImageData | HTMLImageElement;

export interface EstimateDepthOptions {
  /** Inverti la profondita' (Depth Anything da' "vicino = alto"; default false). */
  invert?: boolean;
  /** Callback di avanzamento del download/caricamento modello (0..1 se disponibile). */
  onProgress?: (info: { status: string; progress?: number; file?: string }) => void;
  /** Forza il device. Default: prova "webgpu", poi "wasm". */
  device?: "webgpu" | "wasm";
  /** Modello: "small" (veloce) o "base" (qualità alta). Default "small". */
  model?: DepthModel;
}

export interface DepthResult {
  normF32: Float32Array;
  w: number;
  h: number;
  device: "webgpu" | "wasm";
}

type DepthPipeline = Awaited<ReturnType<typeof pipeline>>;

type LoadedPipe = { pipe: DepthPipeline; device: "webgpu" | "wasm" };

// Cache separata PER MODELLO: cambiare qualità non ricarica l'altro modello.
const cache: Partial<Record<DepthModel, LoadedPipe>> = {};
const loadingMap: Partial<Record<DepthModel, Promise<LoadedPipe>>> = {};

function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function loadPipeline(opts: EstimateDepthOptions): Promise<LoadedPipe> {
  const model: DepthModel = opts.model ?? "small";
  const modelId = MODELS[model];

  if (cache[model]) return cache[model]!;
  if (loadingMap[model]) return loadingMap[model]!;

  const wantGpu = (opts.device ?? (webgpuAvailable() ? "webgpu" : "wasm")) === "webgpu";

  const p = (async (): Promise<LoadedPipe> => {
    const progress = (pr: any) =>
      opts.onProgress?.({ status: pr.status, progress: pr.progress, file: pr.file });

    try {
      if (wantGpu && webgpuAvailable()) {
        const pipe = await pipeline("depth-estimation", modelId, {
          device: "webgpu",
          dtype: "fp16",
          progress_callback: progress,
        });
        const r: LoadedPipe = { pipe, device: "webgpu" };
        cache[model] = r;
        return r;
      }
    } catch (e) {
      // se WebGPU fallisce (driver/browser) si ripiega su WASM
      console.warn("[estimateDepth] WebGPU non disponibile, fallback WASM:", e);
    }

    const pipe = await pipeline("depth-estimation", modelId, {
      device: "wasm",
      dtype: "q8",
      progress_callback: progress,
    });
    const r: LoadedPipe = { pipe, device: "wasm" };
    cache[model] = r;
    return r;
  })();

  loadingMap[model] = p;
  try {
    return await p;
  } finally {
    loadingMap[model] = undefined;
  }
}

async function toRawImage(src: DepthSource): Promise<RawImage> {
  if (typeof src === "string") return await RawImage.fromURL(src);
  if (src instanceof ImageData) {
    return new RawImage(new Uint8ClampedArray(src.data), src.width, src.height, 4);
  }
  // HTMLCanvasElement | HTMLImageElement -> via canvas
  const canvas =
    src instanceof HTMLCanvasElement ? src : drawToCanvas(src as HTMLImageElement);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new RawImage(new Uint8ClampedArray(id.data), canvas.width, canvas.height, 4);
}

function drawToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}

/** (Opzionale) precarica il modello, utile per mostrare il progress prima dell'uso. */
export async function warmupDepthModel(opts: EstimateDepthOptions = {}): Promise<void> {
  await loadPipeline(opts);
}

/** Copia/converte un buffer numerico in Float32Array. */
function toFloat32(d: ArrayLike<number>): Float32Array {
  if (d instanceof Float32Array) return d;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i];
  return out;
}

/** Normalizza min..max -> [0..1] (con eventuale inversione). */
function normalize01(src: Float32Array, invert: boolean): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1e-9, hi - lo);
  const out = new Float32Array(src.length);
  if (invert) {
    for (let i = 0; i < src.length; i++) out[i] = 1 - (src[i] - lo) / span;
  } else {
    for (let i = 0; i < src.length; i++) out[i] = (src[i] - lo) / span;
  }
  return out;
}

/** Upsampling bilineare mantenendo la precisione float (no quantizzazione). */
function bilinearResample(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Float32Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    let fy = (y + 0.5) * sy - 0.5;
    if (fy < 0) fy = 0;
    else if (fy > sh - 1) fy = sh - 1;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      if (fx < 0) fx = 0;
      else if (fx > sw - 1) fx = sw - 1;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      const top = a + (b - a) * wx;
      const bot = c + (d - c) * wx;
      out[y * dw + x] = top + (bot - top) * wy;
    }
  }
  return out;
}

export async function estimateDepth(
  src: DepthSource,
  opts: EstimateDepthOptions = {}
): Promise<DepthResult> {
  const { pipe, device } = await loadPipeline(opts);
  const image = await toRawImage(src);

  // La pipeline ritorna { depth: RawImage (uint8 grayscale), predicted_depth: Tensor (float) }.
  const out: any = await (pipe as any)(image);

  const targetW = image.width;
  const targetH = image.height;
  const invert = opts.invert ?? false;

  // PERCORSO PREFERITO: usa il tensore float `predicted_depth` invece della
  // RawImage `depth` quantizzata a 8-bit. Evita il terrazzamento (banding a 256
  // livelli) sulle superfici lisce. Upsampling bilineare in float fino alla
  // risoluzione d'ingresso, poi normalizzazione min..max -> [0..1].
  const pd: any = out?.predicted_depth;
  if (pd && pd.data && pd.dims && pd.dims.length >= 2) {
    const dims = Array.from(pd.dims as ArrayLike<number>).map(Number);
    const mw = dims[dims.length - 1];
    const mh = dims[dims.length - 2];
    const src32 = toFloat32(pd.data as ArrayLike<number>);
    if (mw > 0 && mh > 0 && src32.length >= mw * mh) {
      const up = bilinearResample(src32, mw, mh, targetW, targetH);
      const norm = normalize01(up, invert);
      return { normF32: norm, w: targetW, h: targetH, device };
    }
  }

  // FALLBACK: vecchio percorso a 8-bit, se `predicted_depth` non è disponibile.
  const depthImg: RawImage = out.depth;
  const w = depthImg.width;
  const h = depthImg.height;
  const data = depthImg.data as Uint8Array | Uint8ClampedArray; // channels === 1
  const f = new Float32Array(w * h);
  if (invert) {
    for (let i = 0; i < f.length; i++) f[i] = 1 - data[i] / 255;
  } else {
    for (let i = 0; i < f.length; i++) f[i] = data[i] / 255;
  }
  return { normF32: f, w, h, device };
}

export { env as transformersEnv };
