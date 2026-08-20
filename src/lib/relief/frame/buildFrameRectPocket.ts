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
  /** Spessore lungo Y del labbro che trattiene il vetro (materiale davanti al vetro). */
  glassSeatDepthMm?: number;
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
  const hasSeat = hasPocket && seat > 0.01 && seatD > 0.01 && seatD < pocketDepth - 0.05;
  const wSeat = Math.max(0.5, wBack - 2 * seat);
  const hSeat = Math.max(0.5, hBack - 2 * seat);
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
  const rSeat = Math.max(0, R - thickness - seat);

  // Perimetri (tutti con lo stesso segPerCorner → index-allineati)
  const perOuter = roundedRectPerimeter(outerW / 2, outerH / 2, rOuter, segPerCorner);
  const perBack = roundedRectPerimeter(wBack / 2, hBack / 2, rBack, segPerCorner);
  const perFront = hasPocket
    ? roundedRectPerimeter(wFront / 2, hFront / 2, rFront, segPerCorner)
    : perBack;
  const perSeat = hasSeat
    ? roundedRectPerimeter(wSeat / 2, hSeat / 2, rSeat, segPerCorner)
    : perBack;
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

  if (hasSeat) {
    // Scaletta a due gradini: labbro vetro -> sede vetro -> vassoio -> battuta rilievo.
    addRing(perOuter, perSeat, y0, false);         // faccia fronte, ristretta dal labbro vetro
    addWall(perSeat, y0, seatD, false);            // spessore del labbro vetro
    addRing(perBack, perSeat, seatD, true);        // gradino: qui batte il VETRO
    addWall(perBack, seatD, yLip, false);          // parete del vassoio
    addRing(perBack, perFront, yLip, false);       // battuta: qui appoggia il RILIEVO
    addWall(perFront, yLip, yH, false);            // apertura visibile piccola
    addWall(perOuter, y0, yH, true);               // muro esterno
    addRing(perOuter, perFront, yH, true);         // faccia posteriore
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
