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
import { computeAssemblyLayout } from "../src/lib/relief/frame/assemblyLayout";
import { outlinePoints, raggioNellaDirezione, outlineExtent } from "../src/lib/relief/frame/outline";

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
  // Niente passi fissi: la densita' la decide la risoluzione del sorgente.
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

// --------------------------------------------------------------------------
// ALLINEAMENTO: il rilievo tondo deve occupare lo STESSO posto di quello
// rettangolare. Se i due mesher centrano il pezzo in modo diverso, in anteprima
// il disco appare disassato rispetto alla cornice, che invece si posiziona sulle
// quote del layout.
// --------------------------------------------------------------------------
function bbox(pos: ArrayLike<number>, count: number) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, x1, y0, y1, z0, z1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
const bA = bbox(diretta.vertices, diretta.vertices.length / 3);
const rettPos = (rett.geometry.getAttribute("position") as THREE.BufferAttribute).array as ArrayLike<number>;
const bR = bbox(rettPos, rettPos.length / 3);
console.log("ALLINEAMENTO fra i due mesher");
console.log(`   tondo:        X [${bA.x0.toFixed(2)}, ${bA.x1.toFixed(2)}]  Y [${bA.y0.toFixed(2)}, ${bA.y1.toFixed(2)}]  Z [${bA.z0.toFixed(2)}, ${bA.z1.toFixed(2)}]`);
console.log(`   rettangolare: X [${bR.x0.toFixed(2)}, ${bR.x1.toFixed(2)}]  Y [${bR.y0.toFixed(2)}, ${bR.y1.toFixed(2)}]  Z [${bR.z0.toFixed(2)}, ${bR.z1.toFixed(2)}]`);
check(Math.abs(bA.cx - bR.cx) < 0.01, `stesso centro in X (${bA.cx.toFixed(2)} vs ${bR.cx.toFixed(2)})`);
check(Math.abs(bA.cy - bR.cy) < 0.01, `stesso centro in Y (${bA.cy.toFixed(2)} vs ${bR.cy.toFixed(2)})`);
check(Math.abs(bA.z0 - bR.z0) < 0.01, `stessa quota di base in Z (${bA.z0.toFixed(2)} vs ${bR.z0.toFixed(2)})`);
console.log("");

// FEDELTA' DI CAMPIONAMENTO: e' la misura che mancava al primo benchmark. Un bordo
// perfetto e un tempo ottimo non servono a niente se la superficie viene campionata
// molto piu' grossa del pixel del sorgente: il rilievo esce impastato.
const pxMm = DIAMETRO / Math.min(W, H);
// I segmenti sul bordo si contano dai vertici che stanno sul raggio esterno, non
// stimandoli dal totale dei triangoli: la griglia polare non e' quadrata, i passi
// angolari sono molti piu' di quelli radiali e la stima sbaglierebbe di 2-3 volte.
const segmentiBordo = Math.max(1, bordoA.n / 2);
const passoBordo = (Math.PI * DIAMETRO) / segmentiBordo;
console.log("FEDELTA' DI CAMPIONAMENTO");
console.log(`   pixel del sorgente ${pxMm.toFixed(3)} mm   passo sul bordo ${passoBordo.toFixed(3)} mm (${segmentiBordo} segmenti)`);
check(passoBordo < pxMm * 1.5, `il bordo e' campionato come il sorgente (${(passoBordo / pxMm).toFixed(2)}x il pixel)`);
console.log("");

check(apertiA === 0, "A: mesh chiusa (watertight per costruzione)");
check(bordoA.scarto < 0.01, `A: bordo circolare esatto (scarto ${bordoA.scarto.toFixed(4)} mm)`);
check(diretta.triangles > 1000, `A: risoluzione sensata (${diretta.triangles} triangoli)`);
check(apertiB === 0, `B: mesh chiusa dopo la booleana (spigoli aperti ${apertiB})`);


// ---------------------------------------------------------------------------
// DOMINIO RETTANGOLARE AD ANGOLI ARROTONDATI: serve a far combaciare il rilievo
// con una cornice arrotondata. Senza, gli spigoli quadrati sbordano oltre il
// raggio della cornice - e in anteprima si vedeva, nell'export no.
// ---------------------------------------------------------------------------
console.log("");
console.log("RILIEVO AD ANGOLI ARROTONDATI");
console.log("");
{
  const Wmm = 120, Hmm = 90, Rc = 15;
  const arr = buildCircularSolidFromHeightmap({
    height01, width: W, height: H,
    outDiameterMm: Wmm, outWidthMm: Wmm, outHeightMm: Hmm, cornerRadiusMm: Rc,
    depthMm: DEPTH, baseMm: BASE, maxCells: 200_000,
  });
  let spigoli = 0, maxX = 0, maxY = 0;
  for (let i = 0; i < arr.vertices.length; i += 3) {
    const x = Math.abs(arr.vertices[i]!), y = Math.abs(arr.vertices[i + 1]!);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (x > Wmm / 2 - 0.05 && y > Hmm / 2 - 0.05) spigoli++;
  }
  console.log(`   ingombro ${(maxX * 2).toFixed(2)} x ${(maxY * 2).toFixed(2)} mm, raggio richiesto ${Rc} mm`);
  check(openEdges(arr.indices) === 0, "mesh chiusa anche sul dominio arrotondato");
  check(spigoli === 0, `nessuno spigolo quadro superstite (${spigoli} vertici nell'angolo)`);
  check(Math.abs(maxX * 2 - Wmm) < 0.2 && Math.abs(maxY * 2 - Hmm) < 0.2, "ingombro pari alle quote richieste");
}


