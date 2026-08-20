// scripts/frameonly-check.mts
//
// Progetto di SOLA CORNICE: dalla 8.10 la cornice non richiede piu' un bassorilievo.
// Senza rilievo le proporzioni vengono da un'apertura dichiarata (larghezza x altezza),
// non piu' dedotte dall'immagine.
//
// Qui si verifica che quel percorso produca davvero una geometria stampabile e che
// l'apertura dichiarata si ritrovi nelle quote del pezzo.
//
// Uso:  pnpm frameonly:check

import { buildReliefAssemblyGeometry } from "../src/components/relief/reliefStl";
import { buildFrameRectPocket } from "../src/lib/relief/frame/buildFrameRectPocket";

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) fail++; };

/** La stessa heightmap piatta che lo Studio sintetizza quando non c'e' rilievo. */
function aperturaPiatta(larghezzaMm: number, altezzaMm: number) {
  const w = 65;
  const h = Math.max(2, Math.round(64 * altezzaMm / larghezzaMm) + 1);
  return { normF32: new Float32Array(w * h), w, h };
}

const APERTURA_W = 130;
const APERTURA_H = 100;
const BORDO = 5;

console.log(`SOLA CORNICE — apertura ${APERTURA_W}x${APERTURA_H} mm, bordo ${BORDO} mm\n`);

const { geometry } = await buildReliefAssemblyGeometry({
  hm: aperturaPiatta(APERTURA_W, APERTURA_H),
  widthMm: APERTURA_W,
  depthMm: 4,
  baseMm: 3,
  outputMode: "relief",
  baseStyle: "flat",
  frameOnly: true,
  frame: {
    solidMm: BORDO, frameHeightMm: 21, glassMm: 2, glassClearanceMm: 0.25,
    lipMm: 3.0, pocketDepthMm: 3.6, cornerRadiusMm: 0, reliefGapMm: 0.3,
  },
  mat: null,
} as any);

const pos = geometry.getAttribute("position");
// La geometria dell assieme e indicizzata: i triangoli si contano dall indice,
// non dai vertici, altrimenti il numero non significa nulla.
const triangoli = geometry.index ? geometry.index.count / 3 : (pos ? pos.count / 3 : 0);
check(!!pos && pos.count > 0, `geometria non vuota (${triangoli} triangoli, ${pos ? pos.count : 0} vertici)`);
check(triangoli >= 24, `abbastanza triangoli per una cornice con apertura (${triangoli})`);

let finiti = true;
for (let i = 0; i < pos.count && finiti; i++) {
  if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) finiti = false;
}
check(finiti, "nessun vertice non finito");

geometry.computeBoundingBox();
const bb = geometry.boundingBox!;
const dx = bb.max.x - bb.min.x;
const dy = bb.max.y - bb.min.y;
const dz = bb.max.z - bb.min.z;
console.log(`  ingombro esterno: ${dx.toFixed(2)} x ${dy.toFixed(2)} x ${dz.toFixed(2)} mm`);

// La cornice deve circondare l'apertura: piu' larga e piu' alta di quella, ma non
// smisurata. Il bordo aggiunge circa BORDO per lato.
check(dx > APERTURA_W && dx < APERTURA_W + 6 * BORDO, `larghezza esterna oltre l'apertura (${dx.toFixed(2)} > ${APERTURA_W})`);
check(dy > APERTURA_H && dy < APERTURA_H + 6 * BORDO, `altezza esterna oltre l'apertura (${dy.toFixed(2)} > ${APERTURA_H})`);
check(dz > 0.5, `spessore reale (${dz.toFixed(2)} mm)`);

// L'apertura NON deve essere quadrata: e' l'errore in cui si cadeva prima, quando
// senza heightmap l'impronta ripiegava su un quadrato di lato = larghezza.
check(Math.abs(dx - dy) > 1, `l'apertura rettangolare e' stata rispettata (non un quadrato)`);


