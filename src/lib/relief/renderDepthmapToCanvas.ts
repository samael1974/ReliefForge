export function renderDepthmapToCanvas(canvas: HTMLCanvasElement, normF32: Float32Array, w: number, h: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = w;
  canvas.height = h;

  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(1, normF32[i] ?? 0));
    const g = Math.round(v * 255);
    const k = i * 4;
    d[k + 0] = g;
    d[k + 1] = g;
    d[k + 2] = g;
    d[k + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
}