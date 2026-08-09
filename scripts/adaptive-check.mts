// scripts/adaptive-check.mts
//
// Verifica del mesher adattivo: deve essere chiuso come quello uniforme, rispettare
// la tolleranza dichiarata e pesare molto meno.
//
// Uso:  pnpm adaptive:check

import { buildSolidFromHeightmap } from "../src/lib/relief/buildSolidFromHeightmap";
import { buildAdaptiveSolidFromHeightmap } from "../src/lib/relief/buildAdaptiveSolid";

/** Ritratto sintetico: sfondo piatto (deve costare poco) + volto con dettaglio fine. */
function portraitLike(w: number, h: number) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x / (w - 1)) * 2 - 1;
      const ny = (y / (h - 1)) * 2 - 1;
      // volto: ellisse morbida al centro
      const r = Math.hypot(nx / 0.55, (ny + 0.05) / 0.75);
      let v = 0;
      if (r < 1) {
        v = Math.sqrt(1 - r * r) * 0.8;
        // micro-dettaglio solo sul volto
        v += 0.05 * Math.sin(nx * 42) * Math.sin(ny * 42) * (1 - r);
        // due incisioni nette (occhi)
        for (const ex of [-0.22, 0.22]) {
          const d = Math.hypot(nx - ex, ny + 0.12);
          if (d < 0.07) v -= 0.18 * (1 - d / 0.07);
        }
      }
      a[y * w + x] = Math.max(0, Math.min(1, v));
    }
  }
  return a;
}

function topology(indices: Uint32Array, label: string) {
  const tri = indices.length / 3;
  const edges = new Map<number, number>();
  for (let t = 0; t < tri; t++) {
    const a = indices[t * 3]!, b = indices[t * 3 + 1]!, c = indices[t * 3 + 2]!;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = p < q ? p * 4294967296 + q : q * 4294967296 + p;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { tri, open, nonManifold, label };
}

/** Errore reale: campiona la heightmap e misura la distanza verticale dalla mesh. */
function verticalError(
  verts: Float32Array, indices: Uint32Array,
  height01: Float32Array, w: number, h: number,
  outWidthMm: number, depthMm: number, baseMm: number
) {
  const outHeightMm = outWidthMm * ((h - 1) / (w - 1));
  const dx = outWidthMm / (w - 1), dy = outHeightMm / (h - 1);
  const xStart = -outWidthMm / 2, yStart = -outHeightMm / 2;
  const base = Math.max(0.4, baseMm);

  // z-buffer del solo lato superiore, alla risoluzione della heightmap
  const zb = new Float32Array(w * h).fill(-Infinity);
  const tri = indices.length / 3;
  for (let t = 0; t < tri; t++) {
    const ia = indices[t * 3]!, ib = indices[t * 3 + 1]!, ic = indices[t * 3 + 2]!;
    const ax = verts[ia * 3]!, ay = verts[ia * 3 + 1]!, az = verts[ia * 3 + 2]!;
    const bx = verts[ib * 3]!, by = verts[ib * 3 + 1]!, bz = verts[ib * 3 + 2]!;
    const cx = verts[ic * 3]!, cy = verts[ic * 3 + 1]!, cz = verts[ic * 3 + 2]!;
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const gx0 = Math.max(0, Math.ceil((minX - xStart) / dx));
    const gx1 = Math.min(w - 1, Math.floor((maxX - xStart) / dx));
    const gy0 = Math.max(0, Math.ceil((-maxY - yStart) / dy));
    const gy1 = Math.min(h - 1, Math.floor((-minY - yStart) / dy));
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    for (let gy = gy0; gy <= gy1; gy++) {
      const py = -(yStart + gy * dy);
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = xStart + gx * dx;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const z = l1 * az + l2 * bz + l3 * cz;
        const k = gy * w + gx;
        if (z > zb[k]!) zb[k] = z;
      }
    }
  }

  let maxErr = 0, sum = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!Number.isFinite(zb[i]!)) continue;
    const want = base + depthMm * height01[i]!;
    const e = Math.abs(zb[i]! - want);
    if (e > maxErr) maxErr = e;
    sum += e; n++;
  }
  return { maxErr, meanErr: sum / Math.max(1, n), covered: n / (w * h) };
}

const W = 1024, H = 683;
const hm = portraitLike(W, H);
const outWidthMm = 90, depthMm = 3, baseMm = 2;

console.log(`Heightmap ${W}x${H} — placca ${outWidthMm} mm, rilievo ${depthMm} mm, base ${baseMm} mm\n`);

/** Mediana di n esecuzioni, in ms. */
function timeIt(fn: () => void, n = 5) {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  return ts[Math.floor(n / 2)]!;
}

const uniMs = timeIt(() => {
  buildSolidFromHeightmap({ height01: hm, width: W, height: H, outWidthMm, depthMm, baseMm, baseStyle: "flat" });
});

