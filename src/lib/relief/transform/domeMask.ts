// src/lib/relief/transform/domeMask.ts
//
// Maschera "bombato / incavo" (convex / concave) per ReliefForge.
//
// Opera sull'heightmap normalizzata (Float32Array in [0..1]) PRIMA della
// costruzione della mesh: non tocca STL/manifold. Aggiunge alla superficie
// un profilo a cupola (convex) o a conca (concave), eventualmente limitato a
// una maschera per-pixel (es. dipinta dall'utente con un pennello).
//
// Modello: heightFinal = relief + sign * amount * dome(x,y) * mask(x,y)
//   - convex  -> sign = +1 (la zona si gonfia verso l'esterno)
//   - concave -> sign = -1 (la zona rientra)
// Dopo la somma si ri-normalizza opzionalmente in [0..1] per non perdere
// dettaglio per clipping (consigliato true).

export type DomeMode = "off" | "convex" | "concave";
export type DomeProfile = "spherical" | "parabolic" | "cosine";

export interface DomeOptions {
  mode: DomeMode;
  /** Ampiezza della cupola in unita' normalizzate (0..1). Default 0.6. */
  amount?: number;
  /** Profilo della curva. Default "spherical". */
  profile?: DomeProfile;
  /**
   * Raggio del falloff relativo alla mezza-diagonale dell'immagine (0..1].
   * 1 = la cupola copre tutta l'immagine; valori piu' piccoli = bolla centrale.
   * Default 1.
   */
  radius?: number;
  /** Centro X della cupola in [0..1]. Default 0.5. */
  centerX?: number;
  /** Centro Y della cupola in [0..1]. Default 0.5. */
  centerY?: number;
  /**
   * Maschera per-pixel opzionale (length = w*h, valori 0..1). Se assente, la
   * cupola viene applicata uniformemente (modulata solo dal profilo radiale).
   */
  mask?: Float32Array | null;
  /** Ri-normalizza il risultato in [0..1] dopo la somma. Default true. */
  renormalize?: boolean;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Profilo della cupola dato t = distanza normalizzata dal centro (0 al centro, 1 al bordo del raggio). */
function domeValue(t: number, profile: DomeProfile): number {
  if (t >= 1) return 0;
  switch (profile) {
    case "parabolic":
      return 1 - t * t;
    case "cosine":
      return 0.5 * (1 + Math.cos(Math.PI * t));
    case "spherical":
    default:
      return Math.sqrt(Math.max(0, 1 - t * t));
  }
}

/**
 * Costruisce una maschera radiale morbida (utile come default senza editor a pennello,
 * o come base da moltiplicare con una maschera dipinta).
 */
export function buildRadialMask(
  w: number,
  h: number,
  opts: { centerX?: number; centerY?: number; radius?: number; feather?: number } = {}
): Float32Array {
  const cx = (opts.centerX ?? 0.5) * (w - 1);
  const cy = (opts.centerY ?? 0.5) * (h - 1);
  const half = Math.hypot((w - 1) / 2, (h - 1) / 2);
  const R = Math.max(1e-6, (opts.radius ?? 1) * half);
  const feather = clamp01(opts.feather ?? 0.25);
  const inner = R * (1 - feather);

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      let v: number;
      if (d <= inner) v = 1;
      else if (d >= R) v = 0;
      else {
        const t = (d - inner) / Math.max(1e-6, R - inner);
        v = 0.5 * (1 + Math.cos(Math.PI * t));
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Applica la cupola/conca all'heightmap normalizzata.
 * Ritorna un NUOVO Float32Array (non muta l'input).
 */
export function applyDomeMask(
  height01: Float32Array,
  w: number,
  h: number,
  opts: DomeOptions
): Float32Array {
  if (opts.mode === "off") return height01;
  if (height01.length !== w * h) {
    throw new Error("applyDomeMask: height01 length != w*h");
  }

  const amount = Math.max(0, opts.amount ?? 0.6);
  const profile = opts.profile ?? "spherical";
  const sign = opts.mode === "convex" ? 1 : -1;
  const renorm = opts.renormalize ?? true;

  const cx = (opts.centerX ?? 0.5) * (w - 1);
  const cy = (opts.centerY ?? 0.5) * (h - 1);
  const half = Math.hypot((w - 1) / 2, (h - 1) / 2);
  const R = Math.max(1e-6, (opts.radius ?? 1) * half);
  const mask = opts.mask ?? null;

  const out = new Float32Array(height01.length);
  let lo = Infinity;
  let hi = -Infinity;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = Math.hypot(x - cx, y - cy) / R;
      const dome = domeValue(d, profile);
      const m = mask ? clamp01(mask[i]) : 1;
      const v = height01[i] + sign * amount * dome * m;
      out[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  if (!renorm) {
    for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i]);
    return out;
  }

  const span = Math.max(1e-9, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
  return out;
}
