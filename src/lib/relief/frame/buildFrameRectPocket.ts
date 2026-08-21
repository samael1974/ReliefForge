// src/lib/relief/frame/buildFrameRectPocket.ts
//
// Cornice rettangolare con VASSOIO frontale, BATTUTA vetro e ANGOLI ARROTONDATI opzionali.
//
// - L'apertura visibile è più stretta del vassoio frontale: la differenza
//   radiale = battuta (lip) = gradino strutturale su cui appoggia il vetro.
// - cornerRadiusMm > 0 arrotonda gli spigoli verticali (perimetri rounded-rect
//   concentrici: esterno = R, apertura retro = R-thickness, apertura fronte =
//   R-thickness-lip → bordo di larghezza costante attorno alle curve).
//
// Coordinate locali: piano XZ, estrusione lungo Y → la stessa rotazione X=-π/2
// usata in anteprima/export continua a funzionare.
//   y=0                       → faccia frontale (apertura VASSOIO grande)
//   y=pocketDepthMm           → gradino battuta
//   y=heightMm                → faccia posteriore (apertura visibile piccola)
//
// Quando pocketDepthMm o lipMm ≤ 0 → scatola cava simmetrica (fallback safe).
// Quando cornerRadiusMm ≤ 0 → spigoli vivi (perimetri a 4 punti).

import { segmentsForRadius } from "./manifoldPrimitives";
import { outlinePoints, insetOutline, type OutlineSpec } from "./outline";

export type FrameRectPocketParams = {
  /** Apertura del VASSOIO frontale in X — contiene il vetro */
  innerWmm: number;
  /** Apertura del VASSOIO frontale in Z */
  innerHmm: number;
  /** Spessore laterale cornice */
  thicknessMm: number;
  /** Estrusione totale lungo Y (= profondità Z dopo la rotazione) */
  heightMm: number;
  /** Profondità del vassoio dal fronte (0..heightMm). 0 = niente vassoio */
  pocketDepthMm: number;
  /** Battuta (gradino radiale per lato) tra apertura fronte e retro. 0 = niente battuta */
  lipMm: number;
  /** Battuta VETRO frontale: larghezza radiale del labbro che trattiene il vetro.
   *  0 = niente sede vetro (comportamento storico: un gradino solo). */
  glassSeatMm?: number;
  /** Profondita' della sede vetro dal fronte (di norma spessore vetro + gioco). */
  glassSeatDepthMm?: number;
  /** Spessore del bordino su cui appoggia il rilievo. */
  lipThickMm?: number;
  /** Da che lato si infila il bassorilievo: il bordino va dal lato opposto. */
  reliefLoadFrom?: "front" | "back";
  /** Forma della cornice. Assente = rettangolo con gli angoli di cornerRadiusMm. */
  outline?: OutlineSpec;
  /** Raggio di arrotondamento spigoli verticali esterni (mm). 0 = spigoli vivi */
  cornerRadiusMm?: number;
  /** Segmenti per ciascun angolo a 90° (qualità della curva). Default 6 */
  cornerSegments?: number;
};

export type MeshOut = {
  vertices: Float32Array;
  indices: Uint32Array;
};

type Pt2 = { x: number; z: number };

/**
 * La battuta è un elemento funzionale della cornice e deve esistere anche senza
 * passepartout. Il valore viene quindi limitato soltanto a numeri non negativi.
 */
export function effectiveFrameLipMm(lipMm: number): number {
  return Math.max(0, lipMm);
}

/**
 * Perimetro CCW di un rettangolo (eventualmente arrotondato) centrato sull'origine,
 * nel piano XZ. Ritorna SEMPRE 4*(segPerCorner+1) punti, così perimetri con segPerCorner
 * uguale sono index-allineati (i ring tra due perimetri concentrici si triangolano a strisce).
 * Con r=0 i punti di ogni angolo collassano sullo spigolo vivo.
 */
function roundedRectPerimeter(hw: number, hh: number, r: number, segPerCorner: number): Pt2[] {
  const rr = Math.max(0, Math.min(r, hw, hh));
  const seg = Math.max(0, Math.floor(segPerCorner));
  // Centri dei 4 archi, in ordine CCW: TR → TL → BL → BR
  const corners: Array<{ cx: number; cz: number; a0: number }> = [
    { cx: +hw - rr, cz: +hh - rr, a0: 0 },             // TR: 0°→90°
    { cx: -hw + rr, cz: +hh - rr, a0: Math.PI / 2 },   // TL: 90°→180°
    { cx: -hw + rr, cz: -hh + rr, a0: Math.PI },       // BL: 180°→270°
    { cx: +hw - rr, cz: -hh + rr, a0: (3 * Math.PI) / 2 }, // BR: 270°→360°
  ];
  const out: Pt2[] = [];
  for (const c of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = seg === 0 ? 0 : i / seg;
      const a = c.a0 + t * (Math.PI / 2);
      out.push({ x: c.cx + rr * Math.cos(a), z: c.cz + rr * Math.sin(a) });
    }
  }
  return out;
}

