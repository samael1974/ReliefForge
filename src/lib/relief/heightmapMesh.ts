import { gaussianBlurF32 } from "./transform/tonemap";

export type HeightmapGrid = {
  normF32: Float32Array;
  w: number;
  h: number;
};

export type MeshProfile = "balanced" | "fine" | "maximum";

export const MESH_PROFILES: Record<MeshProfile, {
  label: string;
  description: string;
  previewCells: number;
  exportCells: number;
  /** V8.5: errore geometrico massimo (mm) per il mesher adattivo dell'export. */
  toleranceMm: number;
}> = {
  balanced: {
    label: "Bilanciato",
    description: "Tolleranza 0,12 mm: STL molto leggero, adatto alla maggior parte delle stampe.",
    previewCells: 180_000,
    exportCells: 300_000,
    toleranceMm: 0.12,
  },
  fine: {
    label: "Fine",
    description: "Dettaglio elevato, tolleranza 0,06 mm. Buon compromesso per ritratti.",
    previewCells: 320_000,
    exportCells: 750_000,
    toleranceMm: 0.06,
  },
  maximum: {
    label: "Massima",
    description: "Tolleranza 0,03 mm: massimo dettaglio conservato, file piu' pesante.",
    previewCells: 520_000,
    exportCells: 1_100_000,
    toleranceMm: 0.03,
  },
};

export function resampledSize(w: number, h: number, maxCells: number) {
  const cells = Math.max(4, w * h);
  if (cells <= maxCells) return { w: Math.max(2, w), h: Math.max(2, h), scale: 1 };
  const scale = Math.sqrt(maxCells / cells);
  return {
    w: Math.max(2, Math.round((w - 1) * scale) + 1),
    h: Math.max(2, Math.round((h - 1) * scale) + 1),
    scale,
  };
}

export function effectiveMeshStep(w: number, h: number, maxCells: number) {
  const target = resampledSize(w, h, maxCells);
  return Math.max(1, Math.ceil(Math.max((w - 1) / (target.w - 1), (h - 1) / (target.h - 1))));
}

/**
 * Ridimensiona una heightmap preservando gli estremi della griglia.
 * Prima del bilineare applica un leggero low-pass quando si riduce: evita alias,
 * rumore a scacchiera e perdita casuale di dettagli tipica del vecchio pixel skipping.
 */
export function resampleHeightmapFiltered(hm: HeightmapGrid, maxCells: number): HeightmapGrid {
  const target = resampledSize(hm.w, hm.h, maxCells);
  return resampleHeightmapTo(hm, target.w, target.h);
}

/**
 * Come resampleHeightmapFiltered ma verso una dimensione ESATTA.
 * Serve al mesher adattivo, che ha bisogno di una griglia (Bx·2^D + 1) × (By·2^D + 1).
 */
export function resampleHeightmapTo(hm: HeightmapGrid, targetW: number, targetH: number): HeightmapGrid {
  const target = { w: Math.max(2, Math.round(targetW)), h: Math.max(2, Math.round(targetH)) };
  if (target.w === hm.w && target.h === hm.h) return hm;

  // Low-pass solo quando si riduce: evita alias e rumore a scacchiera.
  const reduction = Math.max(hm.w / target.w, hm.h / target.h);
  const sigma = Math.max(0.55, reduction * 0.42);
  const source = reduction > 1.001
    ? gaussianBlurF32(hm.normF32, hm.w, hm.h, sigma)
    : hm.normF32;
  const out = new Float32Array(target.w * target.h);

  for (let y = 0; y < target.h; y++) {
    const sy = target.h === 1 ? 0 : y * (hm.h - 1) / (target.h - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(hm.h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < target.w; x++) {
      const sx = target.w === 1 ? 0 : x * (hm.w - 1) / (target.w - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(hm.w - 1, x0 + 1);
      const fx = sx - x0;
      const a = source[y0 * hm.w + x0];
      const b = source[y0 * hm.w + x1];
      const c = source[y1 * hm.w + x0];
      const d = source[y1 * hm.w + x1];
      const top = a + (b - a) * fx;
      const bottom = c + (d - c) * fx;
      out[y * target.w + x] = top + (bottom - top) * fy;
    }
  }
  return { normF32: out, w: target.w, h: target.h };
}

export function estimateCompactSolidTriangles(w: number, h: number, offsetBase = false) {
  const top = 2 * (w - 1) * (h - 1);
  const perimeter = 2 * (w + h) - 4;
  const bottom = offsetBase ? top : perimeter;
  const sides = 2 * perimeter;
  return top + bottom + sides;
}

export function formatTriangleCount(value: number) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));
}
