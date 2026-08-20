// scripts/circular-check.mts
//
// BASSORILIEVO CIRCOLARE — confronto misurato fra le due strade, come chiede la
// roadmap: mesh costruita direttamente tonda contro intersezione booleana con un
// cilindro. Si misurano triangoli, millisecondi, tenuta manifold e qualita' del
// bordo. La scelta la fanno i numeri.
//
// Uso:  pnpm circular:check

import * as THREE from "three";
import { buildSolidFromHeightmap } from "../src/lib/relief/buildSolidFromHeightmap";
import { buildCircularSolidFromHeightmap } from "../src/lib/relief/buildCircularSolid";
import { getManifold, geomToManifold, manifoldToGeom } from "../src/components/relief/reliefStl";

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) fail++; };

const W = 512, H = 512;
const DIAMETRO = 120;
const DEPTH = 6;
const BASE = 3;

/** Ritratto sintetico: cupola centrale + rilievo fine, come negli altri check. */
function soggetto(w: number, h: number) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x / (w - 1)) * 2 - 1;
      const ny = (y / (h - 1)) * 2 - 1;
      const r = Math.hypot(nx / 0.6, ny / 0.8);
      let v = r < 1 ? Math.sqrt(1 - r * r) * 0.8 : 0;
      v += 0.05 * Math.sin(nx * 22) * Math.cos(ny * 18); // micro-dettaglio
      a[y * w + x] = Math.max(0, Math.min(1, v));
    }
  }
  return a;
}

/** Spigoli aperti: se > 0 la mesh non e' chiusa e lo slicer non la stampa. */
function openEdges(indices: ArrayLike<number>): number {
  const seen = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const t = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = t[e]!, b = t[(e + 1) % 3]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of seen.values()) if (n !== 2) open++;
  return open;
}

/** Quanto e' tondo il bordo: scarto fra raggio massimo e minimo dei SOLI vertici
 *  sul perimetro. La soglia va tenuta stretta: con 0.97 si finisce per includere
 *  anche il penultimo anello e si misura il passo radiale, non il bordo. */
function bordoTondo(pos: ArrayLike<number>, count: number, rAtteso: number) {
  let rMin = Infinity, rMax = 0, n = 0;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!;
    const r = Math.hypot(x, y);
    if (r > rAtteso * 0.999) { if (r < rMin) rMin = r; if (r > rMax) rMax = r; n++; }
  }
  return { rMin, rMax, scarto: n ? rMax - rMin : NaN, n };
}

const height01 = soggetto(W, H);

console.log(`BASSORILIEVO CIRCOLARE — sorgente ${W}x${H}, diametro ${DIAMETRO} mm`);
console.log("");

// --------------------------------------------------------------------------
// A) MESH COSTRUITA DIRETTAMENTE TONDA
// --------------------------------------------------------------------------
const tA0 = performance.now();
const diretta = buildCircularSolidFromHeightmap({
  height01, width: W, height: H,
  outDiameterMm: DIAMETRO, depthMm: DEPTH, baseMm: BASE,
  radialSteps: 180, angularSteps: 360,
});
const tA = performance.now() - tA0;

const apertiA = openEdges(diretta.indices);
const bordoA = bordoTondo(diretta.vertices, diretta.vertices.length / 3, DIAMETRO / 2);

console.log("A) mesh costruita tonda");
console.log(`   triangoli ${diretta.triangles}   tempo ${tA.toFixed(1)} ms`);
console.log(`   spigoli aperti ${apertiA}   bordo: scarto ${bordoA.scarto.toFixed(4)} mm su ${bordoA.n} vertici`);

// --------------------------------------------------------------------------
// B) INTERSEZIONE BOOLEANA CON UN CILINDRO
// --------------------------------------------------------------------------
const tB0 = performance.now();
const rett = buildSolidFromHeightmap({
  height01, width: W, height: H,
  outWidthMm: DIAMETRO, depthMm: DEPTH, baseMm: BASE, baseStyle: "flat",
});
const tRett = performance.now() - tB0;

const wasm = await getManifold();
const tCsg0 = performance.now();
const solido = geomToManifold(wasm, rett.geometry);
const cilindro = wasm.Manifold.cylinder(DEPTH + BASE + 20, DIAMETRO / 2, DIAMETRO / 2, 360, true)
  .translate([0, 0, -10]);
const tagliato = solido.intersect(cilindro);
const geomB = manifoldToGeom(tagliato);
const tCsg = performance.now() - tCsg0;

const idxB = geomB.index ? geomB.index.array : [];
const posB = (geomB.getAttribute("position") as THREE.BufferAttribute).array as ArrayLike<number>;
const triB = geomB.index ? geomB.index.count / 3 : posB.length / 9;
const apertiB = openEdges(idxB as ArrayLike<number>);
const bordoB = bordoTondo(posB, posB.length / 3, DIAMETRO / 2);

console.log("");
console.log("B) intersezione booleana con cilindro");
console.log(`   triangoli ${triB}   tempo ${(tRett + tCsg).toFixed(1)} ms (mesh ${tRett.toFixed(1)} + CSG ${tCsg.toFixed(1)})`);
console.log(`   spigoli aperti ${apertiB}   bordo: scarto ${bordoB.scarto.toFixed(4)} mm su ${bordoB.n} vertici`);

// --------------------------------------------------------------------------
// VERDETTO
// --------------------------------------------------------------------------
console.log("");
console.log("CONFRONTO");
const rapportoTri = triB / diretta.triangles;
const rapportoT = (tRett + tCsg) / tA;
console.log(`   triangoli: B/A = ${rapportoTri.toFixed(2)}x     tempo: B/A = ${rapportoT.toFixed(1)}x`);
console.log("");

check(apertiA === 0, "A: mesh chiusa (watertight per costruzione)");
check(bordoA.scarto < 0.01, `A: bordo circolare esatto (scarto ${bordoA.scarto.toFixed(4)} mm)`);
check(diretta.triangles > 1000, `A: risoluzione sensata (${diretta.triangles} triangoli)`);
check(apertiB === 0, `B: mesh chiusa dopo la booleana (spigoli aperti ${apertiB})`);

console.log(fail ? `❌ ${fail} controllo/i fallito/i.` : "✅ tutti i controlli superati");
process.exitCode = fail ? 1 : 0;
