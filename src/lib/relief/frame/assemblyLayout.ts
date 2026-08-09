// src/lib/relief/frame/assemblyLayout.ts
//
// SORGENTE UNICA delle quote derivate dell'assieme rilievo + passepartout + cornice.
//
// Perche' esiste (V8.5): fino alla 8.4 anteprima ed export calcolavano le stesse
// quote in due punti diversi, con formule che erano divergenti nel caso piu' usato
// (cornice SENZA passepartout, export fuso):
//   * anteprima : apertura = rilievo + 2*gioco          -> cornice piu' GRANDE del rilievo
//   * export    : apertura = rilievo - 2*FRAME_INSET    -> cornice piu' PICCOLA (morde 1mm/lato)
// Risultato: 2 mm di scarto per lato fra cio' che vedevi e cio' che stampavi.
//
// Qui le quote si calcolano UNA volta sola. Anteprima ed export consumano lo stesso
// oggetto, quindi la divergenza non e' piu' rappresentabile.
//
// Convenzione assi (identica al rilievo prodotto da buildSolidFromHeightmap):
//   X = larghezza, Y = altezza (il pezzo sta "in piedi"), Z = profondita', +Z verso chi guarda.

import { passepartoutOuterBandsMm } from "./buildPassepartoutRectPhi";

/** Compenetrazione laterale (mm/lato) fra apertura del passepartout e bordo del rilievo.
 *  E' cio' che rende il passepartout un passepartout: il suo foro e' piu' stretto del
 *  rilievo, quindi ne copre il bordo. Vale sia da saldato sia da pezzi separati. */
export const MAT_OVERLAP = 3.0;

/** Morso (mm/lato) della cornice sul contenuto. Serve SOLO nell'export fuso per dare
 *  materiale in comune alla saldatura booleana. Nei pezzi separati vale 0. */
export const WELD_BITE = 1.0;

/** Penetrazione in Z (mm) del passepartout dentro il retro del rilievo, per saldare. */
export const MAT_Z_WELD = 1.2;

/** Materiale di rilievo (mm) che deve SEMPRE restare davanti al passepartout.
 *  E' il guard-rail contro il difetto "il bassorilievo viene inglobato nel passepartout". */
export const MIN_RELIEF_ABOVE_MAT = 0.8;

export type FrameLayoutCfg = {
  solidMm: number;
  frameHeightMm: number;
  lipMm: number;
  pocketDepthMm: number;
  cornerRadiusMm?: number;
  /** Gioco per lato fra contenuto e apertura cornice (mm). */
  reliefGapMm?: number;
  glassMm?: number;
  glassClearanceMm?: number;
};

export type MatLayoutCfg = {
  steps: 1 | 2 | 3 | 4 | 5 | 6;
  totalBandsMm: number;
  minBandMm: number;
  thicknessMm: number;
  stepDropMm: number;
};

export type AssemblyLayoutInput = {
  /** Impronta X del rilievo (mm). */
  reliefW: number;
  /** Impronta Y del rilievo (mm). */
  reliefH: number;
  /** Estensione Z totale del solido rilievo (base + profondita'), in mm. */
  reliefThicknessMm: number;
  /** Offset Y del rilievo nella scena (l'assieme e' costruito con il rilievo in [offset, offset+H]). */
  reliefYOffset?: number;
  /** Slider "Profondita' rilievo": sposta il rilievo DENTRO la cornice, che resta ferma. */
  reliefZmm: number;
  /** Slider "Profondita' passepartout". */
  matZmm: number;
  frame: FrameLayoutCfg | null;
  mat: MatLayoutCfg | null;
  /** true = pezzi SALDATI in un corpo unico (export fuso e sua anteprima).
   *  false = pezzi separati da stampare a parte (nessun morso, gioco pieno). */
  welded: boolean;
};

