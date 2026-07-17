export const PHI = 1.618033988749895;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function phiBands(totalMm: number, steps: number, phi = PHI): number[] {
  const n = Math.max(1, Math.floor(steps));
  if (n === 1) return [totalMm];

  const a = (totalMm * (phi - 1)) / (Math.pow(phi, n) - 1);
  const out = Array.from({ length: n }, (_, i) => a * Math.pow(phi, i));

  const s = out.reduce((acc, x) => acc + x, 0);
  const k = s > 0 ? totalMm / s : 1;
  return out.map((x) => x * k);
}
