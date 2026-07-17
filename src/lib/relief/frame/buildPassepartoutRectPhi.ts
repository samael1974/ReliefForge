// src/lib/relief/frame/buildPassepartoutRectPhi.ts

export type PassepartoutRectPhiParams = {
  innerWmm: number;
  innerHmm: number;
  steps: 1 | 2 | 3 | 4 | 5 | 6;
  totalBandsMm: number; // totale margine (somma bande)
  thicknessMm: number; // spessore verso il basso (es. 2-3mm)
  stepDropMm: number; // “terrazzamento” top (es. 0.6-1.2mm)
  minBandMm: number; // clamp 5–7 mm
  phiRatio?: number; // default 1.618
};

export type MeshOut = {
  vertices: Float32Array; // xyz xyz...
  indices: Uint32Array;   // triangles
};

const PHI_DEFAULT = 1.61803398875;

type Rect = { hx: number; hy: number }; // half sizes

// ---- Overloads (compatibilità col placeholder Dyad) ----
export function buildPassepartoutRectPhi(width: number, height: number): string;
export function buildPassepartoutRectPhi(params: PassepartoutRectPhiParams): MeshOut;
export function buildPassepartoutRectPhi(a: any, b?: any): any {
  // 1) compat: (width,height) -> string
  if (typeof a === "number" && typeof b === "number") {
    return `Rectangle with width ${a} and height ${b}`;
  }

  // 2) nuova: (params) -> MeshOut
  const p = a as PassepartoutRectPhiParams;

  const innerW = Math.max(1, Number(p.innerWmm));
  const innerH = Math.max(1, Number(p.innerHmm));
  const steps = (p.steps ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;

  const thickness = clamp(Number(p.thicknessMm ?? 2.4), 0.8, 20);
  const stepDrop = clamp(Number(p.stepDropMm ?? 0.8), 0, 10);
  const minBand = clamp(Number(p.minBandMm ?? 6), 1, 50);
  const phi = Number.isFinite(p.phiRatio) ? Number(p.phiRatio) : PHI_DEFAULT;

  // bande phi: band[0] = più interna (piccola), band cresce verso l’esterno
  const totalBandsWanted = clamp(Number(p.totalBandsMm ?? 30), minBand * steps, 1000);
  const bands = computePhiBands(totalBandsWanted, steps, phi, minBand);
  const totalBands = bands.reduce((s, x) => s + x, 0);

  const rects: Rect[] = [];
  // rect[0] = apertura interna (foro)
  rects.push({ hx: innerW / 2, hy: innerH / 2 });

  // rect[i] = confini progressivi
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    acc += bands[i]!;
    rects.push({ hx: innerW / 2 + acc, hy: innerH / 2 + acc });
  }

  // Top levels: anello i ha topZ = -(i)*stepDrop (i=0..steps-1)
  // rect boundary i: serve il muro tra topZ(i-1) e topZ(i) (per i>=1)
  const topZ = (ringIndex: number) => -ringIndex * stepDrop;
  const zBottom = -thickness;

  const V: number[] = [];
  const I: number[] = [];

  // helper: aggiungi vertice
  const addV = (x: number, y: number, z: number) => {
    V.push(x, y, z);
    return (V.length / 3) - 1;
  };

  // helper: triangolo
  const tri = (a: number, b: number, c: number) => {
    I.push(a, b, c);
  };

  // ring face tra innerRect e outerRect a quota z (normale su o giù)
  const addRingFace = (inner: Rect, outer: Rect, z: number, up: boolean) => {
    // corners in CCW (x,y)
    const o = rectCorners(outer);
    const inn = rectCorners(inner);

    // 4 quads (top, right, bottom, left) -> 8 tris
    // top edge: outer TL->TR with inner TL->TR
    addQuad(o.tl, o.tr, inn.tr, inn.tl, z, up, addV, tri);
    // right edge: outer TR->BR with inner BR->TR
    addQuad(o.tr, o.br, inn.br, inn.tr, z, up, addV, tri);
    // bottom edge: outer BR->BL with inner BL->BR
    addQuad(o.br, o.bl, inn.bl, inn.br, z, up, addV, tri);
    // left edge: outer BL->TL with inner TL->BL
    addQuad(o.bl, o.tl, inn.tl, inn.bl, z, up, addV, tri);
  };

  // vertical wall on a rectangle boundary between z0 and z1
  // outward=true => normale verso fuori (outer walls / step cliffs)
  // outward=false => normale verso dentro (inner hole)
  const addRectWall = (r: Rect, z0: number, z1: number, outward: boolean) => {
    const c = rectCorners(r);

    // each side is a quad extruded in z
    // define each side as two 2D points p0->p1, then create quad
    const sides: Array<[Pt2, Pt2]> = [
      [c.tl, c.tr], // top
      [c.tr, c.br], // right
      [c.br, c.bl], // bottom
      [c.bl, c.tl], // left
    ];

    for (const [p0, p1] of sides) {
      // bottom and top vertices for the quad
      const a0 = addV(p0.x, p0.y, z0);
      const b0 = addV(p1.x, p1.y, z0);
      const b1 = addV(p1.x, p1.y, z1);
      const a1 = addV(p0.x, p0.y, z1);

      // winding depends on outward
      if (outward) {
        tri(a0, b0, b1);
        tri(a0, b1, a1);
      } else {
        tri(a0, b1, b0);
        tri(a0, a1, b1);
      }
    }
  };

  // 1) Top faces: per ogni anello
  for (let ring = 0; ring < steps; ring++) {
    const inner = rects[ring]!;
    const outer = rects[ring + 1]!;
    addRingFace(inner, outer, topZ(ring), true);
  }

  // 2) Step cliffs: tra livelli top diversi lungo il confine rects[i]
  // boundary rects[i] separa ring i-1 (inside) e ring i (outside)
  for (let i = 1; i < rects.length - 0; i++) {
    // i=1..steps: confine tra ring i-1 e ring i
    // ring i esiste solo fino steps-1, quindi per i==steps non c’è ring i, ma serve outer wall sotto
    if (i <= steps - 1) {
      const r = rects[i]!;
      const zIn = topZ(i - 1);
      const zOut = topZ(i);
      // muro verticale sul confine: normale verso fuori
      addRectWall(r, zOut, zIn, true);
    }
  }

  // 3) Inner hole wall: rects[0] da bottom a topZ(0)=0, normale verso dentro
  addRectWall(rects[0]!, zBottom, topZ(0), false);

  // 4) Outer wall: rects[steps] da bottom a topZ(steps-1), normale verso fuori
  addRectWall(rects[steps]!, zBottom, topZ(steps - 1), true);

  // 5) Bottom face: ring tra inner rect0 e outer rectSteps a zBottom, normale GIÙ
  addRingFace(rects[0]!, rects[steps]!, zBottom, false);

  return {
    vertices: new Float32Array(V),
    indices: new Uint32Array(I),
  };
}

