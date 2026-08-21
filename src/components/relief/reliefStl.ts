import * as THREE from "three";
import { buildSolidFromHeightmap } from "@/lib/relief/buildSolidFromHeightmap";
import { buildCircularSolidFromHeightmap } from "@/lib/relief/buildCircularSolid";
import { buildAdaptiveSolidFromHeightmap } from "@/lib/relief/buildAdaptiveSolid";
import { buildPassepartoutManifold } from "@/lib/relief/frame/buildPassepartoutManifold";
import { roundedBox, extrudeOutline, FRAME_CORNER_SEGMENTS } from "@/lib/relief/frame/manifoldPrimitives";
import { outlinePoints, insetOutline, outlineExtent, type OutlineKind } from "@/lib/relief/frame/outline";
import { computeAssemblyLayout, WELD_BITE, type AssemblyLayout } from "@/lib/relief/frame/assemblyLayout";
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
  /** V8.5 — errore geometrico massimo (mm) del mesher adattivo. Assente/0 = griglia uniforme. */
  toleranceMm?: number;
  /** V8.14 — se valorizzato, il rilievo e' un disco di questo diametro (mm). */
  circularDiameterMm?: number;
  /** V8.19 — angoli arrotondati del rilievo (mm). */
  reliefCornerRadiusMm?: number;
  /** V8.24 — contorno del rilievo per cornici non rettangolari. */
  reliefOutlinePts?: Array<{ x: number; z: number }>;
};

/** V8.5: mesher adattivo se e' stata indicata una tolleranza, altrimenti griglia uniforme.
 *  L'adattivo mette i triangoli dove c'e' dettaglio: su un ritratto 90 mm sono ~30x meno
 *  triangoli a parita' di resa, e il CSG manifold di conseguenza e' molto piu' rapido. */
