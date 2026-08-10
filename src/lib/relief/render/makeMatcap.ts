// src/lib/relief/render/makeMatcap.ts
//
// Genera una texture MATCAP proceduralmente (V8.5).
//
// A cosa serve: per giudicare la TRIDIMENSIONALITA' di un bassorilievo non serve una
// resa realistica, serve una superficie che reagisca solo all'ORIENTAMENTO. Un matcap
// fa esattamente questo: l'ombreggiatura si campiona dalla normale in spazio-camera,
// quindi ruotando il pezzo la luce non si muove e si legge la forma invece
// dell'illuminazione. E' la vista che usano i software di scultura.
//
// Perche' procedurale e non un file: i preset `Environment` di drei scaricano una
// mappa HDR da internet a runtime. In un'app desktop che deve funzionare in locale
// non e' accettabile che la resa dipenda dalla connessione, e un materiale metallico
// senza ambiente verrebbe piatto. Qui la texture si costruisce in memoria: niente
// rete, niente file, nessuna dipendenza aggiuntiva.
//
// La texture rappresenta una sfera illuminata vista di fronte: il pixel (u,v) contiene
// il colore della superficie la cui normale in spazio-camera punta verso (u,v).

import * as THREE from "three";

export type MatcapOptions = {
  /** Azimut della luce in gradi: 0 = da destra, 90 = dall'alto, 180 = da sinistra. */
  lightDeg?: number;
  /** Elevazione della luce in gradi sopra l'orizzonte. */
  elevationDeg?: number;
  /** 0 = gesso opaco, 1 = cromo lucido. Governa specularita' e nitidezza del riflesso. */
  metallic?: number;
  /** Risoluzione della texture (quadrata). */
  size?: number;
  /** Tinta di base, in [0..1] per canale. */
  base?: [number, number, number];
};

/**
 * Costruisce la texture. Da rigenerare quando cambiano luce o stile: costa
 * ~256x256 = 65k pixel, cioe' pochi millisecondi.
 */
export function makeMatcapTexture(opts: MatcapOptions = {}): THREE.CanvasTexture {
  const size = Math.max(64, Math.round(opts.size ?? 256));
  const metallic = Math.min(1, Math.max(0, opts.metallic ?? 0.75));
  const az = ((opts.lightDeg ?? 35) * Math.PI) / 180;
  const el = ((opts.elevationDeg ?? 30) * Math.PI) / 180;
  const base = opts.base ?? [0.82, 0.80, 0.78];

  // Direzione luce in spazio-camera. Z verso l'osservatore.
  const lx = Math.cos(az) * Math.cos(el);
  const ly = Math.sin(el);
  const lz = Math.sin(az) * Math.cos(el) * 0.35 + 0.55; // sempre un po' frontale

  const ll = Math.hypot(lx, ly, lz) || 1;
  const Lx = lx / ll, Ly = ly / ll, Lz = lz / ll;

  // Seconda luce, opposta e fredda: apre le ombre senza appiattire il rilievo.
  const Fx = -Lx * 0.7, Fy = -Ly * 0.3, Fz = 0.6;
  const fl = Math.hypot(Fx, Fy, Fz) || 1;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const shininess = 8 + metallic * 180;
  const specStrength = 0.15 + metallic * 1.15;
  const diffuseStrength = 1 - metallic * 0.45;

  for (let y = 0; y < size; y++) {
    // v cresce verso il basso nel canvas, la normale verso l'alto: si inverte.
    const ny = 1 - (2 * (y + 0.5)) / size;
    for (let x = 0; x < size; x++) {
      const nx = (2 * (x + 0.5)) / size - 1;
      const i = (y * size + x) * 4;

      const r2 = nx * nx + ny * ny;
      if (r2 > 1) {
        // Fuori dalla sfera: campionato solo da normali radenti. Tenuto scuro ma non
        // nero, cosi' i bordi non si stampano come una linea dura.
        data[i] = data[i + 1] = data[i + 2] = 18;
        data[i + 3] = 255;
        continue;
      }
      const nz = Math.sqrt(1 - r2);

      const nDotL = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      const nDotF = Math.max(0, (nx * Fx + ny * Fy + nz * Fz) / fl);

      // Speculare Blinn-Phong con vista lungo Z.
      const hx = Lx, hy = Ly, hz = Lz + 1;
      const hl = Math.hypot(hx, hy, hz) || 1;
      const nDotH = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
      const spec = Math.pow(nDotH, shininess) * specStrength;

      // Ambiente a gradiente verticale (cielo chiaro / suolo scuro): e' cio' che
      // rende leggibile l'inclinazione anche dove non batte la luce diretta.
      const sky = 0.5 + 0.5 * ny;
      const ambient = 0.16 + 0.20 * sky;

      // Fresnel: bordi piu' brillanti, accentua i profili come su un pezzo lucido.
      const fres = Math.pow(1 - nz, 3) * (0.10 + metallic * 0.45);

      const lit = ambient + diffuseStrength * nDotL * 0.85 + nDotF * 0.16;

      const r = base[0] * lit + spec + fres;
      const g = base[1] * lit + spec + fres * 1.02;
      const b = base[2] * lit + spec * 1.05 + fres * 1.10;

      data[i] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(Math.min(1, r), 1 / 2.2))));
      data[i + 1] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(Math.min(1, g), 1 / 2.2))));
      data[i + 2] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(Math.min(1, b), 1 / 2.2))));
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
