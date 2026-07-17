import * as THREE from "three";

function writeString80(view: DataView, offset: number, text: string) {
  // ASCII only; pad/truncate to 80 bytes
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const n = Math.min(80, bytes.length);
  for (let i = 0; i < 80; i++) view.setUint8(offset + i, i < n ? bytes[i] : 0);
}

function normalFromTri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  return [nx, ny, nz] as const;
}

export function geometryToBinaryStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  if (!geometry) throw new Error("geometryToBinaryStl: geometry is null");

  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) throw new Error("geometryToBinaryStl: missing position attribute");

  const vertexCount = pos.count;
  if (vertexCount % 3 !== 0) {
    throw new Error(`geometryToBinaryStl: position.count (${vertexCount}) not multiple of 3`);
  }

  const triCount = vertexCount / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);

  // Header (80 bytes) + triangle count (uint32)
  writeString80(view, 0, "ReliefForge binary STL");
  view.setUint32(80, triCount, true);

  let o = 84; // start of triangles
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;

    const ax = pos.getX(i0 + 0), ay = pos.getY(i0 + 0), az = pos.getZ(i0 + 0);
    const bx = pos.getX(i0 + 1), by = pos.getY(i0 + 1), bz = pos.getZ(i0 + 1);
    const cx = pos.getX(i0 + 2), cy = pos.getY(i0 + 2), cz = pos.getZ(i0 + 2);

    // Guard: NaN/Infinity => file inutilizzabile
    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) {
      throw new Error(`geometryToBinaryStl: non-finite vertex at tri ${t}`);
    }

    const [nx, ny, nz] = normalFromTri(ax, ay, az, bx, by, bz, cx, cy, cz);

    // normal
    view.setFloat32(o + 0, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);

    // v1
    view.setFloat32(o + 12, ax, true);
    view.setFloat32(o + 16, ay, true);
    view.setFloat32(o + 20, az, true);

    // v2
    view.setFloat32(o + 24, bx, true);
    view.setFloat32(o + 28, by, true);
    view.setFloat32(o + 32, bz, true);

    // v3
    view.setFloat32(o + 36, cx, true);
    view.setFloat32(o + 40, cy, true);
    view.setFloat32(o + 44, cz, true);

    // attribute byte count
    view.setUint16(o + 48, 0, true);

    o += 50;
  }

  return buffer;
}
