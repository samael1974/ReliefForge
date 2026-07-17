// src/lib/relief/frame/buildFrameRectPhi.ts
export type FrameRectSimpleParams = {
  innerWmm: number;
  innerHmm: number;
  thicknessMm: number;      // spessore cornice (lato)
  heightMm: number;         // altezza totale cornice
  glassMm: 2 | 3;           // spessore vetro
  glassClearanceMm: number; // clearance per il vetro
  glueLipMm: number;        // spalla/bordo interno dove incollare vetro
};

export type MeshOut = {
  vertices: Float32Array;
  indices: Uint32Array;
};

export function buildFrameRectPhi(
  params: FrameRectSimpleParams
): MeshOut {
  const w = Math.max(1, params.innerWmm);
  const h = Math.max(1, params.innerHmm);

  const thickness = Math.max(0.5, params.thicknessMm);
  const height = Math.max(1, params.heightMm);

  const glass = params.glassMm;
  const clearance = Math.max(0, params.glassClearanceMm);
  const lip = Math.max(0, params.glueLipMm);

  // Outer dims
  const outerW = w + 2 * thickness;
  const outerH = h + 2 * thickness;

  // All vertices and indices
  const V: number[] = [];
  const I: number[] = [];

  const addV = (x: number, y: number, z: number) => {
    V.push(x, y, z);
    return (V.length / 3) - 1;
  };

  const tri = (a: number, b: number, c: number) => {
    I.push(a, b, c);
  };

  // Build top plate (like a rectangular hollow box)
  // Top face y = height

  const z0 = 0;
  const y0 = 0;
  const yH = height;

  // Outer rectangle at top
  const oTL = addV(-outerW/2, yH, -outerH/2);
  const oTR = addV(+outerW/2, yH, -outerH/2);
  const oBR = addV(+outerW/2, yH, +outerH/2);
  const oBL = addV(-outerW/2, yH, +outerH/2);

  // Inner hole at top
  const iTL = addV(-w/2, yH, -h/2);
  const iTR = addV(+w/2, yH, -h/2);
  const iBR = addV(+w/2, yH, +h/2);
  const iBL = addV(-w/2, yH, +h/2);

  // Top face quads
  tri(oTL, oTR, iTR); tri(oTL, iTR, iTL);
  tri(oTR, oBR, iBR); tri(oTR, iBR, iTR);
  tri(oBR, oBL, iBL); tri(oBR, iBL, iBR);
  tri(oBL, oTL, iTL); tri(oBL, iTL, iBL);

  // Walls: outer sides (height)
  const addRectWall = (
    x0: number, z0a: number,
    x1: number, z1: number,
    yB: number, yT: number
  ) => {
    const a0 = addV(x0, yB, z0a);
    const b0 = addV(x1, yB, z1);
    const b1 = addV(x1, yT, z1);
    const a1 = addV(x0, yT, z0a);
    tri(a0, b0, b1); tri(a0, b1, a1);
  };

  // outer four walls
  addRectWall(-outerW/2, -outerH/2, +outerW/2, -outerH/2, y0, yH);
  addRectWall(+outerW/2, -outerH/2, +outerW/2, +outerH/2, y0, yH);
  addRectWall(+outerW/2, +outerH/2, -outerW/2, +outerH/2, y0, yH);
  addRectWall(-outerW/2, +outerH/2, -outerW/2, -outerH/2, y0, yH);

  // inner hole walls
  addRectWall(-w/2, -h/2, +w/2, -h/2, y0, yH);
  addRectWall(+w/2, -h/2, +w/2, +h/2, y0, yH);
  addRectWall(+w/2, +h/2, -w/2, +h/2, y0, yH);
  addRectWall(-w/2, +h/2, -w/2, -h/2, y0, yH);

  // add bottom face just like top but at y=0
  // bottom face exists only on outer->inner
  const b_oTL = addV(-outerW/2, y0, -outerH/2);
  const b_oTR = addV(+outerW/2, y0, -outerH/2);
  const b_oBR = addV(+outerW/2, y0, +outerH/2);
  const b_oBL = addV(-outerW/2, y0, +outerH/2);

  const b_iTL = addV(-w/2, y0, -h/2);
  const b_iTR = addV(+w/2, y0, -h/2);
  const b_iBR = addV(+w/2, y0, +h/2);
  const b_iBL = addV(-w/2, y0, +h/2);

  tri(b_oTL, b_iTR, b_oTR); tri(b_oTL, b_iTL, b_iTR);
  tri(b_oTR, b_iBR, b_oBR); tri(b_oTR, b_iTR, b_iBR);
  tri(b_oBR, b_iBL, b_oBL); tri(b_oBR, b_iBR, b_iBL);
  tri(b_oBL, b_iTL, b_iBL); tri(b_oBL, b_oTL, b_iTL);

  return {
    vertices: new Float32Array(V),
    indices: new Uint32Array(I),
  };
}
