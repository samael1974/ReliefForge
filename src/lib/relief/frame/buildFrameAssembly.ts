// src/lib/relief/frame/buildFrameAssembly.ts
//
// Cornice + passepartout ASSEMBLATI nella stessa convenzione del rilievo.
//
// Problema risolto: buildSolidFromHeightmap costruisce il rilievo nel piano XY
// con lo spessore lungo Z ("in piedi"). I vecchi builder cornice/passepartout
// usavano un piano diverso (sdraiato) -> finivano appoggiati al piano.
//
// Qui passepartout e cornice sono ANELLI RETTANGOLARI concentrici nel piano XY
// estrusi lungo Z, centrati sull'impronta del rilievo. Tutte le mesh vanno
// aggiunte a un unico <group position={[0,0,0]}> (l'allineamento e' nelle coord).

import * as THREE from "three";

/** Una barra (parallelepipedo) nel piano XY estrusa lungo Z. */
function bar(w: number, h: number, depth: number, cx: number, cy: number, cz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, depth);
  g.translate(cx, cy, cz);
  return g;
}

/** Unisce piu' BoxGeometry in un'unica BufferGeometry indicizzata (position+normal). */
function mergeBars(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let off = 0;
  for (const g of geoms) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    const idx = g.getIndex();
    if (!p || !n || !idx) throw new Error("mergeBars: geometry senza position/normal/index");
    for (let i = 0; i < p.array.length; i++) positions.push(p.array[i] as number);
    for (let i = 0; i < n.array.length; i++) normals.push(n.array[i] as number);
    for (let i = 0; i < idx.array.length; i++) indices.push((idx.array[i] as number) + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  out.setIndex(indices);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export interface RectRingOptions {
  apertureW: number;   // larghezza apertura (mm) = impronta X del rilievo
  apertureH: number;   // altezza apertura (mm) = impronta Y del rilievo
  band: number;        // larghezza fascia attorno all'apertura (mm)
  depthMm: number;     // estrusione lungo Z (mm)
  centerX?: number;    // default 0 (rilievo centrato in X)
  centerY?: number;    // default apertureH/2 (rilievo ha Y in [0..H])
  backZ?: number;      // Z faccia posteriore (default 0)
}

/** Anello rettangolare (cornice/passepartout) nel piano XY, foro = apertura, estruso lungo Z. */
export function buildRectRing(opts: RectRingOptions): THREE.BufferGeometry {
  const { apertureW: aw, apertureH: ah, band, depthMm } = opts;
  if (!(aw > 0 && ah > 0 && band > 0 && depthMm > 0)) {
    throw new Error("buildRectRing: apertureW/apertureH/band/depthMm devono essere > 0");
  }
  const cx = opts.centerX ?? 0;
  const cy = opts.centerY ?? ah / 2;
  const cz = (opts.backZ ?? 0) + depthMm / 2;

  const outerW = aw + 2 * band;
  const bars: THREE.BufferGeometry[] = [];
  bars.push(bar(outerW, band, depthMm, cx, cy + ah / 2 + band / 2, cz)); // top
  bars.push(bar(outerW, band, depthMm, cx, cy - ah / 2 - band / 2, cz)); // bottom
  bars.push(bar(band, ah, depthMm, cx - aw / 2 - band / 2, cy, cz));     // left
  bars.push(bar(band, ah, depthMm, cx + aw / 2 + band / 2, cy, cz));     // right
  return mergeBars(bars);
}

export interface FrameAssemblyInput {
  reliefW: number;          // reliefPlan.w
  reliefH: number;          // reliefPlan.h
  reliefDepthMm: number;    // baseMm + depthMm (per allineare la Z)
  passepartout?: { band: number; thicknessMm: number } | null;
  cornice?: { band: number; depthMm: number } | null;
}

export interface FrameAssemblyOutput {
  passepartout: THREE.BufferGeometry | null;
  cornice: THREE.BufferGeometry | null;
  centerY: number;
}

/** Passepartout e cornice concentrici, da aggiungere allo stesso group del rilievo a [0,0,0]. */
export function buildFrameAssembly(input: FrameAssemblyInput): FrameAssemblyOutput {
  const { reliefW: W, reliefH: H, reliefDepthMm: D } = input;
  const centerY = H / 2;
  const backZ = -D / 2;
  const matBand = input.passepartout?.band ?? 0;

  let passepartout: THREE.BufferGeometry | null = null;
  let cornice: THREE.BufferGeometry | null = null;

  if (input.passepartout) {
    passepartout = buildRectRing({
      apertureW: W, apertureH: H,
      band: input.passepartout.band, depthMm: input.passepartout.thicknessMm,
      centerY, backZ,
    });
  }
  if (input.cornice) {
    cornice = buildRectRing({
      apertureW: W + 2 * matBand, apertureH: H + 2 * matBand,
      band: input.cornice.band, depthMm: input.cornice.depthMm,
      centerY, backZ,
    });
  }
  return { passepartout, cornice, centerY };
}
