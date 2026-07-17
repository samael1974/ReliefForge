// src/lib/relief/decodeDepthmapPng.ts
// Decoder PNG (grayscale 8/16-bit, RGB/RGBA, gray+alpha) -> heightmap normalizzata [0..1].
// Abilita la modalita' "Depth map" a leggere DAVVERO i 16-bit (no piu' canvas a 8-bit).
// Requisito: npm i pako
import pako from "pako";

export type DecodedDepthmap = { normF32: Float32Array; w: number; h: number; bitDepth?: 8 | 16 };

export function decodeDepthmapPng(bytes: Uint8Array): DecodedDepthmap {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("File non e' un PNG valido.");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos < bytes.length) {
    const len = dv.getUint32(pos); pos += 4;
    const type = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); pos += 4;
    if (type === "IHDR") {
      width = dv.getUint32(pos); height = dv.getUint32(pos + 4);
      bitDepth = bytes[pos + 8]; colorType = bytes[pos + 9]; interlace = bytes[pos + 12];
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(pos, pos + len));
    } else if (type === "IEND") { pos += len + 4; break; }
    pos += len + 4; // dati + CRC
  }
  if (interlace !== 0) throw new Error("PNG interlacciato (Adam7) non supportato. Salva senza interlacciamento.");

  let total = 0; idat.forEach((c) => (total += c.length));
  const comp = new Uint8Array(total); let o = 0; idat.forEach((c) => { comp.set(c, o); o += c.length; });
  const raw = pako.inflate(comp);

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4
    : (() => { throw new Error("colorType " + colorType + " non supportato (usa grayscale o RGB)."); })();
  const bps = bitDepth === 16 ? 2 : 1;
  const bpp = channels * bps;
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]; const rs = y * stride;
    for (let x = 0; x < stride; x++) {
      const rb = raw[p++];
      const a = x >= bpp ? out[rs + x - bpp] : 0;
      const b = y > 0 ? out[rs - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[rs - stride + x - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = rb; break;
        case 1: v = rb + a; break;
        case 2: v = rb + b; break;
        case 3: v = rb + ((a + b) >> 1); break;
        case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; v = rb + pr; break; }
        default: throw new Error("Filtro PNG sconosciuto: " + filter);
      }
      out[rs + x] = v & 0xff;
    }
  }
  const normF32 = new Float32Array(width * height);
  const mx = bitDepth === 16 ? 65535 : 255;
  for (let i = 0; i < width * height; i++) {
    const base = i * bpp; let lum: number;
    if (channels <= 2) lum = bitDepth === 16 ? ((out[base] << 8) | out[base + 1]) : out[base];
    else {
      let r: number, g: number, bb: number;
      if (bitDepth === 16) { r = (out[base] << 8) | out[base + 1]; g = (out[base + 2] << 8) | out[base + 3]; bb = (out[base + 4] << 8) | out[base + 5]; }
      else { r = out[base]; g = out[base + 1]; bb = out[base + 2]; }
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * bb;
    }
    normF32[i] = lum / mx;
  }
  return { normF32, w: width, h: height, bitDepth: bitDepth === 16 ? 16 : 8 };
}
