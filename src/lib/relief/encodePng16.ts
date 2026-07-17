// src/lib/relief/encodePng16.ts — PNG grayscale 16-bit (il canvas fa solo 8-bit). Requisito: npm i pako
import pako from "pako";
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function u32(n: number) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function chunk(type: string, data: Uint8Array) { const t = new TextEncoder().encode(type); const body = new Uint8Array(t.length + data.length); body.set(t, 0); body.set(data, t.length); const out = new Uint8Array(4 + body.length + 4); out.set(u32(data.length), 0); out.set(body, 4); out.set(u32(crc32(body)), 4 + body.length); return out; }
export function encodePng16(h01: Float32Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 2)); let p = 0;
  for (let y = 0; y < h; y++) { raw[p++] = 0; for (let x = 0; x < w; x++) { let v = h01[y * w + x]; v = v < 0 ? 0 : v > 1 ? 1 : v; const s = Math.round(v * 65535); raw[p++] = (s >>> 8) & 255; raw[p++] = s & 255; } }
  const idat = pako.deflate(raw);
  const ihdr = new Uint8Array(13); ihdr.set(u32(w), 0); ihdr.set(u32(h), 4); ihdr[8] = 16; ihdr[9] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  let len = 0; parts.forEach((x) => (len += x.length)); const out = new Uint8Array(len); let o = 0; parts.forEach((x) => { out.set(x, o); o += x.length; });
  return out;
}
