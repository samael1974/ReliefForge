// src/lib/relief/buildAdaptiveSolid.ts
//
// Mesher ADATTIVO per heightmap (V8.5).
//
// Perche' esiste: buildSolidFromHeightmap emette 2 triangoli per ogni cella della
// griglia, uniformemente. Su una placca 93x63 mm significava 1.131.856 triangoli e
// 56,6 MB di STL — triangoli da ~0,1 mm con ugelli da 0,4 mm. Lo sfondo piatto di un
// ritratto costava esattamente quanto l'iride.
//
// Qui la densita' segue il DETTAGLIO: quadtree ristretto (bilanciato 2:1) guidato
// dall'errore geometrico reale in millimetri. Zone piatte -> pochi triangoli grandi;
// zone incise -> risoluzione piena. L'utente ragiona in "tolleranza mm", non in celle.
//
// La mesh e' chiusa e senza T-junction per costruzione:
//  * il bilanciamento 2:1 garantisce che un lato confini al massimo con 2 foglie piu' fini;
//  * ogni foglia si triangola a ventaglio dal centro, inserendo il punto medio sui soli
//    lati dove il vicino e' piu' fine -> i vertici combaciano sempre.
//
// Convenzioni (identiche a buildSolidFromHeightmap, per non toccare l'allineamento
// con cornice/passepartout): X = larghezza, Y = altezza con py = -(yStart + y*dy),
// Z = rilievo, retro piano a z=0, winding invertito da pushTri.

import * as THREE from "three";
import type { BaseStyle } from "./reliefTypes";
import { resampleHeightmapTo } from "./heightmapMesh";

export type BuildAdaptiveSolidInput = {
  height01: Float32Array;
  width: number;
  height: number;

  outWidthMm: number;
  depthMm: number;
  baseMm: number;
  baseStyle: BaseStyle;

  /** Errore geometrico massimo ammesso fra mesh e heightmap (mm). Piu' basso = piu' triangoli. */
  toleranceMm: number;

  invert?: boolean;
  clampHeights?: boolean;
  minBaseMm?: number;
  /** Livelli di suddivisione sotto il blocco radice. Blocco radice = 2^maxDepth celle. */
  maxDepth?: number;
  /** Tetto alla griglia di lavoro (celle). Oltre, la heightmap viene ricampionata. */
  maxCells?: number;
};

export type AdaptiveSolidStats = {
  /** Griglia effettivamente usata. */
  gridW: number;
  gridH: number;
  /** Triangoli emessi (totale solido). */
  triangles: number;
  /** Triangoli che avrebbe emesso la griglia uniforme sulla stessa risoluzione. */
  uniformTriangles: number;
  /** Fattore di alleggerimento. */
  reduction: number;
  toleranceMm: number;
};

export type BuildAdaptiveSolidOutput = {
  geometry: THREE.BufferGeometry;
  vertices: Float32Array;
  indices: Uint32Array;
  stats: AdaptiveSolidStats;
};