// ---------------------------------------------------------------------------
// CENTRAMENTO CORNICE / RILIEVO. La cornice viene piazzata a layout.centerY.
// Se quel valore non coincide con il centro reale della mesh del rilievo, in
// anteprima il bassorilievo esce dalla cornice: e' il difetto visto in foto.
// ---------------------------------------------------------------------------
console.log("");
console.log("CENTRAMENTO CORNICE / RILIEVO");
console.log("");
{
  // Si replica l'ancoraggio dell'export (X e Z centrati, Y appoggiata a 0, poi +1)
  // sulla mesh VERA e si confronta il centro risultante con quello dove il layout
  // piazza la cornice. Se non coincidono, il rilievo esce dalla cornice.
  const bb = bbox(diretta.vertices, diretta.vertices.length / 3);
  const altezza = bb.y1 - bb.y0;
  const centroDopoAncoraggio = 1 + altezza / 2;
  const L = computeAssemblyLayout({
    reliefW: bb.x1 - bb.x0, reliefH: altezza, reliefThicknessMm: BASE + DEPTH,
    reliefYOffset: 1, reliefZmm: 0, matZmm: 0,
    frame: {
      solidMm: 5, frameHeightMm: 21, glassMm: 2, glassClearanceMm: 0.25,
      lipMm: 3, pocketDepthMm: 3.6, cornerRadiusMm: 0, reliefGapMm: 0.2,
    },
    mat: null, welded: false,
  } as any);
  console.log(`   centro del rilievo ancorato ${centroDopoAncoraggio.toFixed(2)} mm   cornice a ${L.centerY.toFixed(2)} mm`);
  check(Math.abs(L.centerY - centroDopoAncoraggio) < 0.01, `cornice e rilievo concentrici (scarto ${(L.centerY - centroDopoAncoraggio).toFixed(3)} mm)`);
  check(Math.abs(bb.y0 + bb.y1) < 0.01, "la mesh esce centrata sull'origine: l'anteprima DEVE ri-ancorarla come l'export");
}


// ---------------------------------------------------------------------------
// ORIENTAMENTO. I due mesher devono mappare la stessa riga dell'immagine sullo
// stesso lato del pezzo. Si usa una heightmap asimmetrica: alta in ALTO a
// SINISTRA dell'immagine, piatta altrove, e si guarda dove finisce il rilievo.
// ---------------------------------------------------------------------------
console.log("");
console.log("ORIENTAMENTO DEI DUE MESHER");
console.log("");
{
  const marker = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // riga 0 = ALTO dell'immagine, colonna 0 = SINISTRA
      if (y < H * 0.3 && x < W * 0.3) marker[y * W + x] = 1;
    }
  }
  /** Baricentro (X,Y) dei vertici piu' alti in Z: dove sta il rilievo. */
  const dove = (verts: ArrayLike<number>, n: number) => {
    let zMax = -Infinity;
    for (let i = 0; i < n; i++) zMax = Math.max(zMax, verts[i * 3 + 2]!);
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (verts[i * 3 + 2]! > zMax - 0.05) { sx += verts[i * 3]!; sy += verts[i * 3 + 1]!; k++; }
    }
    return { x: sx / Math.max(1, k), y: sy / Math.max(1, k) };
  };
  const r = buildSolidFromHeightmap({
    height01: marker, width: W, height: H,
    outWidthMm: DIAMETRO, depthMm: DEPTH, baseMm: BASE, baseStyle: "flat",
  });
  const rp = (r.geometry.getAttribute("position") as THREE.BufferAttribute).array as ArrayLike<number>;
  const dr = dove(rp, rp.length / 3);
  const c = buildCircularSolidFromHeightmap({
    height01: marker, width: W, height: H,
    outDiameterMm: DIAMETRO, outWidthMm: DIAMETRO, outHeightMm: DIAMETRO, cornerRadiusMm: 0,
    depthMm: DEPTH, baseMm: BASE, maxCells: 120_000,
  });
  const dc = dove(c.vertices, c.vertices.length / 3);
  console.log(`   rettangolare: rilievo a X ${dr.x.toFixed(1)}  Y ${dr.y.toFixed(1)}`);
  console.log(`   tondo:        rilievo a X ${dc.x.toFixed(1)}  Y ${dc.y.toFixed(1)}`);
  check(Math.sign(dr.x) === Math.sign(dc.x), `stesso lato in X (${Math.sign(dr.x)} vs ${Math.sign(dc.x)})`);
  check(Math.sign(dr.y) === Math.sign(dc.y), `stesso lato in Y (${Math.sign(dr.y)} vs ${Math.sign(dc.y)})`);
}


