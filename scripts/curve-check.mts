// Verifica della curva tonale: monotonia, identita', equivalenza ai livelli.
import { buildCurveLut, sanitizeCurve, levelsCurve, applyCurve, IDENTITY_CURVE } from "../src/lib/relief/transform/toneCurve";

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) fail++; };

console.log("1) IDENTITA' — la curva di default non deve toccare i dati");
{
  const lut = buildCurveLut(IDENTITY_CURVE, 1024);
  let max = 0;
  for (let i = 0; i < 1000; i++) { const x = i / 999; max = Math.max(max, Math.abs(lut[Math.round(x * 1023)]! - x)); }
  check(max < 2e-3, `scarto massimo ${max.toExponential(2)}`);
}

console.log("\n2) MONOTONIA — nessuna curva puo' invertire il rilievo");
{
  // Casi avversi: punti quasi verticali, ravvicinati, in ordine sparso, non monotoni.
  const casi = [
    [{x:0,y:0},{x:0.5,y:0.95},{x:0.52,y:0.05},{x:1,y:1}],      // punto che scende
    [{x:0,y:0},{x:0.02,y:0.9},{x:0.98,y:0.95},{x:1,y:1}],      // gradino ripidissimo
    [{x:0.8,y:0.2},{x:0.1,y:0.7},{x:0,y:0},{x:1,y:1}],          // ordine sparso
    [{x:0,y:0.4},{x:0.3,y:0.4},{x:0.7,y:0.4},{x:1,y:0.4}],      // piatta
  ];
  let worst = 0;
  for (const c of casi) {
    const lut = buildCurveLut(sanitizeCurve(c as any), 2048);
    for (let i = 1; i < lut.length; i++) worst = Math.min(worst, lut[i]! - lut[i - 1]!);
  }
  check(worst >= -1e-6, `derivata minima ${worst.toExponential(2)} (deve essere >= 0)`);
}

console.log("\n3) EQUIVALENZA AI LIVELLI — la curva a due punti taglia come prima");
{
  const lo = 0.2, hi = 0.8;
  const lut = buildCurveLut(levelsCurve(lo, hi), 4096);
  const src = new Float32Array([0, 0.1, lo, 0.5, hi, 0.9, 1]);
  const out = applyCurve(src, lut);
  const atteso = [...src].map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
  let max = 0;
  for (let i = 0; i < src.length; i++) max = Math.max(max, Math.abs(out[i]! - atteso[i]!));
  console.log(`     in  ${[...src].map(v=>v.toFixed(2)).join(" ")}`);
  console.log(`     out ${[...out].map(v=>v.toFixed(3)).join(" ")}`);
  check(max < 5e-3, `scarto massimo dai livelli ${max.toExponential(2)}`);
}

console.log("\n4) INTERVALLO — l'uscita resta in [0..1]");
{
  const lut = buildCurveLut(sanitizeCurve([{x:0,y:0},{x:0.15,y:0.85},{x:0.9,y:0.9},{x:1,y:1}] as any), 2048);
  let lo = Infinity, hi = -Infinity;
  for (const v of lut) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  check(lo >= -1e-6 && hi <= 1 + 1e-6, `intervallo [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
}

console.log(fail === 0 ? "\n✅ tutti i controlli superati" : `\n❌ ${fail} controlli falliti`);
process.exit(fail === 0 ? 0 : 1);
