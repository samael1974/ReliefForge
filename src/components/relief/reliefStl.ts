import * as THREE from "three";
import { buildSolidFromHeightmap } from "@/lib/relief/buildSolidFromHeightmap";
import { buildPassepartoutRectPhi, passepartoutOuterBandsMm } from "@/lib/relief/frame/buildPassepartoutRectPhi";
import { buildFrameRectPocket, effectiveFrameLipMm } from "@/lib/relief/frame/buildFrameRectPocket";
import { Evaluator, Brush, ADDITION, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OutputMode, BaseStyle } from "@/lib/relief/reliefTypes";

export type HeightmapState = {
  normF32: Float32Array;
  w: number;
  h: number;
};

type DownloadArgs = {
  hm: HeightmapState; // ✅ UNICA sorgente: hm
  widthMm: number;
  depthMm: number;
  baseMm: number;
  outputMode: OutputMode; // (per ora non usato dal builder: tenuto per compatibilità UI)
  baseStyle: BaseStyle;   // ✅ coincide con il builder
  fileName?: string;
};

/** STL binary writer (little-endian) */
function geometryToBinaryStl(geom: THREE.BufferGeometry): ArrayBuffer {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) throw new Error("STL: geometry has no position attribute");

  const triCount = Math.floor(pos.count / 3);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);

  for (let i = 0; i < 80; i++) view.setUint8(i, 0);
  view.setUint32(80, triCount, true);

  let o = 84;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;

    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);

    if (
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y) ||
      !Number.isFinite(n.z) ||
      n.lengthSq() < 1e-30
    ) {
      n.set(0, 0, 0);
    } else {
      n.normalize();
    }

    view.setFloat32(o + 0, n.x, true);
    view.setFloat32(o + 4, n.y, true);
    view.setFloat32(o + 8, n.z, true);

    view.setFloat32(o + 12, a.x, true);
    view.setFloat32(o + 16, a.y, true);
    view.setFloat32(o + 20, a.z, true);

    view.setFloat32(o + 24, b.x, true);
    view.setFloat32(o + 28, b.y, true);
    view.setFloat32(o + 32, b.z, true);

    view.setFloat32(o + 36, c.x, true);
    view.setFloat32(o + 40, c.y, true);
    view.setFloat32(o + 44, c.z, true);

    view.setUint16(o + 48, 0, true);
    o += 50;
  }

  return buffer;
}

