// scripts/stl-check.mts
//
// INVARIANZA degli STL del solo rilievo: a parita' di parametri il file deve
// restare identico byte per byte.
//
// Gli altri check verificano PROPRIETA' (watertight, tolleranza, monotonia): una
// deriva silenziosa della geometria li supererebbe tutti, perche' la mesh
// resterebbe chiusa e nei limiti. Questo confronta invece l'impronta digitale con
// un riferimento committato, cosi' un cambiamento involontario si vede subito e
// uno voluto lascia un diff leggibile.
//
// Uso:  pnpm stl:check
//       UPDATE_GOLDEN=1 pnpm stl:check   (rigenera i riferimenti, poi committarli)

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildReliefStlBinary } from "../src/components/relief/reliefStl";

const GOLDEN = path.resolve(import.meta.dirname ?? ".", "stl-golden.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const W = 64, H = 48;

/** Rampa lineare lungo X: pendenza costante. */
function gradient() {
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = x / (W - 1);
  return a;
}
/** Bozza gaussiana centrata: superficie curva liscia. */
function gaussian() {
  const a = new Float32Array(W * H);
  const cx = (W - 1) / 2, cy = (H - 1) / 2, s2 = 2 * Math.pow(Math.min(W, H) / 5, 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s2);
  return a;
}
/** Gradino netto: parete verticale, il caso peggiore per la mesh. */
function step() {
  const a = new Float32Array(W * H);
  const half = Math.floor(W / 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = x < half ? 0 : 1;
  return a;
}

type Caso = { nome: string; args: any };
const CASI: Caso[] = [
  { nome: "rampa-flat",        args: { hm: { normF32: gradient(), w: W, h: H }, widthMm: 120, depthMm: 4, baseMm: 3, outputMode: "relief", baseStyle: "flat" } },
  { nome: "gaussiana-flat",    args: { hm: { normF32: gaussian(), w: W, h: H }, widthMm: 120, depthMm: 4, baseMm: 3, outputMode: "relief", baseStyle: "flat" } },
  { nome: "gradino-flat",      args: { hm: { normF32: step(),     w: W, h: H }, widthMm: 120, depthMm: 4, baseMm: 3, outputMode: "relief", baseStyle: "flat" } },
  { nome: "gaussiana-recessed", args: { hm: { normF32: gaussian(), w: W, h: H }, widthMm: 150, depthMm: 6, baseMm: 2.5, outputMode: "relief", baseStyle: "recessed" } },
  { nome: "gaussiana-offset",   args: { hm: { normF32: gaussian(), w: W, h: H }, widthMm: 150, depthMm: 6, baseMm: 1.2, outputMode: "relief", baseStyle: "offset" } },
  { nome: "gaussiana-adattiva", args: { hm: { normF32: gaussian(), w: W, h: H }, widthMm: 150, depthMm: 6, baseMm: 3, outputMode: "relief", baseStyle: "flat", toleranceMm: 0.05 } },
];

type Stat = {
  sha256: string; byteLength: number; triangles: number;
  bbox: { x: number; y: number; z: number };
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Rilegge lo STL binario ed estrae le grandezze confrontabili. */
function stat(buffer: ArrayBuffer): Stat {
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  const atteso = 84 + triangles * 50;
  if (buffer.byteLength !== atteso)
    throw new Error(`STL malformato: header dichiara ${triangles} triangoli (${atteso} byte) ma il file ne ha ${buffer.byteLength}`);

  let miX = Infinity, miY = Infinity, miZ = Infinity, maX = -Infinity, maY = -Infinity, maZ = -Infinity;
  for (let t = 0; t < triangles; t++) {
    let o = 84 + t * 50 + 12; // 12 byte di normale, poi 3 vertici
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(o, true), y = view.getFloat32(o + 4, true), z = view.getFloat32(o + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
        throw new Error(`vertice non finito nel triangolo ${t}`);
      if (x < miX) miX = x; if (x > maX) maX = x;
      if (y < miY) miY = y; if (y > maY) maY = y;
      if (z < miZ) miZ = z; if (z > maZ) maZ = z;
      o += 12;
    }
  }
  return {
    sha256: createHash("sha256").update(new Uint8Array(buffer)).digest("hex"),
    byteLength: buffer.byteLength,
    triangles,
    bbox: { x: r4(maX - miX), y: r4(maY - miY), z: r4(maZ - miZ) },
  };
}

const golden: Record<string, Stat> = fs.existsSync(GOLDEN)
  ? JSON.parse(fs.readFileSync(GOLDEN, "utf-8"))
  : {};

let fail = 0;
const nuovo: Record<string, Stat> = {};

console.log(`INVARIANZA STL — ${CASI.length} casi su heightmap sintetiche ${W}x${H}\n`);

for (const c of CASI) {
  // buildReliefStlBinary lancia da solo se la mesh non e' chiusa: se arriviamo
  // in fondo, la validita' manifold e' gia' verificata.
  const s = stat(buildReliefStlBinary(c.args));
  nuovo[c.nome] = s;
  const g = golden[c.nome];

  if (UPDATE || !g) {
    console.log(`  ${UPDATE ? "~" : "+"} ${c.nome}: ${s.triangles} triangoli, ${s.bbox.x}x${s.bbox.y}x${s.bbox.z} mm ${g ? "(rigenerato)" : "(nuovo)"}`);
    if (!UPDATE) fail++;
    continue;
  }

  const diff: string[] = [];
  if (s.triangles !== g.triangles) diff.push(`triangoli ${g.triangles} -> ${s.triangles}`);
  if (s.bbox.x !== g.bbox.x || s.bbox.y !== g.bbox.y || s.bbox.z !== g.bbox.z)
    diff.push(`ingombro ${g.bbox.x}x${g.bbox.y}x${g.bbox.z} -> ${s.bbox.x}x${s.bbox.y}x${s.bbox.z} mm`);
  if (s.byteLength !== g.byteLength) diff.push(`dimensione ${g.byteLength} -> ${s.byteLength} byte`);
  if (!diff.length && s.sha256 !== g.sha256) diff.push(`hash diverso a parita' di quote (${g.sha256.slice(0, 12)} -> ${s.sha256.slice(0, 12)})`);

  if (diff.length) { console.log(`  ✗ ${c.nome}: ${diff.join("; ")}`); fail++; }
  else console.log(`  ✓ ${c.nome}: ${s.triangles} triangoli, ${s.bbox.x}x${s.bbox.y}x${s.bbox.z} mm`);
}

if (UPDATE || Object.keys(golden).length === 0) {
  fs.writeFileSync(GOLDEN, JSON.stringify(nuovo, null, 2) + "\n", "utf-8");
  console.log(`\n📌 riferimenti scritti in ${path.basename(GOLDEN)} — controllali e committali.`);
  if (!UPDATE) { console.log("   Rilancia `pnpm stl:check` per la verifica vera."); process.exit(1); }
  process.exit(0);
}

if (fail) {
  console.log(`\n❌ ${fail} caso/i cambiato/i.`);
  console.log("   Se il cambiamento e' VOLUTO:  UPDATE_GOLDEN=1 pnpm stl:check");
  console.log("   e committa il diff di scripts/stl-golden.json, che documenta cosa e' cambiato.");
  process.exit(1);
}

console.log("\n✅ tutti i controlli superati");