export function buildReliefSolid(a: {
  hm: HeightmapState; widthMm: number; depthMm: number; baseMm: number;
  baseStyle: BaseStyle; toleranceMm?: number; circularDiameterMm?: number;
  /** Angoli arrotondati del rilievo, per combaciare con una cornice arrotondata. */
  reliefCornerRadiusMm?: number;
  /** Contorno del rilievo quando la cornice non e' rettangolare. */
  reliefOutlinePts?: Array<{ x: number; z: number }>;
}) {
  // Rilievo CIRCOLARE: mesh costruita direttamente tonda. Il confronto misurato con
  // l'intersezione booleana e' in scripts/circular-check.mts: 154x piu' veloce, meta'
  // dei triangoli, bordo esatto invece che poligonale.
  const rCorner = Math.max(0, a.reliefCornerRadiusMm ?? 0);
  const sagoma = a.reliefOutlinePts && a.reliefOutlinePts.length >= 3 ? a.reliefOutlinePts : undefined;
  if ((a.circularDiameterMm && a.circularDiameterMm > 0) || rCorner > 0.01 || sagoma) {
    const wMm = a.widthMm;
    const hMm = a.widthMm * ((a.hm.h - 1) / (a.hm.w - 1));
    const out = buildCircularSolidFromHeightmap({
      height01: a.hm.normF32, width: a.hm.w, height: a.hm.h,
      outDiameterMm: a.circularDiameterMm ?? wMm, depthMm: a.depthMm, baseMm: a.baseMm,
      ...(a.circularDiameterMm && a.circularDiameterMm > 0 && !sagoma
        ? {}
        : { outWidthMm: wMm, outHeightMm: hMm, cornerRadiusMm: rCorner, outlinePts: sagoma }),
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(out.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(out.indices, 1));
    g.computeVertexNormals();
    return { geometry: g, vertices: out.vertices, indices: out.indices };
  }
  if (a.toleranceMm && a.toleranceMm > 0) {
    return buildAdaptiveSolidFromHeightmap({
      height01: a.hm.normF32, width: a.hm.w, height: a.hm.h,
      outWidthMm: a.widthMm, depthMm: a.depthMm, baseMm: a.baseMm,
      baseStyle: a.baseStyle, toleranceMm: a.toleranceMm,
    });
  }
  return buildSolidFromHeightmap({
    height01: a.hm.normF32, width: a.hm.w, height: a.hm.h,
    outWidthMm: a.widthMm, depthMm: a.depthMm, baseMm: a.baseMm, baseStyle: a.baseStyle,
  });
}

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

// --- Manifold: motore CSG robusto (WASM). Fonde anche il rilievo ad alta densità in un solido chiuso. ---
let _manifoldWasm: any = null;
export async function getManifold(): Promise<any> {
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

export function geomToManifold(wasm: any, geom: THREE.BufferGeometry): any {
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

export function manifoldToGeom(man: any): THREE.BufferGeometry {
  const mesh = man.getMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  g.computeVertexNormals();
  return g;
}

export type FrameCfg = {
  solidMm: number; frameHeightMm: number; glassMm: 2 | 3; glassClearanceMm: number;
  /** Battuta vetro (gradino radiale per lato, mm). 0 = nessuna battuta */
  lipMm: number;
  /** Profondità del vassoio sul retro (mm). 0 = cornice simmetrica senza vassoio */
  pocketDepthMm: number;
  /** Raggio arrotondamento spigoli verticali (mm). 0 = spigoli vivi */
  cornerRadiusMm?: number;
  /** Forma della cornice. "rect" (default) mantiene il percorso collaudato. */
  outlineKind?: OutlineKind;
  /** Numero di lati quando la forma e' un poligono. */
  outlineSides?: number;
  /** Rotazione del contorno in gradi: decide su che lato appoggia un poligono. */
  outlineRotationDeg?: number;
  /** Battuta vetro frontale: larghezza radiale del labbro. 0 = assente. */
  glassSeatMm?: number;
  /** Profondita' della sede vetro dal fronte (di norma spessore vetro + gioco). */
  glassSeatDepthMm?: number;
  /** Spessore del bordino su cui appoggia il rilievo. */
  lipThickMm?: number;
  /** Da che lato si infila il bassorilievo: il bordino si mette dal lato opposto. */
  reliefLoadFrom?: "front" | "back";
  /** Gioco per lato tra rilievo e apertura cornice (mm) — usato SOLO nell'export "solo cornice" */
  reliefGapMm?: number;
};
export type MatCfg = {
  steps: 1 | 2 | 3 | 4 | 5 | 6; totalBandsMm: number; minBandMm: number; thicknessMm: number; stepDropMm: number;
};

/** Esporta UN STL che contiene rilievo + (passepartout) + (cornice),
 *  con le STESSE trasformazioni dell'anteprima 3D. STL multi-corpo: i corpi
 *  sono chiusi singolarmente; niente check monolitico che bloccherebbe l'export. */
export type AssemblyArgs = DownloadArgs & {
  frame?: FrameCfg | null; mat?: MatCfg | null; reliefZmm?: number; matZmm?: number;
  glassSlot?: { enabled: boolean; grooveDepthMm: number; slotThicknessMm: number } | null;
  ledValance?: { enabled: boolean; widthMm: number; depthMm: number } | null;
  frameOnly?: boolean; // se true esporta SOLO cornice/passepartout (niente rilievo) per stampa separata
};

/** Costruisce la geometria dell'assieme (rilievo + passepartout + cornice) come solido
 *  manifold unico. Funzione PURA: nessuna API del browser, quindi testabile in Node.
 *  `downloadReliefAssemblyStl` e' solo il wrapper che la scarica come file. */
export async function buildReliefAssemblyGeometry(
  args: AssemblyArgs
): Promise<{ geometry: THREE.BufferGeometry; layout: AssemblyLayout }> {
  const { hm, widthMm, depthMm, baseMm, baseStyle, frame, mat, reliefZmm = 0, matZmm = 0, glassSlot, ledValance, frameOnly = false, toleranceMm } = args;
  if (!hm?.normF32) throw new Error("STL: heightmap mancante");

  // 1) Rilievo (stesso costruttore/orientamento dell'anteprima)
  const reliefOut = buildReliefSolid({ hm, widthMm, depthMm, baseMm, baseStyle, toleranceMm });
  const relief = reliefOut.geometry;
  relief.computeBoundingBox();
  const bb0 = relief.boundingBox!;
  const c0 = new THREE.Vector3(); bb0.getCenter(c0);
  relief.translate(-c0.x, -bb0.min.y, -c0.z); // X centrato, Y in [0..H], Z centrato
  relief.translate(0, 1, 0);                  // Y in [1..H+1]
  const reliefThicknessMm = bb0.max.z - bb0.min.z; // base + profondità

  const planW = widthMm;  // sovrascritto sotto quando il rilievo e' sagomato
  // Stessa formula di buildSolidFromHeightmap: usa i SEGMENTI (w-1, h-1), non i pixel.
  // Con (h/w) la cornice risultava ~0.03 mm più alta del rilievo che doveva contenere.
  // L'impronta deve combaciare con il contorno VERO del rilievo. Se la si deduce
  // dalle proporzioni dell'immagine mentre il rilievo e' sagomato su un poligono o
  // un'ellisse, cornice e bassorilievo escono di misure diverse.
  const estSagoma = args.reliefOutlinePts && args.reliefOutlinePts.length >= 3
    ? outlineExtent(args.reliefOutlinePts)
    : null;
  const planH = estSagoma
    ? estSagoma.h
    : args.circularDiameterMm && args.circularDiameterMm > 0
      ? planW
      : widthMm * ((hm.h - 1) / (hm.w - 1));

  // V8.5: tutte le quote derivate vengono da UNA sola funzione, condivisa con l'anteprima.
  const L = computeAssemblyLayout({
    reliefW: planW,
    reliefH: planH,
    reliefThicknessMm,
    reliefYOffset: 1,
    reliefZmm,
    matZmm,
    frame: frame ?? null,
    mat: mat ?? null,
    // L'export fuso salda i pezzi (serve il morso); "solo cornice" li stampa separati.
    welded: !frameOnly,
  });

  // offset di profondità del rilievo (come la posizione mesh in anteprima)
  relief.translate(0, 0, reliefZmm);

  const reliefCenterY = L.centerY;
  const framePocketW = L.framePocketW;
  const framePocketH = L.framePocketH;

  if (L.warnings.length) console.warn("[STL] avvisi assieme:\n - " + L.warnings.join("\n - "));

  // (Cornice, passepartout e ritagli sono costruiti da primitive manifold più sotto:
  //  è l'unico percorso, non c'è più un fallback a merge non-manifold.)

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

    // V8.5 — PASSEPARTOUT VERO.
    // Prima qui c'era un `Manifold.cube`: una lastra PIENA, senza apertura, che
    // veniva unita al rilievo. Con OV=3mm fissi di penetrazione, su rilievi sottili
    // il fronte della lastra superava la superficie e il bassorilievo spariva dentro
    // al "passepartout". Ora si costruisce l'anello a gradoni φ CON il foro — la
    // stessa geometria che si vede in anteprima — e la penetrazione in Z è clampata
    // dal layout per lasciare sempre materiale di rilievo davanti.
    if (mat && L.matInnerW !== null && L.matInnerH !== null && L.matFrontZ !== null) {
      const matM = buildPassepartoutManifold(wasm, {
        innerWmm: L.matInnerW,
        innerHmm: L.matInnerH,
        steps: mat.steps,
        totalBandsMm: mat.totalBandsMm,
        minBandMm: mat.minBandMm,
        thicknessMm: mat.thicknessMm,
        stepDropMm: mat.stepDropMm,
      }).translate([0, reliefCenterY, L.matFrontZ]);
      acc = acc ? acc.add(matM) : matM;
    }

    // V8.4 FIX ANGOLI ARROTONDATI: rilievo e passepartout sono rettangoli a
    // spigoli vivi; con cornerRadius > 0 i loro angoli sbucherebbero attraverso
    // e oltre le pareti curve della cornice (cunei visibili nello slicer).
    // Soluzione booleana: INTERSEZIONE con un prisma arrotondato pari
    // all'apertura + margine di saldatura → il contenuto segue le curve e resta
    // saldato alla cornice su tutto il perimetro.
    if (!frameOnly && frame && (frame.cornerRadiusMm ?? 0) > 0.01 && acc) {
      const Rclip = Math.max(0, (frame.cornerRadiusMm ?? 0) - frame.solidMm) + WELD_BITE;
      const clipW = framePocketW + 2 * WELD_BITE;
      const clipH = framePocketH + 2 * WELD_BITE;
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
      const backInnerW = framePocketW; // apertura retro (vassoio) -> combacia col passepartout
      const backInnerH = framePocketH;
      const frH = frame.frameHeightMm;
      // Battuta, vassoio e apertura visibile vengono TUTTI dal layout condiviso.
      const lip = L.effectiveLipMm;
      const pocketDepth = L.effectivePocketDepthMm;
      const hasPocket = L.hasPocket;

      const frontInnerW = L.frameApertureW;
      const frontInnerH = L.frameApertureH;

      // Raggi concentrici: bordo di larghezza costante attorno alle curve.
      const R = Math.max(0, frame.cornerRadiusMm ?? 0);
      const rBack = Math.max(0, R - frame.solidMm);
      const rFront = Math.max(0, R - frame.solidMm - lip);
      const segs = FRAME_CORNER_SEGMENTS;

      // Forme diverse dal rettangolo: i contorni concentrici si ricavano dalla
      // CAVITA' rientrando o allargando di una distanza costante, con la stessa
      // funzione che usa l'anteprima. Il rettangolo resta su roundedBox, che e'
      // collaudata: nessun motivo di cambiarla e rischiare una regressione.
      const kind: OutlineKind = frame.outlineKind ?? "rect";
      const sagomata = kind !== "rect";
      const ptsCavita = sagomata
        ? outlinePoints({ kind, halfW: backInnerW / 2, halfH: backInnerH / 2, sides: frame.outlineSides, rotationDeg: frame.outlineRotationDeg, cornerRadiusMm: R }, 256)
        : null;
      /** Solido estruso dal contorno della cavita' rientrato di `inset` mm. */
      const sagoma = (inset: number, depth: number) =>
        extrudeOutline(wasm, insetOutline(ptsCavita!, inset), depth);

      const outer = sagomata
        ? sagoma(-frame.solidMm, frH)
        : roundedBox(wasm, backInnerW + 2 * frame.solidMm, backInnerH + 2 * frame.solidMm, frH, R, segs);
      const frontHole = sagomata
        ? sagoma(lip, frH + 2)
        : roundedBox(wasm, frontInnerW, frontInnerH, frH + 2, rFront, segs);
      let frameM = outer.subtract(frontHole);

      const seat = Math.max(0, frame.glassSeatMm ?? 0);
      const seatD = Math.max(0, frame.glassSeatDepthMm ?? 0);
      // Il BORDINO d'appoggio del rilievo e la SEDE del vetro sono due cose distinte:
      // il bordino puo' esistere da solo (ci si incolla sopra il bassorilievo), la sede
      // vetro e' un secondo scasso frontale che si aggiunge quando serve il vetro.
      const lipT0 = Math.max(0.4, frame.lipThickMm ?? 1.6);
      const hasLedge = lip > 0.01 && lipT0 < frH - 0.3;
      const hasGlassSeat = hasLedge && seat > 0.01 && seatD > 0.01 && seatD + lipT0 < frH - 0.3;

      if (hasLedge) {
        // MONTAGGIO REALE (V8.13): il vetro entra dal FRONTE nella sede a L, il
        // bassorilievo entra dal RETRO. Il bordino che sporge verso l'interno fa da
        // appoggio a entrambi, da lati opposti. Quote a partire dal fronte (+z):
        //   sede vetro (seatD) -> bordino (lipT) -> cavita' del rilievo, aperta dietro.
        // La cavita' del rilievo deve restare l'apertura piu' grande e APERTA sul
        // retro: se fosse chiusa da entrambi i lati, un rilievo stampato a parte non
        // potrebbe piu' entrare.
        // V8.16 — BORDINO POSITIVO SUL RETRO.
        // L'apertura e' PASSANTE e larga quanto il rilievo piu' il gioco: il
        // bassorilievo si cala dal FRONTE e la sua faccia posteriore va a battere
        // sulla cornicetta che resta in fondo, dove lo si incolla. Prima il bordino
        // era ricavato scavando, e stava a meta' spessore: il pezzo non entrava.
        // Il bordino sta sempre dal lato OPPOSTO a quello da cui entra il rilievo.
        const dalRetro = frame.reliefLoadFrom === "back";
        const lipT = lipT0;
        const seatDepth = hasGlassSeat ? seatD : 0;
        const cavDepth = Math.max(0.3, frH - lipT - (dalRetro ? seatDepth : 0));
        const cavCenterZ = dalRetro
          ? -frH / 2 + cavDepth / 2 - 0.5   // cavita' aperta sul RETRO, bordino davanti
          : frH / 2 - cavDepth / 2 + 0.5;   // cavita' aperta sul FRONTE, bordino dietro
        const cavity = (sagomata ? sagoma(0, cavDepth + 1.0) : roundedBox(wasm, backInnerW, backInnerH, cavDepth + 1.0, rBack, segs))
          .translate([0, 0, cavCenterZ]);
        frameM = frameM.subtract(cavity);

        if (hasGlassSeat) {
          // Scasso frontale INDIPENDENTE, piu' largo della cavita': il vetro si cala
          // dal davanti e batte sullo spallamento che si forma sul fronte.
          const glassW = Math.min(backInnerW + 2 * frame.solidMm - 0.4, backInnerW + 2 * seat);
          const glassH = Math.min(backInnerH + 2 * frame.solidMm - 0.4, backInnerH + 2 * seat);
          const rGlass = Math.max(0, R - frame.solidMm + seat);
          const glassRecess = (sagomata ? sagoma(-seat, seatD + 1.0) : roundedBox(wasm, glassW, glassH, seatD + 1.0, rGlass, segs))
            .translate([0, 0, frH / 2 - seatD / 2 + 0.5]);
          frameM = frameM.subtract(glassRecess);
        }
      } else if (hasPocket) {
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

      frameM = frameM.translate([0, reliefCenterY, L.frameFrontZ - frH / 2]);
      acc = acc ? acc.add(frameM) : frameM;
    }

    if (!acc) throw new Error("STL: niente da esportare (attiva cornice o passepartout).");

    // Veletta LED: anello positivo sul fronte interno che nasconde la strip.
    if (frame && ledValance?.enabled && ledValance.widthMm > 0 && ledValance.depthMm > 0) {
      const rimW = ledValance.widthMm;
      const rimD = Math.min(ledValance.depthMm, frame.frameHeightMm - 0.5);
      const innerW = framePocketW;
      const innerH = framePocketH;
      const R = Math.max(0, frame.cornerRadiusMm ?? 0);
      const rOut = Math.max(0, R - frame.solidMm);
      const rIn = Math.max(0, R - frame.solidMm - rimW);
      const ledgeOuter = roundedBox(wasm, innerW, innerH, rimD, rOut, FRAME_CORNER_SEGMENTS);
      const ledgeHole = roundedBox(wasm, Math.max(1, innerW - 2 * rimW), Math.max(1, innerH - 2 * rimW), rimD + 2, rIn, FRAME_CORNER_SEGMENTS);
      const ledge = ledgeOuter.subtract(ledgeHole).translate([0, reliefCenterY, L.frameFrontZ - rimD / 2]);
      acc = acc.add(ledge);
    }

    // Canale del vetro a baionetta: alloggiamento sui lati interni della cornice, APERTO IN ALTO.
    // Usa l'apertura FRONTE (la slot vive nel bordo frontale della cornice, sopra il vassoio).
    if (frame && glassSlot?.enabled) {
      const frontW = L.frameApertureW;
      const frontH = L.frameApertureH;
      const grooveDepth = Math.min(Math.max(0.8, glassSlot.grooveDepthMm), Math.max(1, frame.solidMm - 1.0));
      const slotThk = Math.max(1, glassSlot.slotThicknessMm);
      const frontWall = 1.5;
      const boxBottom = reliefCenterY - frontH / 2 - grooveDepth;
      const boxTop = reliefCenterY + frontH / 2 + frame.solidMm + 20;
      const sx = frontW + 2 * grooveDepth;
      const cutter = wasm.Manifold.cube([sx, boxTop - boxBottom, slotThk], true).translate([
        0,
        (boxTop + boxBottom) / 2,
        L.frameFrontZ - frontWall - slotThk / 2,
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
  return { geometry: merged, layout: L };
}

/** Esporta UN STL con rilievo + (passepartout) + (cornice), fuso in un corpo watertight.
 *  Ritorna il conteggio REALE dei triangoli scritti: con la mesh adattiva una stima
 *  basata sulla griglia sarebbe sbagliata di un ordine di grandezza. */
export async function downloadReliefAssemblyStl(args: AssemblyArgs): Promise<{ triangles: number }> {
  const { geometry } = await buildReliefAssemblyGeometry(args);
  const bin = geometryToBinaryStl(geometry);
  downloadArrayBuffer(bin, args.fileName ?? "reliefforge-cornice");
  return { triangles: new DataView(bin).getUint32(80, true) };
}

/**
 * Costruisce lo STL binario del solo rilievo e lo restituisce in memoria.
 * Puro: nessun accesso al DOM, quindi eseguibile in Node (vedi scripts/stl-check.mts).
 * Lancia se la mesh non e' chiusa o contiene vertici non finiti.
 */
export function buildReliefStlBinary(args: DownloadArgs): ArrayBuffer {
  const {
    hm,
    widthMm,
    depthMm,
    baseMm,
    outputMode: _outputMode, // tenuto per compatibilità; non usato ora
    baseStyle,
  } = args;

  if (!hm) throw new Error("STL: missing heightmap (hm)");
  if (!(hm.normF32 instanceof Float32Array)) throw new Error("STL: hm.normF32 missing/invalid");

  const out = buildReliefSolid({ hm, widthMm, depthMm, baseMm, baseStyle, toleranceMm: args.toleranceMm, circularDiameterMm: args.circularDiameterMm, reliefCornerRadiusMm: args.reliefCornerRadiusMm, reliefOutlinePts: args.reliefOutlinePts });
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

  return geometryToBinaryStl(geom);
}

/** Costruisce lo STL del solo rilievo e lo scarica. Wrapper sul builder puro. */
export function downloadReliefStlBinary(args: DownloadArgs): { triangles: number } {
  const bin = buildReliefStlBinary(args);
  downloadArrayBuffer(bin, args.fileName ?? "reliefforge");
  return { triangles: new DataView(bin).getUint32(80, true) };
}
