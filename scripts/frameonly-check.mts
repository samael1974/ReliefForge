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

console.log(fail ? `\n❌ ${fail} controllo/i fallito/i.` : "\n✅ tutti i controlli superati");
// Niente process.exit(): il WASM di manifold ha ancora handle aperti e libuv
// aborta con un assertion, facendo fallire la CI anche quando i controlli passano.
process.exitCode = fail ? 1 : 0;