export type AssemblyLayout = {
  /** Larghezza totale delle bande del passepartout per lato (mm), dopo clamp phi/minBand. */
  matBandsMm: number;

  /** Impronta del contenuto (rilievo + eventuale passepartout) che la cornice deve abbracciare. */
  contentW: number;
  contentH: number;

  /** Apertura del passepartout (foro). Null se il passepartout e' spento. */
  matInnerW: number | null;
  matInnerH: number | null;
  matOuterW: number | null;
  matOuterH: number | null;

  /** Apertura retro/vassoio della cornice (quella che abbraccia il contenuto). */
  frameBackInnerW: number;
  frameBackInnerH: number;
  /** Apertura VISIBILE davanti (dopo la battuta). */
  frameFrontInnerW: number;
  frameFrontInnerH: number;
  /** Ingombro esterno della cornice. */
  frameOuterW: number;
  frameOuterH: number;

  effectiveLipMm: number;
  effectivePocketDepthMm: number;
  hasPocket: boolean;

  /** Centro Y dell'assieme (cornice e passepartout si centrano qui). */
  centerY: number;

  /** Piani Z del rilievo, GIA' comprensivi di reliefZmm. */
  reliefBackZ: number;
  reliefFrontZ: number;
  /** Piani Z della cornice. La cornice e' ancorata al fronte NOMINALE del rilievo
   *  (reliefZmm = 0): lo slider muove il rilievo dentro una cornice ferma. */
  frameFrontZ: number;
  frameBackZ: number;
  /** Piani Z del passepartout, gia' clampati per non seppellire il rilievo. */
  matFrontZ: number | null;
  matBackZ: number | null;
  /** Penetrazione in Z effettivamente applicata (mm), dopo clamp. */
  matZPenetration: number;

  /** Vetro (rappresentazione + alloggiamento). */
  glassW: number;
  glassH: number;
  glassThkMm: number;
  glassZ: number;
  showGlass: boolean;

  // ---- diagnostica destinata alla UI: sono i numeri che mancavano a schermo ----
  /** Apertura realmente visibile guardando il pezzo di fronte. */
  visibleApertureW: number;
  visibleApertureH: number;
  /** Quanto la cornice copre il rilievo, per lato (mm). Negativo = non lo tocca. */
  reliefCoverPerSideMm: number;
  /** Ingombro esterno finale del pezzo (mm). */
  outerW: number;
  outerH: number;
  outerDepthMm: number;
  /** Anomalie da mostrare all'utente PRIMA di stampare. */
  warnings: string[];
};

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** La battuta e' un elemento funzionale della cornice: si limita ai valori non negativi. */
export function effectiveFrameLipMm(lipMm: number): number {
  return Math.max(0, lipMm);
}

