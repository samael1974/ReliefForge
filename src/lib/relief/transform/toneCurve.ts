// src/lib/relief/transform/toneCurve.ts
//
// Curva tonale MONOTONA per la depth map (V8.8).
//
// Sostituisce i livelli a due punti: i livelli sono il caso particolare di una
// curva con i soli estremi, quindi la curva non toglie niente e aggiunge il
// controllo che serviva davvero. Su un istogramma bimodale (sfondo + soggetto) la
// curva permette di schiacciare la gobba dello sfondo e allargare quella del
// soggetto nella STESSA operazione: con i livelli si poteva solo tagliare agli estremi.
//
// PERCHE' L'INTERPOLAZIONE E' QUELLA DI FRITSCH-CARLSON E NON UNA SPLINE QUALSIASI
// Una spline cubica normale (Catmull-Rom, natural spline) puo' SBORDARE fra due punti
// di controllo: trascinando un punto si generano massimi o minimi che l'utente non ha
// chiesto. Su un'immagine e' un artefatto estetico; su un campo di ALTEZZE FISICHE
// significa un avvallamento o una gobba veri nel pezzo stampato, e nei casi peggiori
// un'inversione locale del rilievo (sottosquadro).
//
// L'interpolazione cubica di Hermite con le tangenti limitate secondo Fritsch-Carlson
// (1980) garantisce invece che la curva sia monotona ovunque se lo sono i punti di
// controllo. Combinata con il vincolo di monotonia sui punti stessi, rende
// impossibile per costruzione produrre un rilievo ripiegato.

export type CurvePoint = { x: number; y: number };

/** Curva identita': gli estremi e nient'altro. Equivale ai livelli 0..1. */
export const IDENTITY_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

/** Ordina per x ed elimina punti troppo vicini o non crescenti in y. */
export function sanitizeCurve(points: CurvePoint[]): CurvePoint[] {
  const MIN_DX = 0.005;
  const p = [...points]
    .map((q) => ({ x: clamp01(q.x), y: clamp01(q.y) }))
    .sort((a, b) => a.x - b.x);

  const out: CurvePoint[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (last && q.x - last.x < MIN_DX) continue;      // troppo vicini: il secondo si scarta
    if (last && q.y < last.y) { out.push({ x: q.x, y: last.y }); continue; } // monotonia
    out.push(q);
  }
  if (out.length < 2) return [...IDENTITY_CURVE];
  return out;
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * Costruisce una LUT di `size` campioni valutando la curva monotona.
 * Fuori dagli estremi la curva e' costante: e' cio' che realizza il taglio dei
 * livelli (tutto sotto il primo punto va a fondo, tutto sopra l'ultimo va a cima).
 */
export function buildCurveLut(points: CurvePoint[], size = 1024): Float32Array {
  const p = sanitizeCurve(points);
  const n = p.length;
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);

  // Pendenze dei segmenti
  const dx: number[] = [], dy: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1]! - xs[i]!);
    dy.push(ys[i + 1]! - ys[i]!);
    slope.push(dy[i]! / Math.max(1e-9, dx[i]!));
  }

  // Tangenti iniziali (differenze centrate), poi limitate.
  const m: number[] = new Array(n);
  m[0] = slope[0] ?? 0;
  m[n - 1] = slope[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]!, s1 = slope[i]!;
    m[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
  }

  // Limitazione di Fritsch-Carlson: e' questo passaggio a garantire la monotonia.
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!;
    if (s === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / s, b = m[i + 1]! / s;
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * s;
      m[i + 1] = t * b * s;
    }
  }

  const lut = new Float32Array(size);
  let seg = 0;
  for (let k = 0; k < size; k++) {
    const x = k / (size - 1);
    if (x <= xs[0]!) { lut[k] = ys[0]!; continue; }
    if (x >= xs[n - 1]!) { lut[k] = ys[n - 1]!; continue; }
    while (seg < n - 2 && x > xs[seg + 1]!) seg++;
    const h = dx[seg]!;
    const t = (x - xs[seg]!) / h;
    const t2 = t * t, t3 = t2 * t;
    // Base di Hermite
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    lut[k] = clamp01(h00 * ys[seg]! + h10 * h * m[seg]! + h01 * ys[seg + 1]! + h11 * h * m[seg + 1]!);
  }
  return lut;
}

/** Valuta la curva in un punto (per il disegno del widget). */
export function evalCurve(lut: Float32Array, x: number): number {
  const k = clamp01(x) * (lut.length - 1);
  const i = Math.floor(k);
  const f = k - i;
  const a = lut[i]!;
  const b = lut[Math.min(lut.length - 1, i + 1)]!;
  return a + (b - a) * f;
}

/** Applica la LUT a un campo in [0..1]. Ritorna un nuovo array. */
export function applyCurve(src: Float32Array, lut: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  const last = lut.length - 1;
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    const k = v <= 0 ? 0 : v >= 1 ? last : v * last;
    const i0 = k | 0;
    const f = k - i0;
    const a = lut[i0]!;
    const b = lut[i0 < last ? i0 + 1 : last]!;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** La curva equivalente a livelli nero/bianco: usata da "Auto" e dal ripristino. */
export function levelsCurve(black: number, white: number): CurvePoint[] {
  const b = clamp01(Math.min(black, white - 0.005));
  const w = clamp01(Math.max(white, b + 0.005));
  return sanitizeCurve([{ x: b, y: 0 }, { x: w, y: 1 }]);
}
