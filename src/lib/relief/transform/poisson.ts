// src/lib/relief/transform/poisson.ts
//
// Risolutore di Poisson con condizioni al contorno di Neumann, via MULTIGRID.
//
// Serve alla compressione nel dominio dei gradienti (vedi gradientRelief.ts):
// dopo aver modificato i gradienti di un campo di altezze, il campo va
// RICOSTRUITO, e ricostruire significa risolvere  lap(h) = b.
//
// Discretizzazione a 5 punti. Il contorno usa il mirroring (dh/dn = 0): il
// vicino fuori griglia vale quanto il centro, quindi il suo termine si annulla
// e il coefficiente diagonale diventa il NUMERO DI VICINI REALI. Questo evita
// di gonfiare artificialmente i bordi, che nel bassorilievo si vedrebbe come
// un rialzo lungo tutta la cornice.
//
// Con Neumann puro la soluzione e' definita a meno di una costante e il sistema
// e' risolvibile solo se la somma dei termini noti e' nulla: si sottrae la media
// di b (e della soluzione a ogni ciclo). La costante non ci interessa perche' il
// risultato viene comunque normalizzato in [0..1].

/** Sweep di Gauss-Seidel red-black: converge come GS ma e' parallelizzabile e stabile. */
function smooth(h: Float32Array, b: Float32Array, w: number, hgt: number, sweeps: number) {
  for (let s = 0; s < sweeps; s++) {
    for (let color = 0; color < 2; color++) {
      for (let y = 0; y < hgt; y++) {
        for (let x = (y + color) & 1; x < w; x += 2) {
          const i = y * w + x;
          let sum = 0;
          let n = 0;
          if (x > 0) { sum += h[i - 1]!; n++; }
          if (x < w - 1) { sum += h[i + 1]!; n++; }
          if (y > 0) { sum += h[i - w]!; n++; }
          if (y < hgt - 1) { sum += h[i + w]!; n++; }
          if (n > 0) h[i] = (sum - b[i]!) / n;
        }
      }
    }
  }
}

/** r = b - lap(h) */
function residual(h: Float32Array, b: Float32Array, w: number, hgt: number, out: Float32Array) {
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let sum = 0;
      let n = 0;
      if (x > 0) { sum += h[i - 1]!; n++; }
      if (x < w - 1) { sum += h[i + 1]!; n++; }
      if (y > 0) { sum += h[i - w]!; n++; }
      if (y < hgt - 1) { sum += h[i + w]!; n++; }
      out[i] = b[i]! - (sum - n * h[i]!);
    }
  }
}

/** Restrizione 2x1 per media dei blocchi 2x2 (full weighting semplificato). */
function restrict(src: Float32Array, w: number, h: number, cw: number, ch: number) {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const y0 = Math.min(h - 1, y * 2);
    const y1 = Math.min(h - 1, y * 2 + 1);
    for (let x = 0; x < cw; x++) {
      const x0 = Math.min(w - 1, x * 2);
      const x1 = Math.min(w - 1, x * 2 + 1);
      out[y * cw + x] = 0.25 * (src[y0 * w + x0]! + src[y0 * w + x1]! + src[y1 * w + x0]! + src[y1 * w + x1]!);
    }
  }
  return out;
}

/** Prolungamento bilineare dal livello grossolano, sommato alla soluzione fine. */
function prolongAdd(coarse: Float32Array, cw: number, ch: number, fine: Float32Array, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ch - 1, y * 0.5);
    const y0 = Math.floor(fy);
    const y1 = Math.min(ch - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(cw - 1, x * 0.5);
      const x0 = Math.floor(fx);
      const x1 = Math.min(cw - 1, x0 + 1);
      const tx = fx - x0;
      const a = coarse[y0 * cw + x0]! + (coarse[y0 * cw + x1]! - coarse[y0 * cw + x0]!) * tx;
      const bb = coarse[y1 * cw + x0]! + (coarse[y1 * cw + x1]! - coarse[y1 * cw + x0]!) * tx;
      fine[y * w + x] = fine[y * w + x]! + a + (bb - a) * ty;
    }
  }
}

function subtractMean(a: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  const m = s / a.length;
  for (let i = 0; i < a.length; i++) a[i] = a[i]! - m;
}

/** Un ciclo V di multigrid. */
function vCycle(h: Float32Array, b: Float32Array, w: number, hgt: number, preSweeps: number, postSweeps: number) {
  if (w <= 4 || hgt <= 4) { smooth(h, b, w, hgt, 40); return; }

  smooth(h, b, w, hgt, preSweeps);

  const r = new Float32Array(w * hgt);
  residual(h, b, w, hgt, r);

  const cw = Math.max(2, Math.floor(w / 2));
  const ch = Math.max(2, Math.floor(hgt / 2));
  const rc = restrict(r, w, hgt, cw, ch);
  subtractMean(rc); // compatibilita' di Neumann anche sul livello grossolano

  const ec = new Float32Array(cw * ch);
  vCycle(ec, rc, cw, ch, preSweeps, postSweeps);

  prolongAdd(ec, cw, ch, h, w, hgt);
  smooth(h, b, w, hgt, postSweeps);
}

export type PoissonOptions = {
  /** Numero di cicli V. 4-6 bastano per un errore visivamente nullo. */
  cycles?: number;
  preSweeps?: number;
  postSweeps?: number;
};

/**
 * Risolve lap(h) = b su griglia w*h con Neumann omogeneo.
 * Ritorna h a media nulla (la costante additiva e' arbitraria).
 */
export function solvePoissonNeumann(
  b: Float32Array,
  w: number,
  h: number,
  opts: PoissonOptions = {}
): Float32Array {
  const cycles = Math.max(1, opts.cycles ?? 5);
  const pre = Math.max(1, opts.preSweeps ?? 2);
  const post = Math.max(1, opts.postSweeps ?? 2);

  const rhs = new Float32Array(b); // copia: subtractMean modifica in place
  subtractMean(rhs);

  const out = new Float32Array(w * h);
  for (let c = 0; c < cycles; c++) {
    vCycle(out, rhs, w, h, pre, post);
    subtractMean(out);
  }
  return out;
}

/** Norma L2 media del residuo: serve ai test per dimostrare la convergenza. */
export function poissonResidualNorm(hField: Float32Array, b: Float32Array, w: number, h: number): number {
  const rhs = new Float32Array(b);
  subtractMean(rhs);
  const r = new Float32Array(w * h);
  residual(hField, rhs, w, h, r);
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i]! * r[i]!;
  return Math.sqrt(s / r.length);
}
