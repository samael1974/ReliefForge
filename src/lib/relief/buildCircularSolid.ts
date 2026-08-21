// src/lib/relief/buildCircularSolid.ts
//
// Bassorilievo su dominio CIRCOLARE, costruito direttamente tondo.
//
// Perche' non una maschera sulla griglia cartesiana: ritagliare un cerchio da una
// griglia a quadretti obbliga a ricostruire il bordo con una marching-squares e a
// gestire i triangoli degeneri dove due vertici esterni collassano quasi nello
// stesso punto sul cerchio. Parametrizzando invece in coordinate polari il bordo
// e' un cerchio ESATTO per costruzione, la mesh e' chiusa senza saldature e non
// esistono triangoli degeneri da ripulire.
//
// Struttura: disco superiore (ventaglio al centro + anelli di quad), parete
// laterale sul raggio esterno, disco di fondo piatto. Watertight per costruzione.

export type BuildCircularSolidInput = {
  /** Altezze normalizzate [0..1], lunghezza = width*height. */
  height01: Float32Array;
  width: number;
  height: number;
  /** Diametro finale del pezzo in mm (dominio circolare). */
  outDiameterMm: number;
  /** Dominio RETTANGOLARE ad angoli arrotondati: larghezza e altezza in mm.
   *  Se valorizzati sostituiscono il cerchio e il campionamento copre tutta
   *  l'immagine invece del solo quadrato centrale. */
  outWidthMm?: number;
  outHeightMm?: number;
  /** Raggio degli angoli del dominio rettangolare. */
  cornerRadiusMm?: number;
  /** Contorno esplicito (ellisse, poligono, rombo): vince su tutto il resto. */
  outlinePts?: Array<{ x: number; z: number }>;
  /** Ampiezza del rilievo in mm. */
  depthMm: number;
  /** Spessore della base sotto il rilievo in mm. */
  baseMm: number;
  /** Anelli radiali. Se assente si ricava dalla risoluzione del sorgente. */
  radialSteps?: number;
  /** Segmenti sulla circonferenza. Se assente si ricava dal sorgente. */
  angularSteps?: number;
  /** Tetto al numero di celle (anelli x segmenti). L'anteprima ne usa meno dell'export. */
  maxCells?: number;
  /** Inverte le altezze. */
  invert?: boolean;
};

export type BuildCircularSolidOutput = {
  vertices: Float32Array;
  indices: Uint32Array;
  triangles: number;
};

