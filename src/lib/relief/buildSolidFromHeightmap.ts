// src/lib/relief/buildSolidFromHeightmap.ts
import * as THREE from "three";
import type { BaseStyle } from "./reliefTypes";

export type BuildSolidFromHeightmapInput = {
  // height normalized [0..1], length = width*height
  height01: Float32Array;
  width: number;
  height: number;

  // physical params
  outWidthMm: number; // final STL X size in mm
  depthMm: number; // relief amplitude (mm)
  baseMm: number; // base thickness (mm) OR shell thickness when baseStyle="offset"
  baseStyle: BaseStyle; // "flat" | "recessed" | "offset"

  // optional
  invert?: boolean; // invert height
  clampHeights?: boolean; // clamp height01 to [0..1]
  minBaseMm?: number; // default 0.4
};

export type BuildSolidFromHeightmapOutput = {
  geometry: THREE.BufferGeometry;
  vertices: Float32Array; // xyz packed
  indices: Uint32Array; // triangle indices
};

// ---------- helpers ----------
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function idxOf(x: number, y: number, w: number) {
  return y * w + x;
}
function computeHeightMm(height01: Float32Array, i: number, depthMm: number) {
  return height01[i] * depthMm;
}

/**
 * Normal (unit) of heightfield at (ix,iy) using finite differences on Z.
 * sxMm, syMm are the real mm-per-pixel in X/Y so slopes are scaled correctly.
 */
function normalFromHeightmap(
  height01: Float32Array,
  w: number,
  h: number,
  ix: number,
  iy: number,
  depthMm: number,
  sxMm: number,
  syMm: number
) {
  const x0 = clamp(ix - 1, 0, w - 1);
  const x1 = clamp(ix + 1, 0, w - 1);
  const y0 = clamp(iy - 1, 0, h - 1);
  const y1 = clamp(iy + 1, 0, h - 1);

  const iL = iy * w + x0;
  const iR = iy * w + x1;
  const iD = y0 * w + ix;
  const iU = y1 * w + ix;

  const zL = computeHeightMm(height01, iL, depthMm);
  const zR = computeHeightMm(height01, iR, depthMm);
  const zD = computeHeightMm(height01, iD, depthMm);
  const zU = computeHeightMm(height01, iU, depthMm);

  const dzdx = (zR - zL) / Math.max(1e-9, (x1 - x0) * sxMm);
  const dzdy = (zU - zD) / Math.max(1e-9, (y1 - y0) * syMm);

  // normal ~ (-dzdx, -dzdy, 1)
  let nx = -dzdx;
  let ny = -dzdy;
  let nz = 1;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-12 || !Number.isFinite(len)) return { nx: 0, ny: 0, nz: 1 };

  nx /= len;
  ny /= len;
  nz /= len;
  return { nx, ny, nz };
}

/**
 * Build a CLOSED (manifold) mesh from a heightmap grid.
 *
 * Base styles:
 * - flat:     bottom plane z=0, top z=base + depth*H
 * - recessed: bottom plane z=0, top z=max(0, base - depth*H)
 * - offset:   slicer-safe "solidify-ish": bottom follows normals but with clamp to reduce self-intersections
 *
 * Note: offset along normals can self-intersect on steep features; many tools implement clamping to reduce this.
 * (e.g. Blender Solidify "Thickness Clamp"). :contentReference[oaicite:2]{index=2}
 */