// ---------------------------------------------------------------------------
// CORNICE ROTONDA
// Un cerchio e' un rettangolo con raggio d'angolo pari a meta' lato: roundedBox
// clampa il raggio a w/2, quindi un raggio enorme rende tondo ogni pezzo alla
// propria misura. Qui si verifica che il risultato sia davvero un cerchio.
// ---------------------------------------------------------------------------
const DIAMETRO = 120;
console.log(`
SOLA CORNICE ROTONDA — diametro ${DIAMETRO} mm, bordo ${BORDO} mm
`);

const tonda = await buildReliefAssemblyGeometry({
  hm: aperturaPiatta(DIAMETRO, DIAMETRO),
  widthMm: DIAMETRO,
  depthMm: 4,
  baseMm: 3,
  outputMode: "relief",
  baseStyle: "flat",
  frameOnly: true,
  frame: {
    solidMm: BORDO, frameHeightMm: 21, glassMm: 2, glassClearanceMm: 0.25,
    lipMm: 3.0, pocketDepthMm: 3.6, cornerRadiusMm: 1e6, reliefGapMm: 0.3,
  },
  mat: null,
} as any);

const gp = tonda.geometry.getAttribute("position");
const gtri = tonda.geometry.index ? tonda.geometry.index.count / 3 : gp.count / 3;
tonda.geometry.computeBoundingBox();
const tb = tonda.geometry.boundingBox!;
const tdx = tb.max.x - tb.min.x;
const tdy = tb.max.y - tb.min.y;
console.log(`  ingombro esterno: ${tdx.toFixed(2)} x ${tdy.toFixed(2)} mm, ${gtri} triangoli`);

// Un cerchio ha larghezza e altezza uguali: se restasse un rettangolo, qui si vede.
check(Math.abs(tdx - tdy) < 0.5, `sezione circolare (scarto X-Y ${Math.abs(tdx - tdy).toFixed(3)} mm)`);

// Il bordo reale non e' solo solidMm: fra apertura e bordo ci sono anche la
// battuta (lipMm) e il gioco per il rilievo (reliefGapMm). Misurato sul caso
// rettangolare qui sopra: 146.60 - 130 = 16.60 = 2 x (5 + 3.0 + 0.3).
const BORDO_REALE = BORDO + 3.0 + 0.3;
const attesoEsterno = DIAMETRO + 2 * BORDO_REALE;
check(Math.abs(tdx - attesoEsterno) < 1, `diametro esterno = apertura + 2 x (bordo + battuta + gioco) (${tdx.toFixed(2)} vs ${attesoEsterno.toFixed(2)})`);

// Una circonferenza discretizzata costa molti piu' triangoli di 4 spigoli vivi:
// se il numero restasse quello della cornice quadra, il tondo non c'e'.
check(gtri > 200, `circonferenza discretizzata, non 4 spigoli (${gtri} triangoli)`);

let tfiniti = true;
for (let i = 0; i < gp.count && tfiniti; i++) {
  if (!Number.isFinite(gp.getX(i)) || !Number.isFinite(gp.getY(i)) || !Number.isFinite(gp.getZ(i))) tfiniti = false;
}
check(tfiniti, "nessun vertice non finito");


// ---------------------------------------------------------------------------
// DOPPIA BATTUTA: sede vetro davanti al vassoio del rilievo.
// Si misura sulla geometria vera: per ogni quota Z si prende la meta'-apertura
// (il vertice piu' vicino all'asse). Con la sede vetro deve comparire un livello
// in piu', piu' stretto, davanti al vassoio: e' il labbro che trattiene il vetro.
// ---------------------------------------------------------------------------
const SEAT = 2.0;      // larghezza radiale del labbro
const SEAT_D = 1.2;    // spessore del labbro

/** Raggi (meta'-apertura) presenti nella mesh, escluso il muro esterno.
 *  Prendere il minimo per quota Z non basta: il livello del vassoio resta nascosto
 *  dietro a quello del labbro, che sulla stessa quota e' piu' vicino all'asse. */