// ---------------------------------------------------------------------------
// RILIEVO SAGOMATO come la cornice: ellisse e poligoni. Senza, gli spigoli del
// bassorilievo sbordano oltre l'apertura.
// ---------------------------------------------------------------------------
console.log("");
console.log("RILIEVO SAGOMATO SULLA CORNICE");
console.log("");
{
  const W_MM = 130, H_MM = 90;
  const prova = (nome: string, pts: any[]) => {
    const m = buildCircularSolidFromHeightmap({
      height01, width: W, height: H,
      outDiameterMm: W_MM, outWidthMm: W_MM, outHeightMm: H_MM,
      depthMm: DEPTH, baseMm: BASE, outlinePts: pts, maxCells: 150_000,
    });
    // Nessun vertice deve stare fuori dal contorno richiesto.
    let fuori = 0, maxR = 0;
    for (let i = 0; i < m.vertices.length; i += 3) {
      const x = m.vertices[i]!, y = m.vertices[i + 1]!;
      const r = Math.hypot(x, y);
      const rMax = raggioNellaDirezione(pts, Math.atan2(y, x));
      if (r > rMax + 0.05) fuori++;
      maxR = Math.max(maxR, r);
    }
    console.log(`  ${nome.padEnd(10)} ${m.triangles} triangoli, raggio massimo ${maxR.toFixed(1)} mm`);
    check(openEdges(m.indices) === 0, `${nome}: mesh chiusa`);
    check(fuori === 0, `${nome}: nessun vertice fuori dal contorno (${fuori})`);
    return m;
  };

  const ell = prova("ellisse", outlinePoints({ kind: "ellipse", halfW: W_MM / 2, halfH: H_MM / 2 }, 256));
  const rombo = prova("rombo", outlinePoints({ kind: "polygon", halfW: W_MM / 2, halfH: H_MM / 2, sides: 4 }, 64));
  // Il rombo ha meno della meta' dell'area dell'ellisse: se il rilievo non fosse
  // sagomato, i due pezzi verrebbero identici.
  check(rombo.triangles > 0 && ell.triangles > 0, "entrambe le forme producono un solido");
}

// ---------------------------------------------------------------------------
// CORNICE E RILIEVO DELLA STESSA MISURA. Se l'impronta della cornice viene dedotta
// dalle proporzioni dell'IMMAGINE mentre il rilievo e' sagomato su un poligono o
// un'ellisse, i due pezzi escono di dimensioni diverse: il rilievo sborda.
// ---------------------------------------------------------------------------
console.log("");
console.log("CORNICE E RILIEVO DELLA STESSA MISURA");
console.log("");
{
  const GIOCO = 0.2;
  const prova = (nome: string, pts: any[]) => {
    const e = outlineExtent(pts);
    const L = computeAssemblyLayout({
      reliefW: e.w, reliefH: e.h, reliefThicknessMm: BASE + DEPTH,
      reliefYOffset: 1, reliefZmm: 0, matZmm: 0,
      frame: {
        solidMm: 5, frameHeightMm: 21, glassMm: 2, glassClearanceMm: 0.25,
        lipMm: 3, pocketDepthMm: 3.6, cornerRadiusMm: 0, reliefGapMm: GIOCO,
      },
      mat: null, welded: false,
    } as any);
    console.log(`  ${nome.padEnd(10)} rilievo ${e.w.toFixed(1)}x${e.h.toFixed(1)} — cavita' ${L.framePocketW.toFixed(1)}x${L.framePocketH.toFixed(1)} mm`);
    check(Math.abs(L.framePocketW - (e.w + 2 * GIOCO)) < 0.05, `${nome}: cavita' = rilievo + gioco in larghezza`);
    check(Math.abs(L.framePocketH - (e.h + 2 * GIOCO)) < 0.05, `${nome}: cavita' = rilievo + gioco in altezza`);
  };
  prova("esagono", outlinePoints({ kind: "polygon", halfW: 60, halfH: 60, sides: 6 }, 64));
  prova("ellisse", outlinePoints({ kind: "ellipse", halfW: 65, halfH: 45 }, 128));
}

console.log("");
console.log(fail ? `❌ ${fail} controllo/i fallito/i.` : "✅ tutti i controlli superati");
process.exitCode = fail ? 1 : 0;
