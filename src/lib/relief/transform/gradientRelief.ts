// src/lib/relief/transform/gradientRelief.ts
//
// Compressione nel DOMINIO DEI GRADIENTI per bassorilievo (V8.5).
//
// IL PROBLEMA CHE RISOLVE
// In una depth map il dislivello fra soggetto e sfondo domina l'intero intervallo:
// una testa "sporge" di decine di centimetri, mentre naso, labbra e palpebre sono
// variazioni di pochi millimetri appoggiate sopra quel dislivello. Schiacciando
// tutto in 3 mm di rilievo, il dettaglio di superficie diventa qualche micron:
// sparisce sotto l'altezza di layer della stampante.
//
// Gamma, contrasto e clip percentile NON possono rimediare: sono rimappature
// PUNTUALI, cioe' funzioni h -> f(h). Una funzione del genere non sa distinguere
// "questo salto e' la silhouette" da "questa variazione e' una narice", perche'
// vede solo il valore, non quanto cambia rispetto ai vicini. Qualunque curva che
// schiacci il salto grande schiaccia anche il dettaglio che ci sta sopra.
//
// LA SOLUZIONE
// Si lavora sulle DERIVATE invece che sui valori:
//   1. si calcolano i gradienti del campo di altezze;
//   2. si attenuano i gradienti GRANDI (silhouette) lasciando intatti i PICCOLI
//      (dettaglio di superficie) — una compressione logaritmica fa esattamente questo;
//   3. si ricostruisce il campo risolvendo lap(h) = div(g') (Poisson, Neumann).
//
// E' l'approccio dei bassorilievi digitali di riferimento (Weyrich et al., SIGGRAPH
// 2007) ed e' cio' che distingue un generatore serio da un "depth map estruso".
//
// Il parametro `compression` a 0 restituisce il campo originale a meno di una
// costante: e' la verifica di correttezza piu' utile del modulo.

import { solvePoissonNeumann } from "./poisson";

export type GradientReliefOptions = {
  /** Forza della compressione. 0 = nessuna (identita'). Tipico 2..12. */
  compression: number;
  /**
   * Guadagno sul dettaglio fine, applicato ai gradienti sotto la soglia di
   * riferimento. 0 = nessuno. Tipico 0..1.5.
   */
  detailGain?: number;
  /**
   * Percentile della magnitudine di gradiente usato come riferimento (0..1).
   * Default 0.9: i gradienti oltre il 90esimo percentile sono "silhouette".
   */
  referencePercentile?: number;
  /** Cicli del risolutore multigrid. Default 5. */
  cycles?: number;
};

function percentile(values: Float32Array, p: number): number {
  // Istogramma: O(n), evita di ordinare 700k valori a ogni anteprima.
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!;
  if (max <= 0) return 0;
  const BINS = 1024;
  const hist = new Int32Array(BINS);
  for (let i = 0; i < values.length; i++) {
    const b = Math.min(BINS - 1, (values[i]! / max * (BINS - 1)) | 0);
    hist[b]!++;
  }
  const target = p * values.length;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b]!;
    if (acc >= target) return (b / (BINS - 1)) * max;
  }
  return max;
}

/**
 * Ritorna un nuovo campo in [0..1] con la stessa forma generale ma il dettaglio
 * di superficie molto piu' leggibile una volta scalato allo spessore del rilievo.
 */
export function gradientDomainRelief(
  src: Float32Array,
  w: number,
  h: number,
  opts: GradientReliefOptions
): Float32Array {
  const alpha = Math.max(0, opts.compression);
  const detailGain = Math.max(0, opts.detailGain ?? 0);
  const pRef = Math.min(0.999, Math.max(0.5, opts.referencePercentile ?? 0.9));

  if (alpha <= 1e-6 && detailGain <= 1e-6) return normalize01(new Float32Array(src));

  const n = w * h;
  // Gradienti in avanti; ai bordi destro/inferiore valgono 0 (Neumann coerente).
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gx[i] = x < w - 1 ? src[i + 1]! - src[i]! : 0;
      gy[i] = y < h - 1 ? src[i + w]! - src[i]! : 0;
    }
  }

  // Magnitudine e riferimento
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) mag[i] = Math.hypot(gx[i]!, gy[i]!);
  const mRef = Math.max(1e-8, percentile(mag, pRef));

  // Attenuazione: s(m) -> 1 quando m -> 0 (dettaglio intatto),
  // ~log(m)/m per m grande (silhouette compressa).
  for (let i = 0; i < n; i++) {
    const m = mag[i]!;
    let s: number;
    if (alpha <= 1e-6) {
      s = 1;
    } else {
      const t = alpha * (m / mRef);
      s = t < 1e-6 ? 1 : Math.log1p(t) / t;
    }
    if (detailGain > 0) {
      // Il boost agisce solo sotto il riferimento e svanisce sulle silhouette,
      // altrimenti si riaprirebbe il salto che stiamo comprimendo.
      const q = Math.min(1, m / mRef);
      s *= 1 + detailGain * (1 - q) * (1 - q);
    }
    gx[i] = gx[i]! * s;
    gy[i] = gy[i]! * s;
  }

  // Divergenza all'indietro, coerente con i gradienti in avanti.
  const div = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = gx[i]! - (x > 0 ? gx[i - 1]! : 0);
      const dy = gy[i]! - (y > 0 ? gy[i - w]! : 0);
      div[i] = dx + dy;
    }
  }

  const out = solvePoissonNeumann(div, w, h, { cycles: opts.cycles ?? 5 });
  return normalize01(out);
}

function normalize01(a: Float32Array): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1e-9, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! - lo) / span;
  return a;
}