// ---------------- helpers ----------------

type Pt2 = { x: number; y: number };

function rectCorners(r: Rect) {
  const hx = r.hx, hy = r.hy;
  return {
    tl: { x: -hx, y: +hy },
    tr: { x: +hx, y: +hy },
    br: { x: +hx, y: -hy },
    bl: { x: -hx, y: -hy },
  };
}

// Quad defined by p0->p1->p2->p3 at z (2D points). “up” controls winding.
function addQuad(
  p0: Pt2,
  p1: Pt2,
  p2: Pt2,
  p3: Pt2,
  z: number,
  up: boolean,
  addV: (x: number, y: number, z: number) => number,
  tri: (a: number, b: number, c: number) => void
) {
  const a = addV(p0.x, p0.y, z);
  const b = addV(p1.x, p1.y, z);
  const c = addV(p2.x, p2.y, z);
  const d = addV(p3.x, p3.y, z);

  if (up) {
    tri(a, b, c);
    tri(a, c, d);
  } else {
    tri(a, c, b);
    tri(a, d, c);
  }
}

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * bands crescenti verso l’esterno:
 * band[i] = base * phi^i, normalizzate su totalBandsWanted.
 * Se base < minBand -> clamp e usa totale risultante.
 */
function computePhiBands(totalBandsWanted: number, steps: number, phi: number, minBand: number) {
  const weights: number[] = [];
  for (let i = 0; i < steps; i++) weights.push(Math.pow(phi, i));

  const sumW = weights.reduce((s, x) => s + x, 0);
  let base = totalBandsWanted / sumW;

  if (base < minBand) base = minBand;

  const bands = weights.map((w) => w * base);
  return bands;
}

/** Larghezza TOTALE reale del passepartout per lato (mm), tenendo conto del clamp φ/minBand.
 *  Serve per far combaciare il bordo interno della cornice con il bordo esterno del passepartout. */
export function passepartoutOuterBandsMm(p: {
  steps: 1 | 2 | 3 | 4 | 5 | 6; totalBandsMm: number; minBandMm: number; phiRatio?: number;
}): number {
  const steps = Number(p.steps ?? 1);
  const minBand = clamp(Number(p.minBandMm ?? 6), 1, 50);
  const phi = Number.isFinite(p.phiRatio) ? Number(p.phiRatio) : PHI_DEFAULT;
  const totalBandsWanted = clamp(Number(p.totalBandsMm ?? 30), minBand * steps, 1000);
  let sumW = 0;
  for (let i = 0; i < steps; i++) sumW += Math.pow(phi, i);
  let base = totalBandsWanted / sumW;
  if (base < minBand) base = minBand;
  return base * sumW;
}
