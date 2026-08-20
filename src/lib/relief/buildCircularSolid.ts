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
  /** Diametro finale del pezzo in mm. */
  outDiameterMm: number;
  /** Ampiezza del rilievo in mm. */
  depthMm: number;
  /** Spessore della base sotto il rilievo in mm. */
  baseMm: number;
  /** Anelli radiali. Piu' anelli = piu' fedelta' radiale. */
  radialSteps?: number;
  /** Segmenti sulla circonferenza. Determina la finezza del bordo. */
  angularSteps?: number;
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

export function buildCircularSolidFromHeightmap(input: BuildCircularSolidInput): BuildCircularSolidOutput {
  const { height01, width: w, height: h } = input;
  const R = Math.max(0.5, input.outDiameterMm / 2);
  const depth = Math.max(0, input.depthMm);
  const base = Math.max(0.1, input.baseMm);

  const na = Math.max(24, Math.round(input.angularSteps ?? 256));
  const nr = Math.max(2, Math.round(input.radialSteps ?? 160));

  // Il cerchio e' inscritto nel quadrato centrato dell'immagine: cosi' un ritratto
  // resta centrato e non si deforma.
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const halfPx = Math.min(w - 1, h - 1) / 2;

  const zAt = (rNorm: number, ang: number): number => {
    const px = cx + rNorm * halfPx * Math.cos(ang);
    const py = cy + rNorm * halfPx * Math.sin(ang);
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
    const rMm = rNorm * R;
    for (let j = 0; j < na; j++) {
      const ang = (j / na) * Math.PI * 2;
      const x = rMm * Math.cos(ang);
      const y = rMm * Math.sin(ang);
      put(topIdx(i, j), x, y, zAt(rNorm, ang));
    }
  }
  for (let j = 0; j < na; j++) {
    const ang = (j / na) * Math.PI * 2;
    put(botRing + j, R * Math.cos(ang), R * Math.sin(ang), 0);
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