export function computeAssemblyLayout(input: AssemblyLayoutInput): AssemblyLayout {
  const {
    reliefW, reliefH, reliefThicknessMm,
    reliefYOffset = 0,
    reliefZmm, matZmm, frame, mat, welded,
  } = input;

  const warnings: string[] = [];

  const centerY = reliefYOffset + reliefH / 2;
  const halfT = reliefThicknessMm / 2;

  // --- Z del rilievo (comprensivo dello slider) ---
  const reliefBackZ = -halfT + reliefZmm;
  const reliefFrontZ = halfT + reliefZmm;

  // --- Passepartout ---
  const matBandsMm = mat
    ? passepartoutOuterBandsMm({ steps: mat.steps, totalBandsMm: mat.totalBandsMm, minBandMm: mat.minBandMm })
    : 0;

  // Il foro del passepartout e' piu' stretto del rilievo: ne copre il bordo per MAT_OVERLAP.
  const matInnerW = mat ? Math.max(1, reliefW - 2 * MAT_OVERLAP) : null;
  const matInnerH = mat ? Math.max(1, reliefH - 2 * MAT_OVERLAP) : null;
  const matOuterW = mat && matInnerW !== null ? matInnerW + 2 * matBandsMm : null;
  const matOuterH = mat && matInnerH !== null ? matInnerH + 2 * matBandsMm : null;

  // Impronta che la cornice deve abbracciare.
  const contentW = matOuterW ?? reliefW;
  const contentH = matOuterH ?? reliefH;

  // --- Z del passepartout, con guard-rail anti-sepoltura ---
  // Il passepartout e' una lastra DIETRO il rilievo: il suo fronte penetra il retro
  // del rilievo quel tanto che basta a saldare, mai piu'.
  let matFrontZ: number | null = null;
  let matBackZ: number | null = null;
  let matZPenetration = 0;
  if (mat) {
    // Non si puo' penetrare piu' di quanto il rilievo sia spesso, lasciando
    // sempre MIN_RELIEF_ABOVE_MAT di materiale davanti.
    const maxPen = Math.max(0, reliefThicknessMm - MIN_RELIEF_ABOVE_MAT);
    const wantPen = welded ? MAT_Z_WELD : 0;
    matZPenetration = clamp(wantPen, 0, maxPen);
    if (welded && matZPenetration < wantPen) {
      warnings.push(
        `Rilievo troppo sottile (${reliefThicknessMm.toFixed(1)} mm) per saldare il passepartout: ` +
        `penetrazione ridotta a ${matZPenetration.toFixed(1)} mm. Aumenta Base o Profondita'.`
      );
    }

    const plateThk = Math.max(1, mat.thicknessMm);
    // Tetto assoluto: il fronte della lastra non puo' arrivare a filo del rilievo.
    const ceilingZ = reliefFrontZ - MIN_RELIEF_ABOVE_MAT;
    const wantedFrontZ = reliefBackZ + matZPenetration + matZmm;
    matFrontZ = Math.min(wantedFrontZ, ceilingZ);
    if (wantedFrontZ > ceilingZ) {
      warnings.push(
        `"Profondita' passepartout" troppo avanti: il passepartout avrebbe sommerso il rilievo. ` +
        `Bloccato a ${(matFrontZ - reliefBackZ).toFixed(1)} mm dal retro del rilievo.`
      );
    }
    matBackZ = matFrontZ - plateThk;
  }

  // --- Cornice ---
  const gap = Math.max(0, frame?.reliefGapMm ?? 0.3);
  const bite = welded ? WELD_BITE : 0;

  const frameBackInnerW = frame ? Math.max(1, contentW + 2 * gap - 2 * bite) : 0;
  const frameBackInnerH = frame ? Math.max(1, contentH + 2 * gap - 2 * bite) : 0;

  const effectiveLipMm = frame ? effectiveFrameLipMm(frame.lipMm) : 0;
  const effectivePocketDepthMm = frame
    ? clamp(frame.pocketDepthMm, 0, Math.max(0, frame.frameHeightMm - 0.5))
    : 0;
  const hasPocket = !!frame && effectiveLipMm > 0 && effectivePocketDepthMm > 0;

  const frameFrontInnerW = frame
    ? (hasPocket ? Math.max(0.5, frameBackInnerW - 2 * effectiveLipMm) : frameBackInnerW)
    : 0;
  const frameFrontInnerH = frame
    ? (hasPocket ? Math.max(0.5, frameBackInnerH - 2 * effectiveLipMm) : frameBackInnerH)
    : 0;

  const frameOuterW = frame ? frameBackInnerW + 2 * frame.solidMm : 0;
  const frameOuterH = frame ? frameBackInnerH + 2 * frame.solidMm : 0;

  // Cornice ancorata al fronte NOMINALE del rilievo: lo slider "Profondita' rilievo"
  // muove il rilievo DENTRO una cornice che resta ferma (comportamento voluto).
  const frameFrontZ = halfT;
  const frameBackZ = frame ? frameFrontZ - frame.frameHeightMm : frameFrontZ;

  // --- Vetro ---
  const glassThkMm = frame ? Math.max(1, frame.glassMm ?? 2) : 2;
  const glassClearance = frame ? Math.max(0, frame.glassClearanceMm ?? 0) : 0;
  const glassW = Math.max(1, frameBackInnerW - 2 * glassClearance);
  const glassH = Math.max(1, frameBackInnerH - 2 * glassClearance);
  const glassZ = hasPocket
    ? frameFrontZ - effectivePocketDepthMm + glassThkMm / 2
    : frameFrontZ - 0.8 - glassThkMm / 2;
  const showGlass = hasPocket;

  // --- Diagnostica ---
  const visibleApertureW = frame ? frameFrontInnerW : reliefW;
  const visibleApertureH = frame ? frameFrontInnerH : reliefH;
  const reliefCoverPerSideMm = frame ? (reliefW - frameFrontInnerW) / 2 : 0;

  const outerW = frame ? frameOuterW : contentW;
  const outerH = frame ? frameOuterH : contentH;
  const zMin = Math.min(reliefBackZ, matBackZ ?? Infinity, frame ? frameBackZ : Infinity);
  const zMax = Math.max(reliefFrontZ, frame ? frameFrontZ : -Infinity);
  const outerDepthMm = zMax - zMin;

  if (frame && reliefCoverPerSideMm > 0 && !mat) {
    warnings.push(
      `La cornice copre ${reliefCoverPerSideMm.toFixed(1)} mm di rilievo per lato ` +
      `(apertura visibile ${visibleApertureW.toFixed(1)} x ${visibleApertureH.toFixed(1)} mm ` +
      `su un rilievo di ${reliefW.toFixed(1)} x ${reliefH.toFixed(1)} mm). ` +
      `Riduci "Larghezza battuta" per scoprirne di piu'.`
    );
  }
  if (frame && reliefFrontZ > frameFrontZ + 0.01) {
    warnings.push(`Il rilievo sporge di ${(reliefFrontZ - frameFrontZ).toFixed(1)} mm davanti alla cornice.`);
  }
  if (frame && reliefFrontZ < frameBackZ + 0.01) {
    warnings.push(`Il rilievo e' finito dietro la cornice: alza "Profondita' rilievo".`);
  }
  if (frame && frame.frameHeightMm < reliefThicknessMm) {
    warnings.push(
      `Altezza cornice (${frame.frameHeightMm} mm) inferiore allo spessore del rilievo ` +
      `(${reliefThicknessMm.toFixed(1)} mm): il retro del rilievo sporgera'.`
    );
  }

  return {
    matBandsMm,
    contentW, contentH,
    matInnerW, matInnerH, matOuterW, matOuterH,
    frameBackInnerW, frameBackInnerH,
    frameFrontInnerW, frameFrontInnerH,
    frameOuterW, frameOuterH,
    effectiveLipMm, effectivePocketDepthMm, hasPocket,
    centerY,
    reliefBackZ, reliefFrontZ,
    frameFrontZ, frameBackZ,
    matFrontZ, matBackZ, matZPenetration,
    glassW, glassH, glassThkMm, glassZ, showGlass,
    visibleApertureW, visibleApertureH, reliefCoverPerSideMm,
    outerW, outerH, outerDepthMm,
    warnings,
  };
}