function apertureLevels(g: any, esternoMax: number): number[] {
  const pos = g.getAttribute("position");
  const set = new Set<number>();
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(pos.getX(i));
    if (ax < esternoMax) set.add(Math.round(ax * 10) / 10);
  }
  return [...set].sort((a, b) => a - b);
}

async function cornice(seat: number, seatD: number) {
  const r = await buildReliefAssemblyGeometry({
    hm: aperturaPiatta(APERTURA_W, APERTURA_H),
    widthMm: APERTURA_W, depthMm: 4, baseMm: 3,
    outputMode: "relief", baseStyle: "flat", frameOnly: true,
    frame: {
      solidMm: BORDO, frameHeightMm: 21, glassMm: 2, glassClearanceMm: 0.25,
      lipMm: 3.0, pocketDepthMm: 3.6, cornerRadiusMm: 0, reliefGapMm: 0.3,
      glassSeatMm: seat, glassSeatDepthMm: seatD,
    },
    mat: null,
  } as any);
  return r.geometry;
}

console.log(`
DOPPIA BATTUTA — labbro ${SEAT} mm largo, ${SEAT_D} mm spesso
`);

// Il muro esterno sta a (apertura + 2*(bordo+battuta+gioco))/2: si esclude.
const ESTERNO = (APERTURA_W + 2 * (BORDO + 3.0 + 0.3)) / 2 - 0.5;
const senza = apertureLevels(await cornice(0, 0), ESTERNO);
const con = apertureLevels(await cornice(SEAT, SEAT_D), ESTERNO);
console.log(`  aperture senza sede vetro: ${senza.join(", ")} mm`);
console.log(`  aperture con  sede vetro: ${con.join(", ")} mm`);

check(con.length > senza.length, `un gradino in piu' con la sede vetro (${senza.length} -> ${con.length} livelli)`);

// Il vassoio del rilievo resta dov'era: la sede vetro non deve spostarlo.
const vassoio = Math.max(...senza);
check(con.some((v) => Math.abs(v - vassoio) < 0.15), `il vassoio del rilievo non si e' spostato (${vassoio} mm)`);

// Il labbro deve stringere l'apertura di esattamente SEAT per lato.
const labbroAtteso = vassoio - SEAT;
check(con.some((v) => Math.abs(v - labbroAtteso) < 0.15), `labbro a ${labbroAtteso.toFixed(1)} mm dall'asse (stretto di ${SEAT} mm per lato)`);

// Spento deve restare identico a prima: chi stampa gia' non deve vedere differenze.
check(senza.length === 2, `con la sede spenta la cornice resta a due soli raggi (${senza.join(', ')})`);


// ---------------------------------------------------------------------------
// ANTEPRIMA vs EXPORT
// La cornice e' costruita DUE volte: tassellata a mano per l'anteprima 3D,
// in CSG per l'export. Se divergono, te ne accorgi con il pezzo stampato in mano.
// Qui si confrontano i raggi delle aperture prodotti dalle due implementazioni.
// ---------------------------------------------------------------------------
console.log("");
console.log("ANTEPRIMA vs EXPORT — stessa cornice, due costruttori");
console.log("");

const BACK_INNER = APERTURA_W + 2 * (3.0 + 0.3); // apertura + battuta + gioco per lato

function livelliTassellati(seat: number, seatD: number): number[] {
  const out = buildFrameRectPocket({
    innerWmm: BACK_INNER,
    innerHmm: APERTURA_H + 2 * (3.0 + 0.3),
    thicknessMm: BORDO,
    heightMm: 21,
    pocketDepthMm: 3.6,
    lipMm: 3.0,
    cornerRadiusMm: 0,
    glassSeatMm: seat,
    glassSeatDepthMm: seatD,
  });
  const set = new Set<number>();
  for (let i = 0; i < out.vertices.length; i += 3) {
    const ax = Math.abs(out.vertices[i]!);
    if (ax < ESTERNO) set.add(Math.round(ax * 10) / 10);
  }
  return [...set].sort((a, b) => a - b);
}

