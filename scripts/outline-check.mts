// scripts/outline-check.mts
//
// Contorni condivisi: rettangolo, arrotondato, cerchio, ellisse, poligono.
// La proprieta' che conta per una cornice e' UNA sola: rientrando di d, il bordo
// deve risultare largo d su TUTTO il perimetro. Se non e' costante, la cornice
// esce piu' sottile da qualche parte — ed e' li' che si rompe stampata.
//
// Uso:  pnpm outline:check

import { outlinePoints, insetOutline, outlineExtent, insetValido, type OutlineSpec, type Pt2 } from "../src/lib/relief/frame/outline";

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) fail++; };

/** Distanza minima di un punto dal contorno (segmenti, non solo vertici). */
function distanzaDalContorno(p: Pt2, pts: Pt2[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

/** Il bordo fra contorno esterno e contorno rientrato deve essere costante. */
function larghezzaBordo(spec: OutlineSpec, d: number, segmenti = 256) {
  const fuori = outlinePoints(spec, segmenti);
  const dentro = insetOutline(fuori, d);
  let min = Infinity, max = 0;
  for (const p of dentro) {
    const dist = distanzaDalContorno(p, fuori);
    min = Math.min(min, dist); max = Math.max(max, dist);
  }
  return { min, max, scarto: max - min, fuori, dentro };
}

const D = 5;
console.log(`CONTORNI — rientro di ${D} mm, il bordo deve restare largo ${D} ovunque`);
console.log("");

const casi: Array<[string, OutlineSpec]> = [
  ["rettangolo 130x90", { kind: "rect", halfW: 65, halfH: 45 }],
  ["arrotondato r=15", { kind: "rect", halfW: 65, halfH: 45, cornerRadiusMm: 15 }],
  ["cerchio d=120", { kind: "ellipse", halfW: 60, halfH: 60 }],
  ["ellisse 130x90", { kind: "ellipse", halfW: 65, halfH: 45 }],
  ["pentagono", { kind: "polygon", halfW: 60, halfH: 60, sides: 5 }],
  ["esagono", { kind: "polygon", halfW: 60, halfH: 60, sides: 6 }],
  ["ottagono", { kind: "polygon", halfW: 60, halfH: 60, sides: 8 }],
  ["rombo 130x90", { kind: "polygon", halfW: 65, halfH: 45, sides: 4 }],
];

for (const [nome, spec] of casi) {
  const r = larghezzaBordo(spec, D);
  console.log(`  ${nome.padEnd(20)} bordo ${r.min.toFixed(3)}–${r.max.toFixed(3)} mm  (scarto ${r.scarto.toFixed(4)})`);
  check(r.scarto < 0.05, `${nome}: bordo di larghezza costante`);
  check(Math.abs(r.min - D) < 0.05, `${nome}: bordo pari a quello richiesto`);
  // Senza questo, un contorno che si ALLARGA passerebbe i due controlli sopra:
  // la larghezza del bordo sarebbe costante e pari a D lo stesso.
  const eFuori = outlineExtent(r.fuori), eDentro = outlineExtent(r.dentro);
  check(eDentro.w < eFuori.w && eDentro.h < eFuori.h,
    `${nome}: il contorno rientra (${eFuori.w.toFixed(1)}x${eFuori.h.toFixed(1)} -> ${eDentro.w.toFixed(1)}x${eDentro.h.toFixed(1)})`);
}

console.log("");

// Il rettangolo e' l'unico caso di cui si conosce a mano il risultato esatto.
{
  const fuori = outlinePoints({ kind: "rect", halfW: 65, halfH: 45 }, 64);
  const dentro = insetOutline(fuori, D);
  const e = outlineExtent(dentro);
  console.log(`  rettangolo rientrato: ${e.w.toFixed(2)} x ${e.h.toFixed(2)} mm (atteso 120.00 x 80.00)`);
  check(Math.abs(e.w - 120) < 0.01 && Math.abs(e.h - 80) < 0.01, "rettangolo: ingombro esatto dopo il rientro");
}

// Allargare e poi rientrare della stessa quantita' deve riportare al punto di
// partenza: e' il controllo che smaschera un segno sbagliato.
{
  const fuori = outlinePoints({ kind: "ellipse", halfW: 65, halfH: 45 }, 256);
  const andata = insetOutline(fuori, -3);
  const ritorno = insetOutline(andata, 3);
  let max = 0;
  for (let i = 0; i < fuori.length; i++) {
    max = Math.max(max, Math.hypot(fuori[i]!.x - ritorno[i]!.x, fuori[i]!.z - ritorno[i]!.z));
  }
  console.log(`  ellisse allargata e rientrata: scarto massimo ${max.toFixed(4)} mm`);
  check(max < 0.05, "allargare e rientrare riporta al contorno di partenza");
}

console.log("");
// ROTAZIONE: appoggio sulla punta o sul lato. Ruotando di 180/lati il poligono
// passa da un vertice in basso a un lato in basso, e l'ingombro cambia.
{
  const punta = outlineExtent(outlinePoints({ kind: "polygon", halfW: 60, halfH: 60, sides: 6 }, 64));
  const lato = outlineExtent(outlinePoints({ kind: "polygon", halfW: 60, halfH: 60, sides: 6, rotationDeg: 30 }, 64));
  console.log(`  esagono sulla punta ${punta.w.toFixed(1)}x${punta.h.toFixed(1)} — sul lato ${lato.w.toFixed(1)}x${lato.h.toFixed(1)} mm`);
  check(Math.abs(punta.w - lato.h) < 0.5 && Math.abs(punta.h - lato.w) < 0.5, "ruotando di 180/lati l'ingombro si scambia");
}

// ANGOLI ACUTI: un rombo schiacciato non regge un bordino largo. Serve che il
// programma se ne accorga PRIMA di produrre un pezzo impossibile.
{
  const stretto = outlinePoints({ kind: "polygon", halfW: 70, halfH: 12, sides: 4 }, 64);
  const largo = outlinePoints({ kind: "polygon", halfW: 60, halfH: 60, sides: 6 }, 64);
  // Il limite vero e' il raggio inscritto: oltre quello il contorno si ripiega.
  // Per un rombo 140x24 vale (70*12)/hypot(70,12) = 11.8 mm, quindi 10 e' ancora
  // legittimo e 14 no. Il controllo deve distinguere proprio questi due casi.
  const rInscritto = (70 * 12) / Math.hypot(70, 12);
  console.log(`  rombo 140x24: raggio inscritto ${rInscritto.toFixed(1)} mm`);
  check(insetValido(largo, 5), "esagono ampio: rientro di 5 mm ammesso");
  check(insetValido(stretto, 10), `rombo schiacciato: rientro di 10 mm ammesso (sotto ${rInscritto.toFixed(1)})`);
  check(!insetValido(stretto, 14), `rombo schiacciato: rientro di 14 mm rifiutato (oltre ${rInscritto.toFixed(1)})`);
}

console.log("");
console.log(fail ? `❌ ${fail} controllo/i fallito/i.` : "✅ tutti i controlli superati");
process.exitCode = fail ? 1 : 0;