export function buildFrameRectPocket(p: FrameRectPocketParams): MeshOut {
  const wBack = Math.max(1, p.innerWmm);
  const hBack = Math.max(1, p.innerHmm);
  const thickness = Math.max(0.5, p.thicknessMm);
  const height = Math.max(1, p.heightMm);
  const lip = Math.max(0, p.lipMm);
  const pocketDepth = Math.max(0, Math.min(p.pocketDepthMm, Math.max(0, height - 0.1)));
  const R = Math.max(0, p.cornerRadiusMm ?? 0);

  const wFront = Math.max(0.5, wBack - 2 * lip);
  const hFront = Math.max(0.5, hBack - 2 * lip);
  const outerW = wBack + 2 * thickness;
  const outerH = hBack + 2 * thickness;

  const hasPocket = pocketDepth > 0 && lip > 0;

  // Sede vetro: secondo gradino, davanti al vassoio. Il labbro trattiene il vetro
  // che altrimenti andrebbe solo incollato sul fronte del rilievo.
  const seat = Math.max(0, p.glassSeatMm ?? 0);
  const seatD = Math.max(0, p.glassSeatDepthMm ?? 0);
  const lipT = Math.max(0.4, p.lipThickMm ?? 1.6);
  // Bordino d'appoggio e sede vetro sono indipendenti: vedi reliefStl.
  const hasLedge = lip > 0.01 && lipT < height - 0.2;
  const hasGlassSeat = hasLedge && seat > 0.01 && seatD > 0.01 && seatD + lipT < height - 0.2;
  const seatDepth = hasGlassSeat ? seatD : 0;
  // Sede vetro: scasso frontale PIU' LARGO della cavita', cosi' il vetro batte
  // su uno spallamento sul fronte invece di cadere dentro.
  const wSeat = Math.min(wBack + 2 * thickness - 0.4, wBack + 2 * seat);
  const hSeat = Math.min(hBack + 2 * thickness - 0.4, hBack + 2 * seat);
  // V8.4: default 16 segmenti per angolo (era 6): curve lisce anche in anteprima.
  // Il numero di segmenti segue il RAGGIO, non l'angolo: su una cornice tonda il
  // valore fisso storico (16 per angolo = 68 facce) dava corde da oltre 6 mm.
  // Tutti i perimetri devono condividere lo stesso valore: sono index-allineati.
  const rOuterEff = Math.min(R, outerW / 2, outerH / 2);
  const segPerCorner = R > 0.01
    ? Math.max(1, p.cornerSegments ?? 16, Math.ceil(segmentsForRadius(rOuterEff, 64) / 4))
    : 0;

  const y0 = 0;
  const yH = height;
  const yLip = hasPocket ? pocketDepth : 0;

  // Raggi concentrici: bordo di larghezza costante attorno agli angoli.
  const rOuter = R;
  const rBack = Math.max(0, R - thickness);
  const rFront = Math.max(0, R - thickness - lip);
  const rSeat = Math.max(0, R - thickness + seat);

  // Perimetri concentrici. La CAVITA' e' l'ancora — deve contenere il rilievo —
  // e tutti gli altri si ricavano rientrando o allargando di una distanza costante.
  // Vale per qualunque forma: rettangolo, arrotondato, ellisse, poligono.
  const spec: OutlineSpec = p.outline
    ? { ...p.outline, halfW: wBack / 2, halfH: hBack / 2 }
    : { kind: "rect", halfW: wBack / 2, halfH: hBack / 2, cornerRadiusMm: rBack };
  const segTot = Math.max(8, segPerCorner * 4);
  const perBack = outlinePoints(spec, segTot);
  const perOuter = insetOutline(perBack, -thickness);
  const perFront = hasPocket ? insetOutline(perBack, lip) : perBack;
  const perSeat = hasGlassSeat ? insetOutline(perBack, -seat) : perBack;
  const N = perOuter.length;

  const V: number[] = [];
  const I: number[] = [];
  const addV = (x: number, y: number, z: number) => { V.push(x, y, z); return V.length / 3 - 1; };
  const tri = (a: number, b: number, c: number) => { I.push(a, b, c); };

  /** Ring orizzontale tra due perimetri allineati (outer più grande, inner più piccolo) a quota y.
   *  normalUp=true → normale verso +Y, false → verso -Y. */
  const addRing = (outer: Pt2[], inner: Pt2[], y: number, normalUp: boolean) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const o0 = addV(outer[i]!.x, y, outer[i]!.z);
      const o1 = addV(outer[j]!.x, y, outer[j]!.z);
      const i0 = addV(inner[i]!.x, y, inner[i]!.z);
      const i1 = addV(inner[j]!.x, y, inner[j]!.z);
      if (normalUp) {
        tri(o0, i0, o1); tri(o1, i0, i1);
      } else {
        tri(o0, o1, i0); tri(o1, i1, i0);
      }
    }
  };

  /** Muro verticale lungo un perimetro, tra yBot e yTop.
   *  outward=true → normale radiale verso fuori; false → verso il centro (apertura). */
  const addWall = (per: Pt2[], yBot: number, yTop: number, outward: boolean) => {
    if (Math.abs(yTop - yBot) < 1e-6) return;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a0 = addV(per[i]!.x, yBot, per[i]!.z);
      const a1 = addV(per[j]!.x, yBot, per[j]!.z);
      const b1 = addV(per[j]!.x, yTop, per[j]!.z);
      const b0 = addV(per[i]!.x, yTop, per[i]!.z);
      if (outward) {
        tri(a0, a1, b1); tri(a0, b1, b0);
      } else {
        tri(a0, b1, a1); tri(a0, b0, b1);
      }
    }
  };

  if (hasLedge) {
    // MONTAGGIO REALE (V8.13): vetro dal FRONTE nella sede a L, rilievo dal RETRO.
    // Il bordino che sporge verso l'interno regge entrambi, da lati opposti.
    // La cavita' del rilievo resta APERTA sul retro: chiusa da tutti e due i lati,
    // un rilievo stampato a parte non potrebbe piu' entrare.
    // Bordino POSITIVO dal lato opposto a quello di inserimento del rilievo.
    const dalRetro = p.reliefLoadFrom === "back";
    if (hasGlassSeat) {
      addRing(perOuter, perSeat, y0, false);                       // faccia fronte
      addWall(perSeat, y0, seatDepth, false);                      // parete sede vetro
      addRing(perSeat, dalRetro ? perFront : perBack, seatDepth, false); // spallamento del VETRO
    } else {
      addRing(perOuter, dalRetro ? perFront : perBack, y0, false); // faccia fronte
    }

    if (dalRetro) {
      // Rilievo dal RETRO: bordino davanti, cavita' aperta dietro.
      const yLedgeEnd = seatDepth + lipT;
      addWall(perFront, seatDepth, yLedgeEnd, false);  // apertura del bordino
      addRing(perBack, perFront, yLedgeEnd, true);     // faccia del bordino: qui appoggia il RILIEVO
      addWall(perBack, yLedgeEnd, yH, false);          // cavita', aperta sul retro
      addRing(perOuter, perBack, yH, true);            // faccia posteriore
    } else {
      // Rilievo dal FRONTE: cavita' passante, bordino in fondo.
      const yLedge = yH - lipT;
      addWall(perBack, seatDepth, yLedge, false);      // cavita' del rilievo
      addRing(perBack, perFront, yLedge, false);       // faccia del bordino: qui appoggia il RILIEVO
      addWall(perFront, yLedge, yH, false);            // apertura del bordino
      addRing(perOuter, perFront, yH, true);           // faccia posteriore (anello del bordino)
    }
    addWall(perOuter, y0, yH, true);                   // muro esterno
  } else if (hasPocket) {
    addRing(perOuter, perBack, y0, false);         // faccia fronte (apertura vassoio grande)
    addWall(perBack, y0, yLip, false);             // parete del vassoio
    addRing(perBack, perFront, yLip, false);       // battuta rivolta verso il fronte/vetro
    addWall(perFront, yLip, yH, false);            // apertura visibile piccola
    addWall(perOuter, y0, yH, true);               // muro esterno
    addRing(perOuter, perFront, yH, true);         // faccia posteriore
  } else {
    addRing(perOuter, perBack, y0, false);         // faccia fronte
    addWall(perBack, y0, yH, false);               // muro apertura
    addWall(perOuter, y0, yH, true);               // muro esterno
    addRing(perOuter, perBack, yH, true);          // faccia retro
  }

  return { vertices: new Float32Array(V), indices: new Uint32Array(I) };
}
