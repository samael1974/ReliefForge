// src/lib/relief/frame/manifoldPrimitives.ts
//
// Primitive manifold-3d condivise fra cornice, passepartout e ritagli.
// Erano duplicate dentro reliefStl.ts: qui stanno una volta sola.

/** Segmenti per angolo a 90 gradi. 24 = curve lisce anche con raggi grandi (12mm+). */
export const FRAME_CORNER_SEGMENTS = 24;

/** Lunghezza di corda desiderata sulle curve (mm). Su un raggio d'angolo di pochi
 *  millimetri 24 segmenti bastano; su una cornice TONDA da 136 mm gli stessi 24
 *  producono corde da 6 mm, cioe' un poligono ben visibile. Il numero di segmenti
 *  va quindi con il raggio, non con l'angolo. */
export const TARGET_CHORD_MM = 1.5;
/** Tetto di sicurezza: oltre non si guadagna nulla di visibile e il CSG rallenta. */
export const MAX_SEGMENTS_360 = 360;

/** Segmenti su 360 gradi per un raggio dato, mai meno del minimo storico. */
export function segmentsForRadius(radiusMm: number, minSegments360: number): number {
  const byChord = Math.ceil((2 * Math.PI * Math.max(0, radiusMm)) / TARGET_CHORD_MM);
  return Math.max(minSegments360, Math.min(MAX_SEGMENTS_360, byChord));
}

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
  const segs360 = segmentsForRadius(rr, Math.max(16, Math.round(cornerSegments) * 4));
  const cs = wasm.CrossSection.square([coreW, coreH], true).offset(rr, "Round", 2, segs360);
  return cs.extrude(depth, 0, 0, [1, 1], true);
}

/** Estrude un contorno qualunque (ellisse, poligono, ...) lungo Z, centrato in z=0.
 *  Serve alle forme che non sono rettangoli: per quelle resta roundedBox, che e'
 *  gia' collaudata e non ha motivo di cambiare. */
export function extrudeOutline(wasm: any, pts: Array<{ x: number; z: number }>, depth: number): any {
  const poly = pts.map((p) => [p.x, p.z]);
  const cs = new wasm.CrossSection([poly], "Positive");
  return cs.extrude(Math.max(1e-4, depth), 0, 0, [1, 1], true);
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
