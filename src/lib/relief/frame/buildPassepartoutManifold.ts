// src/lib/relief/frame/buildPassepartoutManifold.ts
//
// Passepartout a gradoni φ come solido MANIFOLD, per l'export STL.
//
// Perche' esiste (V8.5): fino alla 8.4 l'export NON esportava un passepartout.
// Costruiva un `Manifold.cube` — una lastra PIENA, senza foro — dietro al rilievo e
// la fondeva con `.add()`. In anteprima invece si vedeva `buildPassepartoutRectPhi`,
// cioe' un anello a gradoni CON apertura. Due oggetti completamente diversi: e' il
// motivo per cui il bassorilievo finiva "inglobato nel passepartout" nel file stampato.
//
// Qui si ricostruisce la stessa geometria dell'anteprima con primitive manifold, quindi
// watertight e booleanamente componibile con cornice e rilievo.
//
// Coordinate locali (identiche alla mesh di anteprima):
//   faccia frontale del gradone piu' interno a z = 0, materiale verso -Z fino a -thickness.
//   I gradoni successivi (verso l'esterno) arretrano di stepDrop ciascuno.
// Il chiamante trasla il solido su (0, centerY, matFrontZ).

import { passepartoutBandsMm } from "./buildPassepartoutRectPhi";
import { roundedBoxSpanZ } from "./manifoldPrimitives";

export type PassepartoutManifoldParams = {
  /** Apertura interna (foro) in X, mm. */
  innerWmm: number;
  /** Apertura interna (foro) in Y, mm. */
  innerHmm: number;
  steps: 1 | 2 | 3 | 4 | 5 | 6;
  totalBandsMm: number;
  minBandMm: number;
  /** Spessore della lastra (mm), verso -Z. */
  thicknessMm: number;
  /** Arretramento di ciascun gradone rispetto al precedente (mm). */
  stepDropMm: number;
  phiRatio?: number;
};

/** Spessore minimo di lastra che deve restare sotto il gradone piu' arretrato. */
const MIN_SLAB_MM = 0.6;

export function buildPassepartoutManifold(wasm: any, p: PassepartoutManifoldParams): any {
  const innerW = Math.max(1, p.innerWmm);
  const innerH = Math.max(1, p.innerHmm);
  const steps = Math.max(1, Math.min(6, Math.round(p.steps ?? 1)));
  const thickness = Math.max(0.8, p.thicknessMm);

  const bands = passepartoutBandsMm({
    steps: steps as 1 | 2 | 3 | 4 | 5 | 6,
    totalBandsMm: p.totalBandsMm,
    minBandMm: p.minBandMm,
    phiRatio: p.phiRatio,
  });

  // I gradoni non possono scavare piu' della lastra: l'ultimo deve lasciare MIN_SLAB_MM.
  const maxDrop = steps > 1 ? Math.max(0, thickness - MIN_SLAB_MM) / (steps - 1) : 0;
  const stepDrop = Math.max(0, Math.min(p.stepDropMm ?? 0, maxDrop));

  const zBottom = -thickness;

  let acc: any = null;
  let outerW = innerW;
  let outerH = innerH;

  for (let i = 0; i < steps; i++) {
    outerW += 2 * (bands[i] ?? 0);
    outerH += 2 * (bands[i] ?? 0);
    const topZ = -i * stepDrop;
    // Ogni gradone e' una lastra piena dal fondo fino alla propria quota: l'unione
    // di lastre via via piu' larghe e piu' basse produce il terrazzamento.
    const slab = roundedBoxSpanZ(wasm, outerW, outerH, zBottom, topZ, 0);
    acc = acc ? acc.add(slab) : slab;
  }

  // Foro passante: si scava alla fine, cosi' l'apertura resta netta su tutti i gradoni.
  const hole = roundedBoxSpanZ(wasm, innerW, innerH, zBottom - 1, 1, 0);
  return acc.subtract(hole);
}

/** Ingombro esterno (mm) del passepartout costruito con gli stessi parametri. */
export function passepartoutManifoldOuterSize(p: PassepartoutManifoldParams): { w: number; h: number } {
  const total = passepartoutBandsMm({
    steps: p.steps, totalBandsMm: p.totalBandsMm, minBandMm: p.minBandMm, phiRatio: p.phiRatio,
  }).reduce((s, x) => s + x, 0);
  return { w: Math.max(1, p.innerWmm) + 2 * total, h: Math.max(1, p.innerHmm) + 2 * total };
}