/** Campionamento bilineare di una griglia w x h in coordinate pixel continue. */
function sampleBilinear(a: Float32Array, w: number, h: number, px: number, py: number): number {
  const x = px < 0 ? 0 : px > w - 1 ? w - 1 : px;
  const y = py < 0 ? 0 : py > h - 1 ? h - 1 : py;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
  const y1 = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const fx = x - x0, fy = y - y0;
  const v00 = a[y0 * w + x0]!, v10 = a[y0 * w + x1]!;
  const v01 = a[y1 * w + x0]!, v11 = a[y1 * w + x1]!;
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

import { raggioNellaDirezione } from "./frame/outline";

export function buildCircularSolidFromHeightmap(input: BuildCircularSolidInput): BuildCircularSolidOutput {
  const { height01, width: w, height: h } = input;
  const R = Math.max(0.5, input.outDiameterMm / 2);
  const depth = Math.max(0, input.depthMm);
  const base = Math.max(0.1, input.baseMm);

  // Densita' di campionamento legata al SORGENTE, non a numeri fissi. Con passi
  // costanti il bordo del disco veniva campionato fino a 9 volte piu' grosso del
  // pixel dell'immagine, e il rilievo usciva impastato.
  const pxMm = (input.outWidthMm ?? R * 2) / Math.max(2, Math.min(w, h));
  let na = Math.max(24, Math.round(input.angularSteps ?? Math.ceil((2 * Math.PI * R) / pxMm)));
  let nr = Math.max(2, Math.round(input.radialSteps ?? Math.ceil(R / pxMm)));
  const budget = Math.max(10_000, input.maxCells ?? 1_400_000);
  if (na * nr > budget) {
    const k = Math.sqrt(budget / (na * nr));
    na = Math.max(64, Math.round(na * k));
    nr = Math.max(32, Math.round(nr * k));
  }

  // Dominio: cerchio, oppure rettangolo ad angoli arrotondati. Il secondo serve a
  // far combaciare il rilievo con una cornice arrotondata: senza, gli spigoli
  // quadrati del bassorilievo sbordano oltre il raggio della cornice.
  const rectMode = !!(input.outWidthMm && input.outHeightMm);
  const halfW = rectMode ? input.outWidthMm! / 2 : R;
  const halfH = rectMode ? input.outHeightMm! / 2 : R;
  const rCorner = rectMode
    ? Math.max(0, Math.min(input.cornerRadiusMm ?? 0, halfW - 0.01, halfH - 0.01))
    : R;

  /** Punto del contorno per l'angolo dato, su un rettangolo ad angoli arrotondati.
   *  Con rCorner = meta' lato torna esattamente il cerchio. */
  const outline = (ang: number): { x: number; y: number } => {
    // Contorno esplicito: e' lo stesso che usa la cornice, quindi il rilievo
    // combacia con l'apertura invece di sbordare con gli spigoli.
    if (input.outlinePts && input.outlinePts.length >= 3) {
      const r = raggioNellaDirezione(input.outlinePts, ang);
      return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
    }
    if (!rectMode) return { x: R * Math.cos(ang), y: R * Math.sin(ang) };
    // Raggio del contorno nella direzione ang: si interseca la semiretta con il
    // rettangolo smussato campionando la forma in coordinate normalizzate.
    const cxr = halfW - rCorner, cyr = halfH - rCorner;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    // Bisezione: robusta e sufficiente, il contorno e' convesso.
    const dentro = (t: number) => {
      const x = Math.abs(dx * t), y = Math.abs(dy * t);
      if (x <= cxr && y <= cyr) return true;
      if (x > halfW || y > halfH) return false;
      const ox = Math.max(0, x - cxr), oy = Math.max(0, y - cyr);
      return ox * ox + oy * oy <= rCorner * rCorner + 1e-9;
    };
    let lo = 0, hi = Math.hypot(halfW, halfH);
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (dentro(mid)) lo = mid; else hi = mid; }
    return { x: dx * lo, y: dy * lo };
  };

  // Campionamento: nel cerchio si usa il quadrato centrato dell'immagine (nessuna
  // deformazione); nel rettangolo si copre tutta l'immagine, che ha la stessa forma.
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const halfPx = Math.min(w - 1, h - 1) / 2;

  const zAt = (rNorm: number, ang: number): number => {
    let px: number, py: number;
    // Le righe dell'immagine crescono verso il BASSO, la Y del pezzo verso l'ALTO:
    // senza il segno meno il bassorilievo esce capovolto rispetto alla depth map.
    // Il mesher rettangolare usa gia' questa convenzione.
    if (rectMode) {
      const o = outline(ang);
      px = cx + (o.x * rNorm / halfW) * ((w - 1) / 2);
      py = cy - (o.y * rNorm / halfH) * ((h - 1) / 2);
    } else {
      px = cx + rNorm * halfPx * Math.cos(ang);
      py = cy - rNorm * halfPx * Math.sin(ang);
    }
    let v = sampleBilinear(height01, w, h, px, py);
    if (input.invert) v = 1 - v;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    return base + v * depth;
  };

  // Vertici: centro top, nr anelli x na, centro bottom, nr anello esterno bottom.
  // Layout: [0] = centro top; [1 .. nr*na] = anelli top; poi anello bottom (na);
  //         infine centro bottom.
  const vCount = 1 + nr * na + na + 1;
  const V = new Float32Array(vCount * 3);
  const put = (i: number, x: number, y: number, z: number) => {
    V[i * 3] = x; V[i * 3 + 1] = y; V[i * 3 + 2] = z;
  };

  // Il centro del disco superiore: media degli angoli sul raggio piu' interno,
  // altrimenti un solo campione rumoroso diventerebbe una punta.
  let zc = 0;
  for (let j = 0; j < na; j++) zc += zAt(0, (j / na) * Math.PI * 2);
  put(0, 0, 0, zc / na);

  const topIdx = (i: number, j: number) => 1 + (i - 1) * na + (j % na); // i = 1..nr
  const botRing = 1 + nr * na;
  const botCenter = botRing + na;

  for (let i = 1; i <= nr; i++) {
    const rNorm = i / nr;
    for (let j = 0; j < na; j++) {
      const ang = (j / na) * Math.PI * 2;
      const o = outline(ang);
      put(topIdx(i, j), o.x * rNorm, o.y * rNorm, zAt(rNorm, ang));
    }
  }
  for (let j = 0; j < na; j++) {
    const o = outline((j / na) * Math.PI * 2);
    put(botRing + j, o.x, o.y, 0);
  }
  put(botCenter, 0, 0, 0);

  const I: number[] = [];
  const tri = (a: number, b: number, c: number) => { I.push(a, b, c); };

  // Disco superiore: ventaglio centrale + anelli di quad. Normali verso +Z.
  for (let j = 0; j < na; j++) tri(0, topIdx(1, j), topIdx(1, j + 1));
  for (let i = 1; i < nr; i++) {
    for (let j = 0; j < na; j++) {
      const a = topIdx(i, j), b = topIdx(i, j + 1);
      const c = topIdx(i + 1, j), d = topIdx(i + 1, j + 1);
      tri(a, c, d); tri(a, d, b);
    }
  }

  // Parete laterale sul raggio esterno, normali radiali verso fuori.
  for (let j = 0; j < na; j++) {
    const t0 = topIdx(nr, j), t1 = topIdx(nr, j + 1);
    const b0 = botRing + (j % na), b1 = botRing + ((j + 1) % na);
    tri(t0, b0, b1); tri(t0, b1, t1);
  }

  // Fondo piatto, normali verso -Z (avvolgimento invertito rispetto al top).
  for (let j = 0; j < na; j++) {
    const b0 = botRing + (j % na), b1 = botRing + ((j + 1) % na);
    tri(botCenter, b1, b0);
  }

  return { vertices: V, indices: new Uint32Array(I), triangles: I.length / 3 };
}
