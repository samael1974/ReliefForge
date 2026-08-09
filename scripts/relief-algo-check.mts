// scripts/relief-algo-check.mts
//
// Verifica della compressione nel dominio dei gradienti.
//
// La tesi da dimostrare: a PARITA' di spessore fisico del rilievo, il dettaglio
// di superficie sopravvive molto meglio che con le rimappature puntuali
// (lineare, gamma, clip percentile) usate finora.
//
// Uso:  pnpm relief:check

import { gradientDomainRelief } from "../src/lib/relief/transform/gradientRelief";
import { solvePoissonNeumann, poissonResidualNorm } from "../src/lib/relief/transform/poisson";
import { gaussianBlurF32, gammaF32 } from "../src/lib/relief/transform/tonemap";

const W = 512, H = 512;
const DEPTH_MM = 3;          // spessore del rilievo
const DETAIL_AMPLITUDE = 0.02; // ampiezza del dettaglio nella scena originale (unita' normalizzate)

/**
 * Scena sintetica che riproduce il caso reale:
 *  - una cupola ampia e liscia (la testa) che occupa quasi tutto l'intervallo;
 *  - dettaglio di superficie di ampiezza NOTA sovrapposto alla cupola;
 *  - sfondo piatto, con un salto netto sulla silhouette.
 */
function scene() {
  const a = new Float32Array(W * H);
  const faceMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / (W - 1)) * 2 - 1;
      const ny = (y / (H - 1)) * 2 - 1;
      const r = Math.hypot(nx / 0.6, ny / 0.8);
      let v = 0;
      if (r < 1) {
        v = Math.sqrt(1 - r * r);                                   // cupola: range ~1.0
        v += DETAIL_AMPLITUDE * Math.sin(nx * 60) * Math.sin(ny * 60); // dettaglio fine
        faceMask[y * W + x] = 1;
      }
      a[y * W + x] = v;
    }
  }
  return { field: a, faceMask };
}

/** Ampiezza RMS del dettaglio (componente ad alta frequenza) dentro la maschera, in mm. */
function detailAmplitudeMm(field01: Float32Array, mask: Uint8Array, depthMm: number) {
  const low = gaussianBlurF32(field01, W, H, 4);
  let s = 0, n = 0;
  for (let i = 0; i < field01.length; i++) {
    if (!mask[i]) continue;
    const hp = (field01[i]! - low[i]!) * depthMm;
    s += hp * hp; n++;
  }
  return Math.sqrt(s / Math.max(1, n));
}

function normalize01(src: Float32Array) {
  const a = new Float32Array(src);
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1e-9, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! - lo) / span;
  return a;
}

function timeIt(fn: () => void, n = 3) {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  return ts[Math.floor(n / 2)]!;
}

let failures = 0;
const { field, faceMask } = scene();

console.log(`Scena ${W}x${H} — cupola con dettaglio di ampiezza nota, rilievo ${DEPTH_MM} mm\n`);

// ---------------------------------------------------------------- 1) correttezza
// Con compressione 0 la ricostruzione deve restituire il campo di partenza:
// e' la prova che gradienti, divergenza e risolutore di Poisson sono coerenti.
console.log("1) CORRETTEZZA — compressione 0 deve essere l'identita'");
{
  const base = normalize01(field);
  // forziamo il percorso completo (gradienti -> Poisson) con detailGain minimo
  const round = gradientDomainRelief(field, W, H, { compression: 1e-9, detailGain: 1e-9, cycles: 8 });
  let maxDiff = 0, s = 0;
  for (let i = 0; i < base.length; i++) {
    const d = Math.abs(base[i]! - round[i]!);
    if (d > maxDiff) maxDiff = d;
    s += d;
  }
  const mean = s / base.length;
  console.log(`   differenza max ${maxDiff.toFixed(5)} | media ${mean.toFixed(6)} (unita' normalizzate)`);
  if (mean > 0.01) { console.log("   ✗ la ricostruzione non torna al campo originale"); failures++; }
  else console.log("   ✓ round-trip corretto\n");
}