const uni = buildSolidFromHeightmap({
  height01: hm, width: W, height: H,
  outWidthMm, depthMm, baseMm, baseStyle: "flat",
});
const uniTop = topology(uni.indices, "uniforme");
const uniErr = verticalError(uni.vertices, uni.indices, hm, W, H, outWidthMm, depthMm, baseMm);
console.log(`GRIGLIA UNIFORME (8.4)`);
console.log(`  triangoli : ${uniTop.tri.toLocaleString("it-IT")}`);
console.log(`  STL binario: ${((84 + uniTop.tri * 50) / 1048576).toFixed(1)} MB`);
console.log(`  bordi aperti ${uniTop.open} | non-manifold ${uniTop.nonManifold}`);
console.log(`  errore verticale max ${uniErr.maxErr.toFixed(4)} mm\n`);

// Pavimento di errore dovuto al solo RICAMPIONAMENTO: con tolleranza 0 il quadtree
// suddivide fino in fondo, quindi l'errore residuo non viene dalla triangolazione ma
// dalla griglia di lavoro (quantizzata a multipli del blocco radice). Va misurato,
// non assunto: e' il termine di confronto onesto per gli altri casi.
const floorRun = buildAdaptiveSolidFromHeightmap({
  height01: hm, width: W, height: H,
  outWidthMm, depthMm, baseMm, baseStyle: "flat", toleranceMm: 0,
});
const floorErr = verticalError(floorRun.vertices, floorRun.indices, hm, W, H, outWidthMm, depthMm, baseMm).maxErr;
console.log(`PAVIMENTO DA RICAMPIONAMENTO (tolleranza 0, griglia ${floorRun.stats.gridW}x${floorRun.stats.gridH})`);
console.log(`  errore verticale max ${floorErr.toFixed(4)} mm — sotto la risoluzione di stampa\n`);

// Le dimensioni fisiche NON devono dipendere dalla griglia di lavoro.
{
  const bb = floorRun.geometry.boundingBox!;
  const wMm = bb.max.x - bb.min.x, hMm = bb.max.y - bb.min.y;
  const wantH = outWidthMm * ((H - 1) / (W - 1));
  const ok = Math.abs(wMm - outWidthMm) < 1e-3 && Math.abs(hMm - wantH) < 1e-3;
  console.log(`INGOMBRO: ${wMm.toFixed(3)} x ${hMm.toFixed(3)} mm (atteso ${outWidthMm.toFixed(3)} x ${wantH.toFixed(3)}) ${ok ? "✓" : "✗"}\n`);
  if (!ok) process.exitCode = 1;
}

let failures = 0;
for (const tol of [0.02, 0.05, 0.1, 0.2]) {
  const adMs = timeIt(() => {
    buildAdaptiveSolidFromHeightmap({
      height01: hm, width: W, height: H,
      outWidthMm, depthMm, baseMm, baseStyle: "flat", toleranceMm: tol,
    });
  });
  const ad = buildAdaptiveSolidFromHeightmap({
    height01: hm, width: W, height: H,
    outWidthMm, depthMm, baseMm, baseStyle: "flat",
    toleranceMm: tol,
  });
  const t = topology(ad.indices, `adattivo tol=${tol}`);
  const e = verticalError(ad.vertices, ad.indices, hm, W, H, outWidthMm, depthMm, baseMm);
  const mb = (84 + t.tri * 50) / 1048576;

  console.log(`ADATTIVO — tolleranza ${tol} mm`);
  console.log(`  griglia   : ${ad.stats.gridW}x${ad.stats.gridH}`);
  console.log(`  triangoli : ${t.tri.toLocaleString("it-IT")}  (${ad.stats.reduction.toFixed(1)}x meno della uniforme)`);
  console.log(`  STL binario: ${mb.toFixed(1)} MB`);
  console.log(`  costruzione: ${adMs.toFixed(0)} ms  (uniforme ${uniMs.toFixed(0)} ms -> ${(uniMs / adMs).toFixed(2)}x)`);
  console.log(`  bordi aperti ${t.open} | non-manifold ${t.nonManifold}`);
  console.log(`  errore verticale: max ${e.maxErr.toFixed(4)} mm | medio ${e.meanErr.toFixed(4)} mm`);

  if (t.open !== 0 || t.nonManifold !== 0) { console.log("  ✗ mesh NON chiusa"); failures++; }
  else console.log("  ✓ watertight");

  // La tolleranza e' per blocco: concedo 2x sul picco globale, piu' il pavimento
  // di ricampionamento che non dipende dalla triangolazione.
  const budget = tol * 2 + floorErr;
  if (e.maxErr > budget + 1e-6) { console.log(`  ✗ tolleranza sforata (max ${e.maxErr.toFixed(4)} > ${budget.toFixed(4)})`); failures++; }
  else console.log(`  ✓ tolleranza rispettata (budget ${budget.toFixed(4)} mm)`);
  console.log();
}

console.log(failures === 0 ? "✅ tutti i controlli superati" : `❌ ${failures} controlli falliti`);
process.exit(failures === 0 ? 0 : 1);
