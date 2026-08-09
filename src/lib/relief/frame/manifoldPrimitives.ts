// src/lib/relief/frame/manifoldPrimitives.ts
//
// Primitive manifold-3d condivise fra cornice, passepartout e ritagli.
// Erano duplicate dentro reliefStl.ts: qui stanno una volta sola.

/** Segmenti per angolo a 90 gradi. 24 = curve lisce anche con raggi grandi (12mm+). */
export const FRAME_CORNER_SEGMENTS = 24;

/**
 * Box manifold estruso lungo Z, centrato sull'origine, con angoli (XY) eventualmente arrotondati.
 * r <= 0 -> cubo a spigoli vivi (veloce). r > 0 -> rounded-rect via CrossSection.offset('Round').
 *
 * ATTENZIONE (bug storico risolto in V8.4): extrude() vuole scaleTop come VETTORE [1, 1].
 * Passare lo scalare 1 in manifold-3d 3.5.1 produce un CUNEO (la faccia superiore
 * collassa su un asse) — era la causa delle cornici deformi negli STL esportati.
 */
export function roundedBox(
  wasm: any,
  w: number,
  h: number,
  depth: number,
  r: number,
  cornerSegments: number = FRAME_CORNER_SEGMENTS
): any {
  const rr = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  if (rr <= 0.01) return wasm.Manifold.cube([w, h, depth], true);
  const coreW = Math.max(0.01, w - 2 * rr);
  const coreH = Math.max(0.01, h - 2 * rr);
  const segs360 = Math.max(16, Math.round(cornerSegments) * 4);
  const cs = wasm.CrossSection.square([coreW, coreH], true).offset(rr, "Round", 2, segs360);
  return cs.extrude(depth, 0, 0, [1, 1], true);
}

/** Box manifold con estensione Z esplicita [z0, z1] (comodo per i piani di assieme). */
export function roundedBoxSpanZ(
  wasm: any,
  w: number,
  h: number,
  z0: number,
  z1: number,
  r: number,
  cornerSegments: number = FRAME_CORNER_SEGMENTS
): any {
  const lo = Math.min(z0, z1);
  const hi = Math.max(z0, z1);
  const depth = Math.max(1e-4, hi - lo);
  return roundedBox(wasm, w, h, depth, r, cornerSegments).translate([0, 0, (lo + hi) / 2]);
}