// ---------------------------------------------------------------- 2) convergenza
console.log("2) CONVERGENZA del multigrid");
{
  const div = new Float32Array(W * H);
  for (let i = 0; i < div.length; i++) div[i] = Math.sin(i * 0.01) * 0.001;
  let prev = Infinity;
  let monotone = true;
  for (const cycles of [1, 2, 4, 8]) {
    const sol = solvePoissonNeumann(div, W, H, { cycles });
    const res = poissonResidualNorm(sol, div, W, H);
    console.log(`   ${cycles} cicli -> residuo ${res.toExponential(2)}`);
    if (res > prev) monotone = false;
    prev = res;
  }
  if (!monotone) { console.log("   ✗ il residuo non decresce"); failures++; }
  else console.log("   ✓ residuo monotono decrescente\n");
}

// ---------------------------------------------------------------- 3) la tesi
console.log(`3) DETTAGLIO SOPRAVVISSUTO a ${DEPTH_MM} mm (ampiezza RMS dell'alta frequenza sul volto)`);
{
  const linear = normalize01(field);
  const linAmp = detailAmplitudeMm(linear, faceMask, DEPTH_MM);
  console.log(`   lineare (8.4)              ${(linAmp * 1000).toFixed(1)} µm`);

  for (const g of [0.6, 0.4]) {
    const gm = normalize01(gammaF32(linear, g));
    const amp = detailAmplitudeMm(gm, faceMask, DEPTH_MM);
    console.log(`   gamma ${g}                  ${(amp * 1000).toFixed(1)} µm  (${(amp / linAmp).toFixed(2)}x)`);
  }

  let best = 0;
  for (const alpha of [2, 5, 10]) {
    const gr = gradientDomainRelief(field, W, H, { compression: alpha, cycles: 5 });
    const amp = detailAmplitudeMm(gr, faceMask, DEPTH_MM);
    if (amp > best) best = amp;
    console.log(`   gradienti α=${alpha}${alpha < 10 ? " " : ""}                ${(amp * 1000).toFixed(1)} µm  (${(amp / linAmp).toFixed(2)}x)`);
  }
  for (const dg of [0.8]) {
    const gr = gradientDomainRelief(field, W, H, { compression: 5, detailGain: dg, cycles: 5 });
    const amp = detailAmplitudeMm(gr, faceMask, DEPTH_MM);
    if (amp > best) best = amp;
    console.log(`   gradienti α=5 + boost ${dg}   ${(amp * 1000).toFixed(1)} µm  (${(amp / linAmp).toFixed(2)}x)`);
  }

  // Soglia pratica: sotto ~50 µm il dettaglio sparisce fra i layer di stampa.
  console.log(`\n   riferimento: layer tipico FDM 80-200 µm`);
  if (best <= linAmp * 1.5) { console.log("   ✗ nessun guadagno reale sul dettaglio"); failures++; }
  else console.log(`   ✓ guadagno ${(best / linAmp).toFixed(1)}x sul dettaglio conservato`);
}

// ---------------------------------------------------------------- 4) costo
console.log("\n4) COSTO");
{
  const ms = timeIt(() => { gradientDomainRelief(field, W, H, { compression: 5, cycles: 5 }); });
  const perMpx = ms / ((W * H) / 1e6);
  console.log(`   ${W}x${H}: ${ms.toFixed(0)} ms  (~${perMpx.toFixed(0)} ms/Mpx -> ~${(perMpx * 0.7).toFixed(0)} ms su 1024x683)`);
  if (ms > 2000) { console.log("   ✗ troppo lento per l'anteprima"); failures++; }
  else console.log("   ✓ compatibile con l'anteprima interattiva");
}

console.log(failures === 0 ? "\n✅ tutti i controlli superati" : `\n❌ ${failures} controlli falliti`);
process.exit(failures === 0 ? 0 : 1);
