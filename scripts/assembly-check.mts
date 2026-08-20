// scripts/assembly-check.mts
//
// Verifica GEOMETRICA dell'assieme cornice + passepartout + rilievo, headless.
// Costruisce l'assieme con la stessa funzione usata dall'export dell'app
// (buildReliefAssemblyGeometry) e ne misura le proprieta' che contano per la stampa:
// watertight, numero di corpi, ingombri, e soprattutto se il rilievo resta VISIBILE.
//
// Uso:  pnpm assembly:check

import * as fs from "node:fs";
import * as path from "node:path";
import { buildReliefAssemblyGeometry } from "../src/components/relief/reliefStl";
import { WELD_BITE } from "../src/lib/relief/frame/assemblyLayout";

/** Heightmap sintetica: cupola centrale + gradino, abbastanza per un test geometrico. */
function makeHeightmap(w: number, h: number) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x / (w - 1)) * 2 - 1;
      const ny = (y / (h - 1)) * 2 - 1;
      const r = Math.hypot(nx, ny);
      const dome = Math.max(0, 1 - r * r);
      const step = nx > 0.45 ? 0.25 : 0;
      a[y * w + x] = Math.min(1, dome * 0.85 + step);
    }
  }
  return { normF32: a, w, h };
}

function analyze(geom: any, label: string) {
  const pos = geom.getAttribute("position");
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // bordi aperti su topologia indicizzata (manifold restituisce vertici saldati)
  const edges = new Map<string, number>();
  const ia = idx!.array as ArrayLike<number>;
  for (let t = 0; t < triCount; t++) {
    const a = ia[t * 3], b = ia[t * 3 + 1], c = ia[t * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }

  console.log(`\n--- ${label} ---`);
  console.log(`  triangoli      : ${triCount.toLocaleString("it-IT")}`);
  console.log(`  bbox X         : ${minX.toFixed(3)} .. ${maxX.toFixed(3)}  (${(maxX - minX).toFixed(3)} mm)`);
  console.log(`  bbox Y         : ${minY.toFixed(3)} .. ${maxY.toFixed(3)}  (${(maxY - minY).toFixed(3)} mm)`);
  console.log(`  bbox Z         : ${minZ.toFixed(3)} .. ${maxZ.toFixed(3)}  (${(maxZ - minZ).toFixed(3)} mm)`);
  console.log(`  bordi aperti   : ${open}`);
  console.log(`  non-manifold   : ${nonManifold}`);
  console.log(`  WATERTIGHT     : ${open === 0 && nonManifold === 0 ? "SI" : "NO"}`);
  return { triCount, minZ, maxZ, open, nonManifold };
}

const hm = makeHeightmap(220, 147);

const baseArgs = {
  hm,
  widthMm: 90,
  outputMode: "relief" as any,
  baseStyle: "flat" as any,
  frame: {
    solidMm: 2.5, frameHeightMm: 10, glassMm: 2 as const, glassClearanceMm: 0.3,
    lipMm: 3.2, pocketDepthMm: 2.5, cornerRadiusMm: 0, reliefGapMm: 0,
  },
};

const cases = [
  {
    name: "A. Cornice sola, rilievo 5mm (il caso del tuo STL)",
    args: { ...baseArgs, depthMm: 3, baseMm: 2, mat: null, reliefZmm: -1, matZmm: -1 },
  },
  {
    name: "B. Cornice + passepartout a gradoni, rilievo 5mm",
    args: {
      ...baseArgs, depthMm: 3, baseMm: 2, reliefZmm: 0, matZmm: 0,
      mat: { steps: 2 as const, totalBandsMm: 20, minBandMm: 6, thicknessMm: 3, stepDropMm: 0.8 },
    },
  },
  {
    name: "C. REGRESSIONE 8.4: rilievo SOTTILE 2mm + passepartout (prima spariva)",
    args: {
      ...baseArgs, depthMm: 1.2, baseMm: 0.8, reliefZmm: 0, matZmm: 0,
      mat: { steps: 1 as const, totalBandsMm: 12, minBandMm: 6, thicknessMm: 3, stepDropMm: 0.8 },
    },
  },
  {
    name: "D. Solo cornice (pezzi separati): deve CONTENERE il rilievo",
    args: { ...baseArgs, depthMm: 3, baseMm: 2, mat: null, reliefZmm: 0, matZmm: 0, frameOnly: true },
  },
  {
    name: "G. REGRESSIONE segnalata da Federico: battuta 3mm non deve entrare nel rilievo",
    args: {
      ...baseArgs, depthMm: 5, baseMm: 2, mat: null, reliefZmm: 0, matZmm: 0, toleranceMm: 0.06,
      frame: { solidMm: 5, frameHeightMm: 21, glassMm: 2 as const, glassClearanceMm: 0.25,
               lipMm: 3, pocketDepthMm: 3.6, cornerRadiusMm: 0, reliefGapMm: 0.3 },
    },
  },
  {
    name: "E. MESH ADATTIVA + cornice: la cornice deve combaciare come con quella uniforme",
    args: { ...baseArgs, depthMm: 3, baseMm: 2, mat: null, reliefZmm: -1, matZmm: -1, toleranceMm: 0.06 },
  },
  {
    name: "H. ANGOLI ARROTONDATI r=8 + battuta (percorso booleano mai testato)",
    args: {
      ...baseArgs, depthMm: 5, baseMm: 2, mat: null, reliefZmm: 0, matZmm: 0, toleranceMm: 0.06,
      frame: { solidMm: 5, frameHeightMm: 21, glassMm: 2 as const, glassClearanceMm: 0.25,
               lipMm: 3, pocketDepthMm: 3.6, cornerRadiusMm: 8, reliefGapMm: 0.3 },
    },
  },
  {
    name: "I. ANGOLI ARROTONDATI r=12 (massimo dello slider) + passepartout",
    args: {
      ...baseArgs, depthMm: 3, baseMm: 2, reliefZmm: 0, matZmm: 0, toleranceMm: 0.06,
      frame: { solidMm: 5, frameHeightMm: 21, glassMm: 2 as const, glassClearanceMm: 0.25,
               lipMm: 3, pocketDepthMm: 3.6, cornerRadiusMm: 12, reliefGapMm: 0.3 },
      mat: { steps: 2 as const, totalBandsMm: 20, minBandMm: 6, thicknessMm: 3, stepDropMm: 0.8 },
    },
  },
  {
    name: "L. ANGOLI ARROTONDATI r=12 su cornice SOTTILE (raggio > spessore bordo)",
    args: {
      ...baseArgs, depthMm: 5, baseMm: 2, mat: null, reliefZmm: 0, matZmm: 0, toleranceMm: 0.06,
      frame: { solidMm: 2, frameHeightMm: 12, glassMm: 2 as const, glassClearanceMm: 0.25,
               lipMm: 3, pocketDepthMm: 2, cornerRadiusMm: 12, reliefGapMm: 0.3 },
    },
  },
  {
    name: "F. MESH ADATTIVA + passepartout a gradoni",
    args: {
      ...baseArgs, depthMm: 3, baseMm: 2, reliefZmm: 0, matZmm: 0, toleranceMm: 0.06,
      mat: { steps: 2 as const, totalBandsMm: 20, minBandMm: 6, thicknessMm: 3, stepDropMm: 0.8 },
    },
  },
];

/**
 * Distanza con segno dal perimetro rounded-rect (positiva = FUORI).
 * Serve a intercettare il difetto tipico degli angoli arrotondati: rilievo e
 * passepartout sono rettangoli SPIGOLOSI, la cornice e' curva, quindi senza
 * l'intersezione booleana di clip i loro angoli sbucherebbero oltre la parete.
 */
function roundedRectSdf(x: number, y: number, hw: number, hh: number, r: number) {
  const rr = Math.max(0, Math.min(r, hw, hh));
  const qx = Math.abs(x) - (hw - rr);
  const qy = Math.abs(y) - (hh - rr);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
}

let failures = 0;
const outDir = path.resolve("scripts/out");
fs.mkdirSync(outDir, { recursive: true });

for (const c of cases) {
  const { geometry, layout } = await buildReliefAssemblyGeometry(c.args as any);
  const r = analyze(geometry, c.name);

  console.log(`  apertura visibile : ${layout.visibleApertureW.toFixed(2)} x ${layout.visibleApertureH.toFixed(2)} mm`);
  console.log(`  copre il rilievo  : ${layout.reliefCoverPerSideMm.toFixed(2)} mm/lato`);
  if (layout.matFrontZ !== null) {
    console.log(`  passepartout Z    : fronte ${layout.matFrontZ.toFixed(2)} | rilievo fronte ${layout.reliefFrontZ.toFixed(2)} | margine ${(layout.reliefFrontZ - layout.matFrontZ).toFixed(2)} mm`);
  }
  for (const w of layout.warnings) console.log(`  ⚠ ${w}`);

  // Dalla 8.18 il BORDINO copre il rilievo apposta: e' l'appoggio su cui il
  // bassorilievo si posa e si incolla, quindi la sovrapposizione dichiarata e' la
  // sporgenza. Resta pero' un difetto se la cornice entra OLTRE quella sporgenza
  // (piu' il morso di saldatura): li' starebbe mangiando il bassorilievo.
  const coperturaAmmessa = Math.max(0, layout.effectiveLipMm) + WELD_BITE;
  if (layout.reliefCoverPerSideMm > coperturaAmmessa + 1e-6) {
    console.log(`  ✗ la cornice entra nel rilievo di ${layout.reliefCoverPerSideMm.toFixed(2)} mm/lato, oltre la sporgenza dichiarata (max ${coperturaAmmessa.toFixed(2)})`);
    failures++;
  } else {
    console.log(`  ✓ sovrapposizione cornice ${layout.reliefCoverPerSideMm.toFixed(2)} mm/lato (solo saldatura)`);
  }

  // Il vetro deve stare DAVANTI al rilievo, mai dentro.
  if (layout.showGlass) {
    const glassBackZ = layout.glassZ - layout.glassThkMm / 2;
    const intrusion = layout.reliefFrontZ - glassBackZ;
    if (intrusion > 1e-6) { console.log(`  ✗ il vetro entra nel rilievo di ${intrusion.toFixed(2)} mm`); failures++; }
    else console.log(`  ✓ vetro appoggiato sul fronte del rilievo (scarto ${(-intrusion).toFixed(2)} mm)`);
  }

  // Angoli arrotondati: nessun vertice puo' stare FUORI dal profilo esterno curvo.
  const R = (c.args as any).frame?.cornerRadiusMm ?? 0;
  if (R > 0.01) {
    const pos = geometry.getAttribute("position");
    let worst = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = roundedRectSdf(pos.getX(i), pos.getY(i) - layout.centerY, layout.frameOuterW / 2, layout.frameOuterH / 2, R);
      if (d > worst) worst = d;
    }
    if (worst > 0.01) { console.log(`  ✗ materiale FUORI dal profilo curvo di ${worst.toFixed(3)} mm (angoli che sbucano)`); failures++; }
    else console.log(`  ✓ nessun angolo sbuca dal profilo curvo (scarto max ${worst.toFixed(3)} mm)`);
  }

  if (r.open !== 0 || r.nonManifold !== 0) { console.log("  ✗ NON watertight"); failures++; }

  // Il rilievo deve restare davanti al passepartout, sempre.
  if (layout.matFrontZ !== null) {
    const margin = layout.reliefFrontZ - layout.matFrontZ;
    if (margin < 0.79) { console.log(`  ✗ rilievo sommerso dal passepartout (margine ${margin.toFixed(2)} mm)`); failures++; }
    else console.log(`  ✓ rilievo sporge di ${margin.toFixed(2)} mm dal passepartout`);
  }
}

console.log(failures === 0 ? "\n✅ tutti i controlli superati" : `\n❌ ${failures} controlli falliti`);
process.exit(failures === 0 ? 0 : 1);