const antSenza = livelliTassellati(0, 0);
const antCon = livelliTassellati(SEAT, SEAT_D);
console.log(`  anteprima senza sede: ${antSenza.join(", ")} mm   (export: ${senza.join(", ")})`);
console.log(`  anteprima con  sede: ${antCon.join(", ")} mm   (export: ${con.join(", ")})`);

check(antSenza.join() === senza.join(), "senza sede vetro: anteprima ed export coincidono");
check(antCon.join() === con.join(), "con sede vetro: anteprima ed export coincidono");


// ---------------------------------------------------------------------------
// CORNICE TONDA: i gradini ci sono anche in tondo? e quante facce ha il cerchio?
// Su un cerchio i raggi si misurano dall'asse, non sull'asse X: sul tondo i
// vertici hanno |x| che varia con continuita' e non formerebbe livelli.
// ---------------------------------------------------------------------------
console.log("");
console.log("CORNICE TONDA — gradini e sfaccettatura");
console.log("");

const tondaSeat = await buildReliefAssemblyGeometry({
  hm: aperturaPiatta(DIAMETRO, DIAMETRO),
  widthMm: DIAMETRO, depthMm: 4, baseMm: 3,
  outputMode: "relief", baseStyle: "flat", frameOnly: true,
  frame: {
    solidMm: BORDO, frameHeightMm: 21, glassMm: 2, glassClearanceMm: 0.25,
    lipMm: 3.0, pocketDepthMm: 3.6, cornerRadiusMm: 1e6, reliefGapMm: 0.3,
    glassSeatMm: SEAT, glassSeatDepthMm: SEAT_D,
  },
  mat: null,
} as any);

const tp = tondaSeat.geometry.getAttribute("position");
tondaSeat.geometry.computeBoundingBox();
const tbb = tondaSeat.geometry.boundingBox!;
const cx = (tbb.max.x + tbb.min.x) / 2;
const cy = (tbb.max.y + tbb.min.y) / 2;

const raggi = new Set<number>();
let facceEsterne = 0;
const rEsterno = (DIAMETRO + 2 * (BORDO + 3.0 + 0.3)) / 2;
for (let i = 0; i < tp.count; i++) {
  const r = Math.hypot(tp.getX(i) - cx, tp.getY(i) - cy);
  raggi.add(Math.round(r * 10) / 10);
  if (Math.abs(r - rEsterno) < 0.15) facceEsterne++;
}
const listaRaggi = [...raggi].sort((a, b) => a - b);
const triTonda = tondaSeat.geometry.index ? tondaSeat.geometry.index.count / 3 : tp.count / 3;
console.log(`  raggi presenti: ${listaRaggi.join(", ")} mm`);
console.log(`  triangoli: ${triTonda}`);

const rVassoio = (DIAMETRO + 2 * (3.0 + 0.3)) / 2;
const rLabbro = rVassoio - SEAT;
const rApertura = rVassoio - 3.0;

check(listaRaggi.some((v) => Math.abs(v - rVassoio) < 0.15), `vassoio del rilievo a r=${rVassoio.toFixed(1)} mm`);
check(listaRaggi.some((v) => Math.abs(v - rApertura) < 0.15), `battuta del rilievo a r=${rApertura.toFixed(1)} mm (gradino piu' profondo)`);
check(listaRaggi.some((v) => Math.abs(v - rLabbro) < 0.15), `labbro del vetro a r=${rLabbro.toFixed(1)} mm`);

// Corda = circonferenza / numero di facce. Sopra i 2 mm il poligono si vede.
const corda = (2 * Math.PI * rEsterno) / Math.max(1, facceEsterne / 2);
console.log(`  corda sul cerchio esterno: ~${corda.toFixed(2)} mm`);
check(corda < 2.0, `curva liscia: corda ${corda.toFixed(2)} mm sotto i 2 mm`);

console.log(fail ? `\n❌ ${fail} controllo/i fallito/i.` : "\n✅ tutti i controlli superati");
// Niente process.exit(): il WASM di manifold ha ancora handle aperti e libuv
// aborta con un assertion, facendo fallire la CI anche quando i controlli passano.
process.exitCode = fail ? 1 : 0;