function clamp01(x: number) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export function buildAdaptiveSolidFromHeightmap(
  input: BuildAdaptiveSolidInput
): BuildAdaptiveSolidOutput {
  const {
    outWidthMm, depthMm, baseMm, baseStyle,
    invert = false, clampHeights = true, minBaseMm = 0.4,
    maxDepth = 4, maxCells = 1_200_000,
  } = input;

  if (!(outWidthMm > 0)) throw new Error("outWidthMm must be > 0.");
  if (!(depthMm >= 0)) throw new Error("depthMm must be >= 0.");
  if (!(baseMm >= 0)) throw new Error("baseMm must be >= 0.");

  const D = Math.max(1, Math.min(8, Math.round(maxDepth)));
  const S = 1 << D; // celle per blocco radice

  // --- 1) Griglia di lavoro (Bx·S + 1) × (By·S + 1) ---
  // ceil, non round: la griglia di lavoro non deve MAI essere piu' rada della
  // heightmap sorgente, altrimenti si perde dettaglio prima ancora di triangolare
  // e l'errore finale non scende piu' sotto una soglia, per quanto si stringa la
  // tolleranza (il ricampionamento smussa incisioni nette come gli occhi).
  let Bx = Math.max(1, Math.ceil((input.width - 1) / S));
  let By = Math.max(1, Math.ceil((input.height - 1) / S));
  while ((Bx * S + 1) * (By * S + 1) > maxCells && (Bx > 1 || By > 1)) {
    if (Bx >= By && Bx > 1) Bx--; else if (By > 1) By--; else break;
  }
  const W = Bx * S + 1;
  const H = By * S + 1;

  const src = resampleHeightmapTo({ normF32: input.height01, w: input.width, h: input.height }, W, H);

  const Z = new Float32Array(W * H);
  for (let i = 0; i < Z.length; i++) {
    let v = src.normF32[i]!;
    if (clampHeights) v = clamp01(v);
    if (invert) v = 1 - v;
    Z[i] = v;
  }

  // --- 2) Errore per blocco, per livello ---
  // err[d][j*bw + i] = massimo scostamento (unita' normalizzate) fra la heightmap e
  // l'interpolazione bilineare dai 4 angoli del blocco.
  const tolNorm = depthMm > 1e-9 ? Math.max(1e-6, input.toleranceMm / depthMm) : Infinity;

  const sub: Uint8Array[] = [];
  for (let d = 0; d <= D; d++) sub.push(new Uint8Array((Bx << d) * (By << d)));

  for (let d = 0; d < D; d++) {
    const bw = Bx << d, bh = By << d;
    const s = S >> d;
    for (let bj = 0; bj < bh; bj++) {
      for (let bi = 0; bi < bw; bi++) {
        const x0 = bi * s, y0 = bj * s;
        const z00 = Z[y0 * W + x0]!;
        const z10 = Z[y0 * W + x0 + s]!;
        const z01 = Z[(y0 + s) * W + x0]!;
        const z11 = Z[(y0 + s) * W + x0 + s]!;
        let maxErr = 0;
        for (let v = 0; v <= s; v++) {
          const fy = v / s;
          const zi0 = z00 + (z01 - z00) * fy;
          const zi1 = z10 + (z11 - z10) * fy;
          const row = (y0 + v) * W + x0;
          for (let u = 0; u <= s; u++) {
            const fx = u / s;
            const interp = zi0 + (zi1 - zi0) * fx;
            const e = Math.abs(Z[row + u]! - interp);
            if (e > maxErr) maxErr = e;
          }
          if (maxErr > tolNorm) { v = s; } // early-out: gia' oltre tolleranza
        }
        if (maxErr > tolNorm) sub[d]![bj * bw + bi] = 1;
      }
    }
  }

  // Monotonia: se un figlio si suddivide, il padre DEVE suddividersi.
  for (let d = D - 1; d >= 1; d--) {
    const bw = Bx << d, bh = By << d;
    const pw = Bx << (d - 1);
    for (let bj = 0; bj < bh; bj++) {
      for (let bi = 0; bi < bw; bi++) {
        if (sub[d]![bj * bw + bi]) sub[d - 1]![(bj >> 1) * pw + (bi >> 1)] = 1;
      }
    }
  }

  // --- 3) Livello della foglia su griglia fine (Bx·S × By·S celle) ---
  const FW = Bx * S, FH = By * S;
  const level = new Uint8Array(FW * FH);
  for (let fj = 0; fj < FH; fj++) {
    for (let fi = 0; fi < FW; fi++) {
      let d = 0;
      while (d < D) {
        const bw = Bx << d;
        const bi = fi >> (D - d), bj = fj >> (D - d);
        if (!sub[d]![bj * bw + bi]) break;
        d++;
      }
      level[fj * FW + fi] = d;
    }
  }

  // --- 4) Bilanciamento 2:1 ---
  // Due foglie che condividono un lato non possono differire di piu' di un livello.
  for (let pass = 0; pass < D + 2; pass++) {
    let changed = false;
    for (let fj = 0; fj < FH; fj++) {
      for (let fi = 0; fi < FW; fi++) {
        const cur = level[fj * FW + fi]!;
        let need = cur;
        if (fi > 0) { const n = level[fj * FW + fi - 1]!; if (n - 1 > need) need = n - 1; }
        if (fi < FW - 1) { const n = level[fj * FW + fi + 1]!; if (n - 1 > need) need = n - 1; }
        if (fj > 0) { const n = level[(fj - 1) * FW + fi]!; if (n - 1 > need) need = n - 1; }
        if (fj < FH - 1) { const n = level[(fj + 1) * FW + fi]!; if (n - 1 > need) need = n - 1; }
        if (need > cur) {
          // Alza l'INTERA foglia che contiene (fi,fj), non la singola cella.
          const k = 1 << (D - cur);
          const i0 = (fi >> (D - cur)) << (D - cur);
          const j0 = (fj >> (D - cur)) << (D - cur);
          for (let j = j0; j < j0 + k; j++) {
            for (let i = i0; i < i0 + k; i++) level[j * FW + i] = need;
          }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // --- 5) Geometria ---
  const base = Math.max(minBaseMm, baseMm);
  // ⚠️ L'altezza in mm viene dall'aspetto della heightmap ORIGINALE, non dalla griglia
  // di lavoro. La griglia e' quantizzata a multipli di S, quindi il suo aspetto e'
  // arrotondato: usarlo qui rimpicciolirebbe la placca di ~1 mm e la cornice — che
  // e' dimensionata sulla stessa formula di buildSolidFromHeightmap — non combacerebbe piu'.
  const outHeightMm = outWidthMm * ((input.height - 1) / (input.width - 1));
  const dxMm = outWidthMm / (W - 1);
  const dyMm = outHeightMm / (H - 1);
  const xStart = -outWidthMm / 2;
  const yStart = -outHeightMm / 2;

  const zTopOf = (gx: number, gy: number) => {
    const v01 = Z[gy * W + gx]!;
    if (baseStyle === "flat") return base + depthMm * v01;
    if (baseStyle === "recessed") { const z = base - depthMm * v01; return z < 0 ? 0 : z; }
    return depthMm * v01; // "offset" senza guscio: retro piano
  };

  const positions: number[] = [];
  const indices: number[] = [];
  const vidx = new Int32Array(W * H).fill(-1);

  const topVertex = (gx: number, gy: number) => {
    const key = gy * W + gx;
    let id = vidx[key]!;
    if (id >= 0) return id;
    id = positions.length / 3;
    positions.push(xStart + gx * dxMm, -(yStart + gy * dyMm), zTopOf(gx, gy));
    vidx[key] = id;
    return id;
  };

  // Winding invertito, esattamente come buildSolidFromHeightmap.
  const pushTri = (a: number, b: number, c: number) => { indices.push(a, c, b); };

  /** Livello massimo delle celle immediatamente FUORI da un lato della foglia. */
  const outerMaxLevel = (i0: number, j0: number, k: number, side: 0 | 1 | 2 | 3) => {
    let m = -1;
    if (side === 0) {                    // bordo inferiore (y = j0)
      if (j0 === 0) return -1;
      for (let i = i0; i < i0 + k; i++) { const v = level[(j0 - 1) * FW + i]!; if (v > m) m = v; }
    } else if (side === 1) {             // bordo destro (x = i0 + k)
      if (i0 + k >= FW) return -1;
      for (let j = j0; j < j0 + k; j++) { const v = level[j * FW + i0 + k]!; if (v > m) m = v; }
    } else if (side === 2) {             // bordo superiore (y = j0 + k)
      if (j0 + k >= FH) return -1;
      for (let i = i0; i < i0 + k; i++) { const v = level[(j0 + k) * FW + i]!; if (v > m) m = v; }
    } else {                             // bordo sinistro (x = i0)
      if (i0 === 0) return -1;
      for (let j = j0; j < j0 + k; j++) { const v = level[j * FW + i0 - 1]!; if (v > m) m = v; }
    }
    return m;
  };

  let leafCount = 0;
  for (let fj = 0; fj < FH; fj++) {
    for (let fi = 0; fi < FW; fi++) {
      const d = level[fj * FW + fi]!;
      const k = 1 << (D - d);
      if (fi % k !== 0 || fj % k !== 0) continue; // non e' l'angolo della foglia
      leafCount++;

      const x0 = fi, y0 = fj, s = k;

      if (s === 1) {
        // Foglia di una sola cella: nessun vicino puo' essere piu' fine.
        const a = topVertex(x0, y0);
        const b = topVertex(x0 + 1, y0);
        const c = topVertex(x0, y0 + 1);
        const e = topVertex(x0 + 1, y0 + 1);
        pushTri(a, b, e);
        pushTri(a, e, c);
        continue;
      }

      const h = s >> 1;
      const ring: number[] = [];
      // Perimetro in ordine CCW nello spazio griglia, con i punti medi solo dove serve.
      ring.push(topVertex(x0, y0));
      if (outerMaxLevel(x0, y0, s, 0) > d) ring.push(topVertex(x0 + h, y0));
      ring.push(topVertex(x0 + s, y0));
      if (outerMaxLevel(x0, y0, s, 1) > d) ring.push(topVertex(x0 + s, y0 + h));
      ring.push(topVertex(x0 + s, y0 + s));
      if (outerMaxLevel(x0, y0, s, 2) > d) ring.push(topVertex(x0 + h, y0 + s));
      ring.push(topVertex(x0, y0 + s));
      if (outerMaxLevel(x0, y0, s, 3) > d) ring.push(topVertex(x0, y0 + h));

      const centre = topVertex(x0 + h, y0 + h);
      for (let t = 0; t < ring.length; t++) {
        pushTri(centre, ring[t]!, ring[(t + 1) % ring.length]!);
      }
    }
  }

  // --- 6) Perimetro, fianchi e retro ---
  // I vertici del bordo effettivamente usati, in ordine CCW nello spazio griglia.
  const boundary: number[] = [];
  const pushBoundary = (gx: number, gy: number) => {
    const id = vidx[gy * W + gx]!;
    if (id >= 0 && boundary[boundary.length - 1] !== id) boundary.push(id);
  };
  for (let x = 0; x < W; x++) pushBoundary(x, 0);
  for (let y = 1; y < H; y++) pushBoundary(W - 1, y);
  for (let x = W - 2; x >= 0; x--) pushBoundary(x, H - 1);
  for (let y = H - 2; y >= 1; y--) pushBoundary(0, y);
  if (boundary.length > 1 && boundary[0] === boundary[boundary.length - 1]) boundary.pop();

  // Vertici del retro: uno per ciascun punto del perimetro, a z = 0.
  const bottom: number[] = [];
  for (const id of boundary) {
    const o = id * 3;
    const nid = positions.length / 3;
    positions.push(positions[o]!, positions[o + 1]!, 0);
    bottom.push(nid);
  }
  const bottomCentre = positions.length / 3;
  positions.push(0, 0, 0);

  // Fianchi: per il tratto P->Q del perimetro CCW.
  for (let t = 0; t < boundary.length; t++) {
    const u = (t + 1) % boundary.length;
    const P = boundary[t]!, Q = boundary[u]!;
    const Pb = bottom[t]!, Qb = bottom[u]!;
    pushTri(Q, P, Pb);
    pushTri(Q, Pb, Qb);
  }

  // Retro piano: ventaglio dal centro (il perimetro e' un rettangolo, quindi convesso).
  for (let t = 0; t < boundary.length; t++) {
    const u = (t + 1) % boundary.length;
    pushTri(bottomCentre, bottom[u]!, bottom[t]!);
  }

  const verts = new Float32Array(positions);
  const idx = new Uint32Array(indices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const triangles = idx.length / 3;
  const perimeter = 2 * (W + H) - 4;
  const uniformTriangles = 2 * (W - 1) * (H - 1) + perimeter + 2 * perimeter;

  return {
    geometry,
    vertices: verts,
    indices: idx,
    stats: {
      gridW: W, gridH: H,
      triangles,
      uniformTriangles,
      reduction: uniformTriangles / Math.max(1, triangles),
      toleranceMm: input.toleranceMm,
    },
  };
}