// ✅ conteggio bordi aperti (debug mesh)
function countOpenEdges(geom: THREE.BufferGeometry) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) throw new Error("countOpenEdges: missing position");

  // 0.001 mm quantization
  const q = (v: number) => Math.round(v * 1000);
  const keyOf = (i: number) => `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;

  const edgeCount = new Map<string, number>();

  const addEdge = (ia: number, ib: number) => {
    const a = keyOf(ia);
    const b = keyOf(ib);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
  };

  const triCount = Math.floor(pos.count / 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    addEdge(i0, i1);
    addEdge(i1, i2);
    addEdge(i2, i0);
  }

  const open: Array<{ a: string; b: string; mid: string; len: number }> = [];

  const parse = (k: string) => {
    const [x, y, z] = k.split(",").map((s) => Number(s) / 1000);
    return { x, y, z };
  };

  let openEdges = 0;
  for (const [k, c] of edgeCount.entries()) {
    if (c !== 1) continue;
    openEdges++;

    const [ka, kb] = k.split("|");
    const A = parse(ka);
    const B = parse(kb);

    const mx = (A.x + B.x) * 0.5;
    const my = (A.y + B.y) * 0.5;
    const mz = (A.z + B.z) * 0.5;

    const dx = A.x - B.x;
    const dy = A.y - B.y;
    const dz = A.z - B.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (open.length < 32) {
      open.push({
        a: `${A.x.toFixed(3)},${A.y.toFixed(3)},${A.z.toFixed(3)}`,
        b: `${B.x.toFixed(3)},${B.y.toFixed(3)},${B.z.toFixed(3)}`,
        mid: `${mx.toFixed(3)},${my.toFixed(3)},${mz.toFixed(3)}`,
        len: Number(len.toFixed(3)),
      });
    }
  }

  return { triCount, totalEdges: edgeCount.size, openEdges, openSample: open };
}

function downloadArrayBuffer(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], { type: "application/vnd.ms-pki.stl" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.toLowerCase().endsWith(".stl") ? fileName : `${fileName}.stl`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// ---- Assieme rilievo + cornice + passepartout (STL multi-corpo) ----

function toGeom(out: { vertices: Float32Array; indices: Uint32Array }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out.vertices, 3));
  g.setIndex(new THREE.BufferAttribute(out.indices, 1));
  return g;
}

function mergeGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const non = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of non) total += (g.getAttribute("position") as THREE.BufferAttribute).array.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const g of non) {
    const arr = (g.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    merged.set(arr, off);
    off += arr.length;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  return m;
}

/** Prepara una geometria per il CSG: non-indicizzata, con normal + uv (attributi coerenti tra brush). */
function prepCsg(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  if (!out.getAttribute("uv")) {
    const n = (out.getAttribute("position") as THREE.BufferAttribute).count;
    out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  return out;
}

/** Unione booleana (CSG) di più geometrie in un unico guscio pulito e stampabile. */
function csgUnion(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  let result = new Brush(prepCsg(geoms[0]));
  result.updateMatrixWorld();
  for (let i = 1; i < geoms.length; i++) {
    const b = new Brush(prepCsg(geoms[i]));
    b.updateMatrixWorld();
    result = evaluator.evaluate(result, b, ADDITION);
    result.updateMatrixWorld();
  }
  return result.geometry;
}

/** Sottrazione booleana (CSG): scava `cutter` da `base`. */
function csgSubtract(base: THREE.BufferGeometry, cutter: THREE.BufferGeometry): THREE.BufferGeometry {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  const a = new Brush(prepCsg(base));
  a.updateMatrixWorld();
  const b = new Brush(prepCsg(cutter));
  b.updateMatrixWorld();
  const r = evaluator.evaluate(a, b, SUBTRACTION);
  return r.geometry;
}

// --- Manifold: motore CSG robusto (WASM). Fonde anche il rilievo ad alta densità in un solido chiuso. ---
let _manifoldWasm: any = null;
async function getManifold(): Promise<any> {
  if (_manifoldWasm) return _manifoldWasm;
  // Vite non trova il .wasm da solo: gli passiamo l'URL esplicito con locateFile.
  const [mod, wasmUrlMod] = await Promise.all([
    import("manifold-3d"),
    import("manifold-3d/manifold.wasm?url"),
  ]);
  const Module: any = (mod as any).default;
  const wasmUrl: string = (wasmUrlMod as any).default;
  const wasm = await Module({ locateFile: () => wasmUrl });
  wasm.setup();
  _manifoldWasm = wasm;
  return wasm;
}

function geomToManifold(wasm: any, geom: THREE.BufferGeometry): any {
  // Manifold richiede vertici SALDATI (ogni bordo condiviso da 2 triangoli). Le geometrie THREE
  // hanno vertici duplicati ai bordi → vanno saldati PER POSIZIONE (ignorando normali/uv).
  const src = geom.index ? geom.toNonIndexed() : geom;
  const posOnly = new THREE.BufferGeometry();
  posOnly.setAttribute("position", (src.getAttribute("position") as THREE.BufferAttribute).clone());
  const welded = mergeVertices(posOnly); // salda per posizione → topologia manifold
  const vertProperties = new Float32Array((welded.getAttribute("position") as THREE.BufferAttribute).array as ArrayLike<number>);
  const triVerts = new Uint32Array(welded.index!.array as ArrayLike<number>);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
  return new wasm.Manifold(mesh);
}

function manifoldToGeom(man: any): THREE.BufferGeometry {
  const mesh = man.getMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  g.computeVertexNormals();
  return g;
}

/** Box manifold estruso lungo Z, centrato, con angoli (XY) eventualmente arrotondati.
 *  r<=0 → cubo a spigoli vivi (veloce). r>0 → rounded-rect via CrossSection.offset('Round'). */
function roundedBox(wasm: any, w: number, h: number, depth: number, r: number, cornerSegments: number): any {
  const rr = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  if (rr <= 0.01) return wasm.Manifold.cube([w, h, depth], true);
  const coreW = Math.max(0.01, w - 2 * rr);
  const coreH = Math.max(0.01, h - 2 * rr);
  const segs360 = Math.max(16, Math.round(cornerSegments) * 4);
  const cs = wasm.CrossSection.square([coreW, coreH], true).offset(rr, "Round", 2, segs360);
  // extrude(height, nDivisions, twistDegrees, scaleTop, center)
  // ⚠️ BUG STORICO RISOLTO (V8.4): scaleTop DEVE essere il vettore [1, 1].
  // Passare lo scalare 1 in manifold-3d 3.5.1 produce un CUNEO (la faccia
  // superiore collassa su un asse): era la causa delle geometrie deformi
  // di cornici e ritagli con angoli arrotondati negli STL esportati.
  return cs.extrude(depth, 0, 0, [1, 1], true);
}

// V8.4: 24 segmenti per angolo a 90° — curve lisce anche con raggi grandi (12mm+).
// Prima erano 8 e sul pezzo stampato si vedevano le sfaccettature.
const FRAME_CORNER_SEGMENTS = 24;

export type FrameCfg = {
  solidMm: number; frameHeightMm: number; glassMm: 2 | 3; glassClearanceMm: number;
  /** Battuta vetro (gradino radiale per lato, mm). 0 = nessuna battuta */
  lipMm: number;
  /** Profondità del vassoio sul retro (mm). 0 = cornice simmetrica senza vassoio */
  pocketDepthMm: number;
  /** Raggio arrotondamento spigoli verticali (mm). 0 = spigoli vivi */
  cornerRadiusMm?: number;
  /** Gioco per lato tra rilievo e apertura cornice (mm) — usato SOLO nell'export "solo cornice" */
  reliefGapMm?: number;
};
export type MatCfg = {
  steps: 1 | 2 | 3 | 4 | 5 | 6; totalBandsMm: number; minBandMm: number; thicknessMm: number; stepDropMm: number;
};

/** Esporta UN STL che contiene rilievo + (passepartout) + (cornice),
 *  con le STESSE trasformazioni dell'anteprima 3D. STL multi-corpo: i corpi
 *  sono chiusi singolarmente; niente check monolitico che bloccherebbe l'export. */
export async function downloadReliefAssemblyStl(
  args: DownloadArgs & {
    frame?: FrameCfg | null; mat?: MatCfg | null; reliefZmm?: number; matZmm?: number;
    glassSlot?: { enabled: boolean; grooveDepthMm: number; slotThicknessMm: number } | null;
    ledValance?: { enabled: boolean; widthMm: number; depthMm: number } | null;
    frameOnly?: boolean; // se true esporta SOLO cornice/passepartout (niente rilievo) per stampa separata
  }
) {
  const { hm, widthMm, depthMm, baseMm, baseStyle, fileName, frame, mat, reliefZmm = 0, matZmm = 0, glassSlot, ledValance, frameOnly = false } = args;
  if (!hm?.normF32) throw new Error("STL: heightmap mancante");

  // 1) Rilievo (stesso costruttore/orientamento dell'anteprima)
  const reliefOut = buildSolidFromHeightmap({
    height01: hm.normF32, width: hm.w, height: hm.h,
    outWidthMm: widthMm, depthMm, baseMm, baseStyle,
  });
  const relief = reliefOut.geometry;
  relief.computeBoundingBox();
  const bb0 = relief.boundingBox!;
  const c0 = new THREE.Vector3(); bb0.getCenter(c0);
  relief.translate(-c0.x, -bb0.min.y, -c0.z);
  relief.translate(0, 1, 0);
  relief.computeBoundingBox();
  const reliefTopY = relief.boundingBox!.max.y; // ~ H + 1
  const reliefCenterY = (reliefTopY - 1) / 2 + 1;
  const reliefFrontZ = relief.boundingBox!.max.z;
  const reliefBackZ = relief.boundingBox!.min.z;
  // offset di profondità del rilievo (come la posizione mesh in anteprima)
  relief.translate(0, 0, reliefZmm);

  const planW = widthMm;
  const planH = widthMm * (hm.h / hm.w);
  const OV = 3.0; // compenetrazione (mm) per la fusione piano/rilievo — combacia con ASSEMBLY_OVERLAP dell'anteprima
  const FRAME_INSET = 1.0; // quanto la cornice entra nel perimetro del rilievo (piccolo = a filo) — combacia con l'anteprima

  const geoms: THREE.BufferGeometry[] = frameOnly ? [] : [relief];

  // 2) Passepartout = PIANO DI FONDO SOLIDO dietro al rilievo.
  //    Il fronte del piano compenetra TUTTO il retro del rilievo → fusione robusta garantita.
  let matBands = 0;
  if (mat) {
    matBands = passepartoutOuterBandsMm({ steps: mat.steps, totalBandsMm: mat.totalBandsMm, minBandMm: mat.minBandMm });
  }

  // Mantiene preview ed STL sulla stessa impronta esterna. Il passepartout
  // compenetra il rilievo di OV mm per lato; la cornice lo morde di FRAME_INSET.
  const assemblyOuterW = mat ? planW + 2 * matBands - 2 * OV : planW;
  const assemblyOuterH = mat ? planH + 2 * matBands - 2 * OV : planH;
  // V8.4 — due geometrie distinte:
  //  * export FUSO: la cornice "morde" il resto di FRAME_INSET per saldarsi (come prima);
  //  * export SOLO CORNICE senza passepartout: la cornice va stampata a parte e deve
  //    CONTENERE il rilievo → apertura = rilievo + gioco per lato (regolabile in UI).
  //    (Con passepartout l'apertura è già più larga del rilievo: resta la saldatura col piano.)
  const reliefGap = Math.max(0, frame?.reliefGapMm ?? 0.3);
  const separateNoMat = frameOnly && !mat;
  const frameBackInnerW = separateNoMat ? planW + 2 * reliefGap : Math.max(1, assemblyOuterW - 2 * FRAME_INSET);
  const frameBackInnerH = separateNoMat ? planH + 2 * reliefGap : Math.max(1, assemblyOuterH - 2 * FRAME_INSET);

  if (mat) {
    const plateW = assemblyOuterW;
    const plateH = assemblyOuterH;
    const plateThk = Math.max(3, mat.thicknessMm);
    const plateFrontZ = reliefBackZ + reliefZmm + OV + matZmm; // OV mm dentro al retro del rilievo
    const m = new THREE.BoxGeometry(plateW, plateH, plateThk);
    m.translate(0, reliefCenterY, plateFrontZ - plateThk / 2);
    geoms.push(m);
  }

  // 3) Cornice a vassoio (ruotata come in anteprima). Usata solo per il fallback merge
  //    (la fusione manifold ricostruisce la cornice da primitive — vedi sotto).
  if (frame) {
    const f = toGeom(
      buildFrameRectPocket({
        innerWmm: frameBackInnerW,
        innerHmm: frameBackInnerH,
        thicknessMm: frame.solidMm,
        heightMm: frame.frameHeightMm,
        pocketDepthMm: frame.pocketDepthMm,
        lipMm: effectiveFrameLipMm(frame.lipMm),
        cornerRadiusMm: frame.cornerRadiusMm ?? 0,
      })
    );
    f.rotateX(-Math.PI / 2);
    f.translate(0, reliefCenterY, reliefFrontZ);
    geoms.push(f);
  }

  // (Il canale del vetro a baionetta è una SOTTRAZIONE CSG dopo l'unione — vedi sotto.)

  let merged: THREE.BufferGeometry;
  try {
    const wasm = await getManifold();

    // Rilievo = unica parte da geometria THREE (validata come manifold dopo saldatura vertici).
    // In modalità frameOnly il rilievo NON entra nell'unione (export solo cornice).
    let acc: any = null;
    if (!frameOnly) {
      try {
        acc = geomToManifold(wasm, relief);
      } catch (eRel) {
        console.error("[STL] il RILIEVO non è manifold valido:", eRel);
        throw eRel;
      }
    }

    // Passepartout = piano di fondo solido (cubo manifold), esteso 2mm dietro al rilievo
    // (no facce coincidenti) e compenetrante OV mm il retro → fusione robusta.
    if (mat) {
      const plateW = assemblyOuterW;
      const plateH = assemblyOuterH;
      const plateFrontZ = reliefBackZ + reliefZmm + OV + matZmm;
      const plateBackZ = reliefBackZ + reliefZmm - 2;
      const plate = wasm.Manifold.cube([plateW, plateH, plateFrontZ - plateBackZ], true)
        .translate([0, reliefCenterY, (plateFrontZ + plateBackZ) / 2]);
      acc = acc ? acc.add(plate) : plate;
    }

    // V8.4 FIX ANGOLI ARROTONDATI: il rilievo (e la piastra) sono rettangoli a
    // spigoli vivi; con cornerRadius > 0 i loro angoli sbucherebbero attraverso
    // e oltre le pareti curve della cornice (cunei visibili nello slicer).
    // Soluzione booleana: INTERSEZIONE con un prisma arrotondato pari
    // all'apertura + margine di saldatura → il contenuto segue le curve e resta
    // saldato alla cornice per FRAME_INSET su tutto il perimetro.
    if (!frameOnly && frame && (frame.cornerRadiusMm ?? 0) > 0.01 && acc) {
      const Rclip = Math.max(0, (frame.cornerRadiusMm ?? 0) - frame.solidMm) + FRAME_INSET;
      const clipW = frameBackInnerW + 2 * FRAME_INSET;
      const clipH = frameBackInnerH + 2 * FRAME_INSET;
      const clip = roundedBox(wasm, clipW, clipH, 400, Rclip, FRAME_CORNER_SEGMENTS)
        .translate([0, reliefCenterY, 0]);
      acc = acc.intersect(clip);
    }

    // Cornice a VASSOIO (L-profile booleano):
    //   1) Cubo esterno meno cubo "apertura fronte" (passante) = scatola cava con
    //      apertura visibile piccola.
    //   2) Sottrazione di un cubo "vassoio" sul retro, più largo dell'apertura
    //      frontale → la differenza radiale (= lipMm per lato) diventa il
    //      gradino di battuta strutturale su cui appoggia il vetro.
    //   Se lipMm o pocketDepthMm sono 0 la cornice resta simmetrica (legacy).
    if (frame) {
      const backInnerW = frameBackInnerW; // apertura retro (vassoio) -> combacia col passepartout
      const backInnerH = frameBackInnerH;
      const frH = frame.frameHeightMm;
      // La battuta resta funzionale anche quando non c'è il passepartout.
      const lip = effectiveFrameLipMm(frame.lipMm ?? 0);
      const pocketDepth = Math.max(0, Math.min(frame.pocketDepthMm ?? 0, frH - 0.5));
      const hasPocket = lip > 0 && pocketDepth > 0;

      const frontInnerW = hasPocket ? Math.max(1, backInnerW - 2 * lip) : backInnerW;
      const frontInnerH = hasPocket ? Math.max(1, backInnerH - 2 * lip) : backInnerH;

      // Raggi concentrici: bordo di larghezza costante attorno alle curve.
      const R = Math.max(0, frame.cornerRadiusMm ?? 0);
      const rBack = Math.max(0, R - frame.solidMm);
      const rFront = Math.max(0, R - frame.solidMm - lip);
      const segs = FRAME_CORNER_SEGMENTS;

      const outer = roundedBox(wasm, backInnerW + 2 * frame.solidMm, backInnerH + 2 * frame.solidMm, frH, R, segs);
      const frontHole = roundedBox(wasm, frontInnerW, frontInnerH, frH + 2, rFront, segs);
      let frameM = outer.subtract(frontHole);

      if (hasPocket) {
        // Vassoio scavato dal FRONTE (lato in vista), così il vetro si appoggia/incolla
        // sul davanti del rilievo. Asse Z (locale): cornice centrata in z=0 → z ∈ [-frH/2, +frH/2].
        // +z locale = fronte visibile (dopo la traslazione = lato del rilievo/viewer).
        // Vassoio dal fronte (+frH/2) fino al gradino di battuta a z=+frH/2-pocketDepth.
        // Oversize 1mm davanti per taglio pulito.
        const pocketSizeZ = pocketDepth + 1.0;
        const pocketCenterZ = frH / 2 - pocketDepth / 2 + 0.5; // 0.5 di sporgenza davanti
        const pocket = roundedBox(wasm, backInnerW, backInnerH, pocketSizeZ, rBack, segs)
          .translate([0, 0, pocketCenterZ]);
        frameM = frameM.subtract(pocket);
      }

      frameM = frameM.translate([0, reliefCenterY, reliefFrontZ - frH / 2]);
      acc = acc ? acc.add(frameM) : frameM;
    }

    if (!acc) throw new Error("STL: niente da esportare (attiva cornice o passepartout).");

    // Veletta LED: anello positivo sul fronte interno che nasconde la strip.
    if (frame && ledValance?.enabled && ledValance.widthMm > 0 && ledValance.depthMm > 0) {
      const rimW = ledValance.widthMm;
      const rimD = Math.min(ledValance.depthMm, frame.frameHeightMm - 0.5);
      const innerW = frameBackInnerW;
      const innerH = frameBackInnerH;
      const R = Math.max(0, frame.cornerRadiusMm ?? 0);
      const rOut = Math.max(0, R - frame.solidMm);
      const rIn = Math.max(0, R - frame.solidMm - rimW);
      const ledgeOuter = roundedBox(wasm, innerW, innerH, rimD, rOut, FRAME_CORNER_SEGMENTS);
      const ledgeHole = roundedBox(wasm, Math.max(1, innerW - 2 * rimW), Math.max(1, innerH - 2 * rimW), rimD + 2, rIn, FRAME_CORNER_SEGMENTS);
      const ledge = ledgeOuter.subtract(ledgeHole).translate([0, reliefCenterY, reliefFrontZ - rimD / 2]);
      acc = acc.add(ledge);
    }

    // Canale del vetro a baionetta: alloggiamento sui lati interni della cornice, APERTO IN ALTO.
    // Usa l'apertura FRONTE (la slot vive nel bordo frontale della cornice, sopra il vassoio).
    if (frame && glassSlot?.enabled) {
      const backW = frameBackInnerW;
      const backH = frameBackInnerH;
      const lip = effectiveFrameLipMm(frame.lipMm ?? 0);
      const pocketDepth = Math.max(0, Math.min(frame.pocketDepthMm ?? 0, frame.frameHeightMm - 0.5));
      const hasPocket = lip > 0 && pocketDepth > 0;
      const frontW = hasPocket ? Math.max(1, backW - 2 * lip) : backW;
      const frontH = hasPocket ? Math.max(1, backH - 2 * lip) : backH;
      const grooveDepth = Math.min(Math.max(0.8, glassSlot.grooveDepthMm), Math.max(1, frame.solidMm - 1.0));
      const slotThk = Math.max(1, glassSlot.slotThicknessMm);
      const frontWall = 1.5;
      const boxBottom = reliefCenterY - frontH / 2 - grooveDepth;
      const boxTop = reliefCenterY + frontH / 2 + frame.solidMm + 20;
      const sx = frontW + 2 * grooveDepth;
      const cutter = wasm.Manifold.cube([sx, boxTop - boxBottom, slotThk], true).translate([
        0,
        (boxTop + boxBottom) / 2,
        reliefFrontZ - frontWall - slotThk / 2,
      ]);
      acc = acc.subtract(cutter);
    }

    merged = manifoldToGeom(acc);
  } catch (e: any) {
    // V8.4: NIENTE fallback a merge semplice — produrrebbe silenziosamente un STL
    // NON manifold (corpi compenetranti non fusi). Meglio un errore chiaro.
    console.error("[STL] fusione manifold fallita:", e);
    if (glassSlot?.enabled) {
      throw new Error("Impossibile creare l'alloggiamento vetro: la sottrazione booleana non è riuscita.");
    }
    throw new Error("Fusione manifold non riuscita: nessun file esportato (un STL non-manifold non sarebbe stampabile). Dettaglio: " + (e?.message ?? String(e)));
  }
  const bin = geometryToBinaryStl(merged);
  downloadArrayBuffer(bin, fileName ?? "reliefforge-cornice");
}

export function downloadReliefStlBinary(args: DownloadArgs) {
  const {
    hm,
    widthMm,
    depthMm,
    baseMm,
    outputMode: _outputMode, // tenuto per compatibilità; non usato ora
    baseStyle,
    fileName,
  } = args;

  if (!hm) throw new Error("STL: missing heightmap (hm)");
  if (!(hm.normF32 instanceof Float32Array)) throw new Error("STL: hm.normF32 missing/invalid");

  const out = buildSolidFromHeightmap({
  height01: hm.normF32,
  width: hm.w,
  height: hm.h,
  outWidthMm: widthMm,
  depthMm,
  baseMm,
  baseStyle,
});
const geom = out.geometry;
geom.rotateZ(Math.PI);
geom.computeVertexNormals();



  // opzionale ma utile: centra e appoggia Z a 0 (come preview)
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (bb) {
    const center = new THREE.Vector3();
    bb.getCenter(center);
    geom.translate(-center.x, -center.y, -bb.min.z);
  }
  geom.computeVertexNormals();

  // sanity vertices finite
  const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) throw new Error("STL: missing position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`STL: non-finite vertex at index ${i}`);
    }
  }

  // ✅ debug: open edges
  const check = countOpenEdges(geom);
  console.log("[MESH CHECK]", check);
  if (check.openEdges > 0) console.table(check.openSample);
  if (check.openEdges > 0) {
    throw new Error(`Mesh non chiusa: openEdges=${check.openEdges}`);
  }

  const bin = geometryToBinaryStl(geom);
  downloadArrayBuffer(bin, fileName ?? "reliefforge");
}