export function buildSolidFromHeightmap(
  input: BuildSolidFromHeightmapInput
): BuildSolidFromHeightmapOutput {
  const {
    height01,
    width: w,
    height: h,
    outWidthMm,
    depthMm,
    baseMm,
    baseStyle,
    invert = false,
    clampHeights = true,
    minBaseMm = 0.4,
  } = input;

  if (w <= 1 || h <= 1) throw new Error("Heightmap too small (need >= 2x2).");
  if (height01.length !== w * h) throw new Error("height01 length mismatch.");
  if (!(outWidthMm > 0)) throw new Error("outWidthMm must be > 0.");
  if (!(depthMm >= 0)) throw new Error("depthMm must be >= 0.");
  if (!(baseMm >= 0)) throw new Error("baseMm must be >= 0.");

  // Requested: disallow base thickness < 0.4mm
  const base = Math.max(minBaseMm, baseMm);

  // Maintain aspect ratio using segment counts (w-1, h-1)
  const outHeightMm = outWidthMm * ((h - 1) / (w - 1));

  // Grid spacing in mm
  const dxMm = outWidthMm / (w - 1);
  const dyMm = outHeightMm / (h - 1);

  // Precompute processed heights (clamp + invert) so normals/offset match the TOP surface.
  const H = new Float32Array(w * h);
  for (let i = 0; i < H.length; i++) {
    let v = height01[i];
    if (clampHeights) v = clamp01(v);
    if (invert) v = 1 - v;
    H[i] = v;
  }

  const gridCount = w * h;
  // Il retro piano non ha bisogno di una seconda griglia densa: una corona
  // perimetrale più un centro produce lo stesso solido chiuso con molti meno
  // triangoli. Lo stile offset mantiene invece la griglia completa perché il
  // retro segue le normali della superficie.
  const boundary: number[] = [];
  for (let x = 0; x < w; x++) boundary.push(idxOf(x, 0, w));
  for (let y = 1; y < h; y++) boundary.push(idxOf(w - 1, y, w));
  for (let x = w - 2; x >= 0; x--) boundary.push(idxOf(x, h - 1, w));
  for (let y = h - 2; y >= 1; y--) boundary.push(idxOf(0, y, w));

  const compactBack = baseStyle !== "offset";
  const bottomOffset = gridCount;
  const bottomCenter = compactBack ? bottomOffset + boundary.length : -1;
  const vCount = compactBack ? gridCount + boundary.length + 1 : 2 * gridCount;
  const verts = new Float32Array(vCount * 3);

  const setV = (vi: number, x: number, y: number, z: number) => {
    const o = vi * 3;
    verts[o] = x;
    verts[o + 1] = y;
    verts[o + 2] = z;
  };

  // Centered coords for nicer preview
  const xStart = -outWidthMm / 2;
  const yStart = -outHeightMm / 2;

  // --- offset safety knobs (internal, no API change) ---
  // Similar idea to "clamp thickness to shortest adjacent edge" to reduce self-intersections. :contentReference[oaicite:3]{index=3}
  const shortestEdge = Math.min(dxMm, dyMm);
  const maxXYShift = 0.49 * shortestEdge; // never cross a cell edge
  const minZThickness = base; // guarantee thickness in Z for slicer robustness

  // Fill vertices
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idxOf(x, y, w);
      const v01 = H[i];

      const px = xStart + x * dxMm;

      // NON tocchiamo orientamenti: lasciamo esattamente come nel tuo STL attuale.
      const py = -(yStart + y * dyMm);

      const topIndex = i;
      // --- top z ---
      let zTop = 0;
      if (baseStyle === "flat") {
        zTop = base + depthMm * v01;
      } else if (baseStyle === "recessed") {
        zTop = base - depthMm * v01;
        if (zTop < 0) zTop = 0;
      } else {
        // offset: top is pure relief (NO vertical translation)
        zTop = depthMm * v01;
      }

      setV(topIndex, px, py, zTop);

      // --- bottom vertex (solo per offset: il retro piano viene creato sotto) ---
      if (!compactBack) {
        const botIndex = bottomOffset + i;
        // "solidify-ish" inward along local normal, but with clamp
        const n = normalFromHeightmap(H, w, h, x, y, depthMm, dxMm, dyMm);

        // Candidate lateral shift from normal
        let offX = n.nx * base;
        let offY = n.ny * base;

        // Clamp XY shift to avoid severe self-intersections (Solidify Clamp concept) :contentReference[oaicite:4]{index=4}
        const xyLen = Math.hypot(offX, offY);
        if (xyLen > maxXYShift && xyLen > 1e-12) {
          const s = maxXYShift / xyLen;
          offX *= s;
          offY *= s;
        }

        // Z: guarantee minimum thickness for slicer stability.
        // This is the key to avoid "missing material" artifacts when the offset shell folds on itself.
        const bz = zTop - minZThickness;

        const bx = px - offX;
        const by = py - offY;

        setV(botIndex, bx, by, bz);
      }
    }
  }

  const bottomBoundaryMap = new Int32Array(gridCount);
  bottomBoundaryMap.fill(-1);
  if (compactBack) {
    for (let k = 0; k < boundary.length; k++) {
      const topIndex = boundary[k];
      const x = topIndex % w;
      const y = Math.floor(topIndex / w);
      const px = xStart + x * dxMm;
      const py = -(yStart + y * dyMm);
      const bottomIndex = bottomOffset + k;
      bottomBoundaryMap[topIndex] = bottomIndex;
      setV(bottomIndex, px, py, 0);
    }
    setV(bottomCenter, 0, 0, 0);
  }

  const bottomIndexFor = (topIndex: number) => {
    if (!compactBack) return bottomOffset + topIndex;
    const mapped = bottomBoundaryMap[topIndex];
    if (mapped < 0) throw new Error("Internal error: requested non-boundary bottom vertex.");
    return mapped;
  };

  // Triangle counts
  const topTris = 2 * (w - 1) * (h - 1);
  const bottomTris = compactBack ? boundary.length : topTris;
  const sideQuads = 2 * (h - 1) + 2 * (w - 1);
  const sideTris = 2 * sideQuads;
  const triCount = topTris + bottomTris + sideTris;

  const indices = new Uint32Array(triCount * 3);
  let ti = 0;
  const pushTri = (a: number, b: number, c: number) => {
  // Invertiamo l’ordine dei vertici per avere winding CCW
  indices[ti++] = a;
  indices[ti++] = c;
  indices[ti++] = b;
};

  // TOP surface (CCW when viewed from outside)
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = idxOf(x, y, w);
      const b = idxOf(x + 1, y, w);
      const c = idxOf(x, y + 1, w);
      const d = idxOf(x + 1, y + 1, w);
      pushTri(a, b, d);
      pushTri(a, d, c);
    }
  }

  // BOTTOM surface (reverse winding). Per retro piano usiamo una ventola
  // perimetrale; per offset resta la griglia completa.
  if (compactBack) {
    for (let k = 0; k < boundary.length; k++) {
      const a = bottomIndexFor(boundary[k]);
      const b = bottomIndexFor(boundary[(k + 1) % boundary.length]);
      pushTri(bottomCenter, b, a);
    }
  } else {
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = bottomOffset + idxOf(x, y, w);
        const b = bottomOffset + idxOf(x + 1, y, w);
        const c = bottomOffset + idxOf(x, y + 1, w);
        const d = bottomOffset + idxOf(x + 1, y + 1, w);
        pushTri(a, d, b);
        pushTri(a, c, d);
      }
    }
  }

  // SIDES: connect perimeter

  // Left edge (x=0) outward ~ -X
  for (let y = 0; y < h - 1; y++) {
    const topA = idxOf(0, y, w);
    const topB = idxOf(0, y + 1, w);
    const botA = bottomIndexFor(idxOf(0, y, w));
    const botB = bottomIndexFor(idxOf(0, y + 1, w));
    pushTri(topA, topB, botB);
    pushTri(topA, botB, botA);
  }

  // Right edge (x=w-1) outward ~ +X
  for (let y = 0; y < h - 1; y++) {
    const topA = idxOf(w - 1, y, w);
    const topB = idxOf(w - 1, y + 1, w);
    const botA = bottomIndexFor(idxOf(w - 1, y, w));
    const botB = bottomIndexFor(idxOf(w - 1, y + 1, w));
    pushTri(topB, topA, botA);
    pushTri(topB, botA, botB);
  }

  // Bottom edge (y=0) outward ~ -Y
  for (let x = 0; x < w - 1; x++) {
    const topA = idxOf(x, 0, w);
    const topB = idxOf(x + 1, 0, w);
    const botA = bottomIndexFor(idxOf(x, 0, w));
    const botB = bottomIndexFor(idxOf(x + 1, 0, w));
    pushTri(topB, topA, botA);
    pushTri(topB, botA, botB);
  }

  // Top edge (y=h-1) outward ~ +Y
  for (let x = 0; x < w - 1; x++) {
    const topA = idxOf(x, h - 1, w);
    const topB = idxOf(x + 1, h - 1, w);
    const botA = bottomIndexFor(idxOf(x, h - 1, w));
    const botB = bottomIndexFor(idxOf(x + 1, h - 1, w));
    pushTri(topA, topB, botB);
    pushTri(topA, botB, botA);
  }

  // Build THREE geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return { geometry, vertices: verts, indices };
}
