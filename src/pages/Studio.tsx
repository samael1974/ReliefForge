// src/pages/Studio.tsx — Interfaccia desktop "Studio" (M3.2).
// Layout a tutto schermo: barra menu in alto, strumenti a sinistra, viewport 3D
// scuro al centro, parametri a destra + riquadro depth map 2D, status bar in basso.
// Riusa: estimateDepth (Small/Base/Large), post-processing depth (come /depth),
// ReliefPreview3D, downloadReliefStlBinary, encodePng16 (export CNC 16-bit).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon, Mountain, Box as BoxIcon, Frame as FrameIcon,
  Download, RefreshCw, Sun, Cpu, FileDown, Coffee, Megaphone,
  Settings, RotateCcw, Save,
} from "lucide-react";
import ReliefPreview3D, { type HeightmapState } from "@/components/relief/ReliefPreview3D";
import type { AssemblyLayout } from "@/lib/relief/frame/assemblyLayout";
import DepthCurve from "@/components/relief/DepthCurve";
import { IDENTITY_CURVE, applyCurve, buildCurveLut, levelsCurve, type CurvePoint } from "@/lib/relief/transform/toneCurve";
import { downloadReliefStlBinary, downloadReliefAssemblyStl } from "@/components/relief/reliefStl";
import { estimateDepth } from "@/lib/relief/depth/estimateDepth";
import { buildSolidFromHeightmap } from "@/lib/relief/buildSolidFromHeightmap";
import * as THREE from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { PLYExporter } from "three/examples/jsm/exporters/PLYExporter.js";
import { fuseDepthDetail } from "@/lib/relief/depth/fuseDepthDetail";
import { gaussianBlurF32, gammaF32, percentileClipF32 } from "@/lib/relief/transform/tonemap";
import { encodePng16 } from "@/lib/relief/encodePng16";
import { decodeDepthmapPng } from "@/lib/relief/decodeDepthmapPng";
import {
  MESH_PROFILES,
  estimateCompactSolidTriangles,
  formatTriangleCount,
  resampleHeightmapFiltered,
  resampledSize,
  type MeshProfile,
} from "@/lib/relief/heightmapMesh";

type Step = "image" | "depth" | "relief" | "frame" | "export";
type Quality = "small" | "base" | "large";
type Raw = { depth: Float32Array; luma: Float32Array | null; w: number; h: number; device: string };

/** Diagnostica di una depth map importata: serve a spiegare un rilievo piatto prima che sembri un bug. */
type DepthImportInfo = {
  name: string; w: number; h: number; bitDepth: number; lossy: boolean;
  min: number; max: number; resampledTo: string | null;
  /** Perche' si e' ripiegato sul canvas a 8 bit invece del decoder 16 bit. */
  fallback: string | null;
};
type PP = {
  detailMicro: number; detailSigma: number; skinDenoise: number; volumeGamma: number;
  localAmount: number; localSigma: number; contrastPct: number; invert: boolean;
  segment: boolean; segThreshold: number; segFeather: number;
  /** V8.8 — curva tonale sulla depth map. auto = livelli automatici come prima.
   *  I livelli sono il caso della curva con i soli estremi: nessuna perdita. */
  levelsAuto: boolean; curve: CurvePoint[];
};
type CommercialMessage = {
  enabled: boolean;
  title: string;
  body: string;
  cta: string;
  href: string;
};
type ThemeMode = "dark" | "light";
type VisualPreferences = {
  theme: ThemeMode;
  reliefColor: string;
  frameColor: string;
  matColor: string;
};
type DepthPresetId = "ritratto";
type DepthPresetSelection = DepthPresetId | "custom";

const DARK_C = {
  bg: "#15181d", panel: "#171a20", bar: "#1b1f26", barDark: "#0f1216",
  border: "#262b34", border2: "#313844", text: "#e6e8ec", muted: "#9aa1ad",
  hint: "#79808c", accent: "#E26D5C", accentInk: "#2a1209", ok: "#79c9a8", viewport: "#0e1116",
};
const LIGHT_C = {
  bg: "#eef1f4", panel: "#f8f9fb", bar: "#ffffff", barDark: "#eef1f4",
  border: "#d9dde3", border2: "#c6ccd5", text: "#20242a", muted: "#59616d",
  hint: "#7a8491", accent: "#D95F50", accentInk: "#ffffff", ok: "#257a5a", viewport: "#e4e8ed",
};

const MAX = 1024;
const COMMERCIAL_MESSAGE_KEY = "reliefforge.commercialMessage.v1";
const VISUAL_PREFERENCES_KEY = "reliefforge.visualPreferences.v1";
const DEFAULT_VISUAL_PREFERENCES: VisualPreferences = {
  theme: "dark",
  reliefColor: "#78B987",
  frameColor: "#2B2B2B",
  matColor: "#E9E3D6",
};

/**
 * Preset di lavoro. V8.5: i quattro preset storici (V8.1/V8.3) erano tarati su una
 * pipeline che non esiste piu' e non producevano risultati utili; sostituiti da UN
 * preset ricavato da una lavorazione reale riuscita.
 *
 * A differenza di prima il preset copre ENTRAMBI i pannelli: ripristinare solo la
 * Profondita' e lasciare fuori profondita'/base/larghezza rendeva il preset inutile,
 * perche' la resa dipende dalla combinazione dei due.
 *
 * Nuovi preset si aggiungono solo dopo aver verificato i valori su un soggetto vero.
 */
type PresetRelief = {
  depthMm: number; baseMm: number; widthMm: number;
  decimate: number; meshProfile: MeshProfile; adaptiveMesh: boolean;
};

const DEPTH_PRESETS: Record<DepthPresetId, { label: string; hint: string; values: PP; relief: PresetRelief }> = {
  ritratto: {
    label: "Ritratto",
    hint: "Volto su fondo scuro: soggetto isolato, sfondo piatto, lineamenti leggibili. Tarato su una lavorazione reale.",
    values: {
      detailMicro: 0.15, detailSigma: 1.1, skinDenoise: 3, volumeGamma: 0.75,
      localAmount: 0, localSigma: 3, contrastPct: 0, invert: false,
      segment: true, segThreshold: 0.1, segFeather: 0,
      levelsAuto: true, curve: IDENTITY_CURVE,
    },
    relief: { depthMm: 8, baseMm: 2, widthMm: 130, decimate: 1, meshProfile: "maximum", adaptiveMesh: true },
  },
};

const DEFAULT_COMMERCIAL_MESSAGE: CommercialMessage = {
  enabled: true,
  title: "Sostieni ReliefForge",
  body: "Versione gratuita in sviluppo continuo.",
  cta: "Offri un caffe per lo sviluppo",
  href: "https://www.paypal.me/federicocordioli72",
};

function loadCommercialMessage(): CommercialMessage {
  try {
    const raw = window.localStorage.getItem(COMMERCIAL_MESSAGE_KEY);
    if (!raw) return DEFAULT_COMMERCIAL_MESSAGE;
    return { ...DEFAULT_COMMERCIAL_MESSAGE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_COMMERCIAL_MESSAGE;
  }
}

function saveCommercialMessage(next: CommercialMessage) {
  window.localStorage.setItem(COMMERCIAL_MESSAGE_KEY, JSON.stringify(next));
}

function loadVisualPreferences(): VisualPreferences {
  try {
    const raw = window.localStorage.getItem(VISUAL_PREFERENCES_KEY);
    return raw ? { ...DEFAULT_VISUAL_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_VISUAL_PREFERENCES;
  } catch {
    return DEFAULT_VISUAL_PREFERENCES;
  }
}

function saveVisualPreferences(next: VisualPreferences) {
  window.localStorage.setItem(VISUAL_PREFERENCES_KEY, JSON.stringify(next));
}

function lumaFromImageData(id: ImageData): Float32Array {
  const d = id.data, out = new Float32Array(id.width * id.height);
  for (let i = 0, j = 0; j < out.length; j++, i += 4)
    out[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return out;
}

function dl(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

/** Maschera del soggetto dal solo depth. null quando la segmentazione e' spenta. */
function buildSegmentMask(d: Float32Array, w: number, h: number, p: PP): Float32Array | null {
  if (!p.segment) return null;
  const n = w * h;
  let mask = new Float32Array(n);
  for (let i = 0; i < n; i++) mask[i] = d[i] > p.segThreshold ? 1 : 0;
  if (p.segFeather > 0) mask = gaussianBlurF32(mask, w, h, p.segFeather);
  return mask;
}

/** Livelli automatici: min/max del soggetto (o nessun rimappaggio senza segmentazione).
 *  E' esattamente cio' che faceva la 8.5, qui reso esplicito e mostrabile in UI. */
function autoLevels(d: Float32Array, mask: Float32Array | null, p: PP): { lo: number; hi: number } {
  if (!p.segment || !mask) return { lo: 0, hi: 1 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < d.length; i++) if (mask[i] > 0.5) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!isFinite(lo) || !isFinite(hi) || hi - lo < 1e-6) return { lo: 0, hi: 1 };
  return { lo, hi };
}

/** Depth denoised + istogramma + livelli automatici, per il pannello dei livelli. */
export function depthLevelsStats(raw: Raw, p: PP, bins = 128) {
  const { w, h } = raw;
  const d = p.skinDenoise > 0 ? gaussianBlurF32(raw.depth, w, h, p.skinDenoise) : raw.depth;
  const histogram = new Uint32Array(bins);
  for (let i = 0; i < d.length; i++) {
    const b = Math.min(bins - 1, Math.max(0, (d[i] * bins) | 0));
    histogram[b]++;
  }
  const mask = buildSegmentMask(d, w, h, p);
  return { histogram, ...autoLevels(d, mask, p) };
}

function processHeightmap(raw: Raw, p: PP): Float32Array {
  const { w, h } = raw;
  const n = w * h;
  let d = p.skinDenoise > 0 ? gaussianBlurF32(raw.depth, w, h, p.skinDenoise) : raw.depth.slice();

  // Segmentazione dal solo depth: lo sfondo (lontano = valori bassi) sotto soglia
  // viene appiattito a 0.
  const mask = buildSegmentMask(d, w, h, p);

  // V8.6 — LIVELLI. Fino alla 8.5 la segmentazione ri-stendeva il soggetto su 0..1
  // con min/max automatici e non c'era modo di intervenire. Ora quel calcolo e' il
  // caso "auto" di un controllo esplicito: trascinando i punti sull'istogramma si
  // sceglie quale profondita' diventa il fondo e quale la cima.
  // In automatico si applica la stessa curva a due punti dei livelli automatici,
  // cioe' esattamente il comportamento delle versioni precedenti.
  const auto = autoLevels(d, mask, p);
  const curve = p.levelsAuto ? levelsCurve(auto.lo, auto.hi) : p.curve;
  const isIdentity = curve.length === 2 && curve[0].x === 0 && curve[0].y === 0 && curve[1].x === 1 && curve[1].y === 1;
  if (mask || !isIdentity) {
    d = applyCurve(d, buildCurveLut(curve));
    if (mask) for (let i = 0; i < n; i++) d[i] *= mask[i];
  }

  if (p.localAmount > 0) {
    const low = gaussianBlurF32(d, w, h, p.localSigma);
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = d[i] + p.localAmount * (d[i] - low[i]);
    d = o;
  }
  // Senza immagine di colore (depth map importata) non c'e' luma da cui estrarre il
  // micro-dettaglio: la fusione va saltata, non chiamata a vuoto.
  let f = raw.luma
    ? fuseDepthDetail(d, raw.luma, w, h, { detailAmount: p.detailMicro, detailSigma: p.detailSigma, renormalize: false })
    : d;
  f = gammaF32(f, p.volumeGamma);
  f = percentileClipF32(f, p.contrastPct / 100);
  if (p.invert) { for (let i = 0; i < f.length; i++) f[i] = 1 - f[i]; }
  if (mask) { for (let i = 0; i < n; i++) f[i] *= mask[i]; } // mantieni lo sfondo piatto
  return f;
}

function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  suffix?: string; strong?: boolean; onChange: (v: number) => void;
}) {
  const { label, value, min, max, step, suffix, strong, onChange } = props;
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState("");
  const clamp = (v: number) => (v < min ? min : v > max ? max : v);
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 5, color: strong ? "var(--rf-text)" : "var(--rf-muted)" }}>
        <span>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number" min={min} max={max} step="any"
            value={editing ? txt : value}
            onFocus={() => { setEditing(true); setTxt(String(value)); }}
            onChange={(e) => { setTxt(e.target.value); const v = parseFloat(e.target.value); if (isFinite(v)) onChange(clamp(v)); }}
            onBlur={() => setEditing(false)}
            style={{ width: 56, textAlign: "right", background: "var(--rf-bar-dark)", color: "var(--rf-text)", border: "1px solid var(--rf-border-2)", borderRadius: 5, padding: "2px 5px", fontSize: 12 }}
          />
          {suffix ? <span style={{ color: "var(--rf-muted)", fontSize: 11, minWidth: 16 }}>{suffix.trim()}</span> : null}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)} style={{ width: "100%", accentColor: "var(--rf-accent)" }} />
    </div>
  );
}

export default function Studio() {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rawRef = useRef<Raw | null>(null);
  const dmCanvas = useRef<HTMLCanvasElement | null>(null);

  const [hmState, setHmState] = useState<HeightmapState | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Apri un'immagine per iniziare.");
  const [device, setDevice] = useState("");
  const [imgDataUrl, setImgDataUrl] = useState<string | null>(null); // foto originale (per salvare il progetto)
  const [fileMenu, setFileMenu] = useState(false);
  const [preferencesMenu, setPreferencesMenu] = useState(false);
  const [visualPreferences, setVisualPreferences] = useState<VisualPreferences>(() => loadVisualPreferences());
  const [commercialEditorOpen, setCommercialEditorOpen] = useState(false);
  const [commercialMessage, setCommercialMessage] = useState<CommercialMessage>(() => loadCommercialMessage());
  const [commercialDraft, setCommercialDraft] = useState<CommercialMessage>(() => loadCommercialMessage());
  const projRef = useRef<HTMLInputElement | null>(null);
  const depthFileRef = useRef<HTMLInputElement | null>(null);
  const [depthImport, setDepthImport] = useState<DepthImportInfo | null>(null);
  const [depthError, setDepthError] = useState<string | null>(null);
  // Passthrough: una depth map gia' elaborata a monte non va rielaborata di default.
  const [depthRawMode, setDepthRawMode] = useState(true);
  const [wire, setWire] = useState(false); // modalità wireframe del viewport
  // V8.5: l'anteprima mostra ESATTAMENTE uno dei due export. Fuso = pezzo unico
  // saldato; Separati = cornice e rilievo da stampare a parte, con il gioco vero.
  const [previewWelded, setPreviewWelded] = useState(true);
  // V8.5: mesher adattivo per l'export (triangoli dove serve). Spegnilo per tornare
  // alla griglia uniforme della 8.4.
  const [adaptiveMesh, setAdaptiveMesh] = useState(DEPTH_PRESETS.ritratto.relief.adaptiveMesh);
  // V8.5: resa del viewport. "gesso" e' la condizione in cui si giudica davvero
  // un bassorilievo; "studio" serve a presentarlo.
  const [renderStyle, setRenderStyle] = useState<"gesso" | "studio" | "matcap">("matcap");
  const [keyLightDeg, setKeyLightDeg] = useState(35);
  const [layout, setLayout] = useState<AssemblyLayout | null>(null);

  const C = visualPreferences.theme === "dark" ? DARK_C : LIGHT_C;
  const previewColors = useMemo(() => ({
    relief: visualPreferences.reliefColor,
    frame: visualPreferences.frameColor,
    mat: visualPreferences.matColor,
  }), [visualPreferences.reliefColor, visualPreferences.frameColor, visualPreferences.matColor]);

  useEffect(() => {
    saveVisualPreferences(visualPreferences);
  }, [visualPreferences]);

  const updateVisualPreference = <K extends keyof VisualPreferences>(key: K, value: VisualPreferences[K]) => {
    setVisualPreferences((current) => ({ ...current, [key]: value }));
  };

  const resetVisualPreferences = () => {
    setVisualPreferences(DEFAULT_VISUAL_PREFERENCES);
    setStatus("Preferenze grafiche ripristinate.");
  };

  const [step, setStep] = useState<Step>("image");
  const [quality, setQuality] = useState<Quality>("large");
  const [activeDepthPreset, setActiveDepthPreset] = useState<DepthPresetSelection>("ritratto");

  const [pp, setPp] = useState<PP>({ ...DEPTH_PRESETS.ritratto.values });
  const setP = (k: keyof PP, v: number | boolean) => {
    setActiveDepthPreset("custom");
    setPp((s) => ({ ...s, [k]: v }));
  };
  const applyDepthPreset = (id: DepthPresetId) => {
    const preset = DEPTH_PRESETS[id];
    setActiveDepthPreset(id);
    setPp({ ...preset.values });
    // Il preset copre anche il pannello Rilievo: e' la combinazione dei due a fare la resa.
    setDepthMm(preset.relief.depthMm);
    setBaseMm(preset.relief.baseMm);
    setWidthMm(preset.relief.widthMm);
    setDecimate(preset.relief.decimate);
    setMeshProfile(preset.relief.meshProfile);
    setAdaptiveMesh(preset.relief.adaptiveMesh);
    setStatus(`Preset ${preset.label} applicato (profondità e rilievo).`);
  };

  // Stato iniziale = preset "Ritratto": all'avvio l'app parte gia' dai valori validati,
  // non da default arbitrari diversi da qualunque preset.
  const [depthMm, setDepthMm] = useState(DEPTH_PRESETS.ritratto.relief.depthMm);
  const [baseMm, setBaseMm] = useState(DEPTH_PRESETS.ritratto.relief.baseMm);
  const [widthMm, setWidthMm] = useState(DEPTH_PRESETS.ritratto.relief.widthMm);
  const [decimate, setDecimate] = useState(DEPTH_PRESETS.ritratto.relief.decimate);
  const [meshProfile, setMeshProfile] = useState<MeshProfile>(DEPTH_PRESETS.ritratto.relief.meshProfile);

  // Cornice / passepartout / vetro (geometria riusata dal generatore classico)
  const [frameOn, setFrameOn] = useState(false);
  const [matOn, setMatOn] = useState(false);
  const [glassOn, setGlassOn] = useState(false);
  const [frameP, setFrameP] = useState({ solidMm: 5, frameHeightMm: 21, glassMm: 2 as 2 | 3, glassClearanceMm: 0.25, pocketDepthMm: 3.6, lipMm: 3.0, pocketRadialMm: 3.0, cornerRadiusMm: 0, reliefGapMm: 0.3 });
  const [matP, setMatP] = useState({ steps: 1 as 1 | 2 | 3 | 4 | 5 | 6, totalBandsMm: 10, minBandMm: 6, thicknessMm: 2, stepDropMm: 2, matDropMm: 2.5, reliefGapMm: 0.35 });
  const [glassP, setGlassP] = useState({ lipWmm: 3, lipThkmm: 3 });
  const [rimOn, setRimOn] = useState(false);  // veletta LED positiva sul fronte
  const [rimW, setRimW] = useState(3);         // sporgenza interna veletta (mm)
  const [rimD, setRimD] = useState(2);         // profondita veletta (mm)
  const setFP = (k: string, v: number) => setFrameP((s) => ({ ...s, [k]: v }));
  const setMP = (k: string, v: number) => setMatP((s) => ({ ...s, [k]: v }));
  const setGP = (k: string, v: number) => setGlassP((s) => ({ ...s, [k]: v }));
  const [reliefZ, setReliefZ] = useState(0); // profondità rilievo dentro la cornice (mm)
  const [matZ, setMatZ] = useState(0);       // profondità passepartout (mm)
  const [frameAdvanced, setFrameAdvanced] = useState(false); // mostra controlli cornice avanzati
  const glassSeatOn = frameP.lipMm > 0 && frameP.pocketDepthMm > 0;
  const setGlassSeatOn = (enabled: boolean) => {
    if (enabled) setGlassOn(false);
    setFrameP((s) => enabled
      ? {
          ...s,
          lipMm: s.lipMm > 0 ? s.lipMm : 3,
          pocketDepthMm: s.pocketDepthMm > 0 ? s.pocketDepthMm : Math.max(3.6, s.glassMm + 0.5),
        }
      : { ...s, lipMm: 0, pocketDepthMm: 0 });
  };
  const commercialHref = commercialMessage.href.trim();
  const previewFrame = useMemo(() => ({ enabled: frameOn, ...frameP }), [frameOn, frameP]);
  const previewMat = useMemo(() => ({ enabled: matOn, ...matP }), [matOn, matP]);
  const previewGlassSlot = useMemo(() => ({ enabled: glassOn, grooveDepthMm: glassP.lipWmm, slotThicknessMm: glassP.lipThkmm }), [glassOn, glassP]);
  const previewLedValance = useMemo(() => ({ enabled: rimOn, widthMm: rimW, depthMm: rimD }), [rimOn, rimW, rimD]);
  const handlePreviewError = useCallback((message: string) => setStatus(message), []);

  const openCommercialEditor = useCallback(() => {
    setCommercialDraft(commercialMessage);
    setCommercialEditorOpen(true);
  }, [commercialMessage]);

  const applyCommercialDraft = useCallback(() => {
    const next = {
      ...commercialDraft,
      title: commercialDraft.title.trim() || DEFAULT_COMMERCIAL_MESSAGE.title,
      body: commercialDraft.body.trim(),
      cta: commercialDraft.cta.trim() || DEFAULT_COMMERCIAL_MESSAGE.cta,
      href: commercialDraft.href.trim(),
    };
    setCommercialMessage(next);
    saveCommercialMessage(next);
    setCommercialEditorOpen(false);
    setStatus("Messaggio commerciale aggiornato.");
  }, [commercialDraft]);

  const resetCommercialDraft = useCallback(() => {
    setCommercialDraft(DEFAULT_COMMERCIAL_MESSAGE);
  }, []);

  const drawDepth = useCallback((f: Float32Array, w: number, h: number) => {
    const c = dmCanvas.current; if (!c) return;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < f.length; i++, j += 4) {
      const v = Math.round(Math.max(0, Math.min(1, f[i])) * 255);
      img.data[j] = img.data[j + 1] = img.data[j + 2] = v; img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  // FIX V8.4: al primo render il canvas non esiste ancora quando drawDepth viene
  // chiamata da reprocess (hmState passa da null a valorizzato nello stesso tick).
  // Questo effetto ridisegna la depth map appena il canvas è montato.
  useEffect(() => {
    if (hmState) drawDepth(hmState.normF32, hmState.w, hmState.h);
  }, [hmState, drawDepth]);

  const reprocess = useCallback(() => {
    const raw = rawRef.current;
    if (!raw) return;
    // Depth map importata in passthrough: nessun filtro, nessuna normalizzazione.
    const f = raw.luma === null && depthRawMode ? raw.depth.slice() : processHeightmap(raw, pp);
    setHmState({ normF32: f, w: raw.w, h: raw.h });
    drawDepth(f, raw.w, raw.h);
  }, [pp, drawDepth, depthRawMode]);

  useEffect(() => {
    const timer = window.setTimeout(reprocess, 140);
    return () => window.clearTimeout(timer);
  }, [reprocess]);

  const runDepth = useCallback(async (q: Quality) => {
    if (!imgRef.current) { setStatus("Carica prima un'immagine."); return; }
    setBusy(true); setStatus("Stima profondità (primo uso del modello: download)…");
    try {
      const img = imgRef.current;
      const sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(2, Math.round(img.naturalWidth * sc));
      const h = Math.max(2, Math.round(img.naturalHeight * sc));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      const dep = await estimateDepth(id, { model: q, onProgress: (p) => setStatus("Modello: " + p.status) });
      const lc = document.createElement("canvas"); lc.width = dep.w; lc.height = dep.h;
      lc.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0, dep.w, dep.h);
      const luma = lumaFromImageData(lc.getContext("2d")!.getImageData(0, 0, dep.w, dep.h));
      const raw = { depth: dep.normF32, luma, w: dep.w, h: dep.h, device: dep.device };
      rawRef.current = raw;
      setDevice(dep.device);
      const processed = processHeightmap(raw, pp);
      setHmState({ normF32: processed, w: dep.w, h: dep.h });
      drawDepth(processed, dep.w, dep.h);
      setStatus(`Pronto (${dep.device}). ${dep.w}×${dep.h}`);
      setStep("relief");
    } catch (e: any) {
      setStatus("Errore: " + (e?.message ?? String(e)));
    } finally { setBusy(false); }
  }, [drawDepth, pp]);

  /** Importa una depth map gia' pronta: nessuna stima AI, nessuna immagine di colore. */
  const onDepthFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setDepthError(null); setStatus("Lettura depth map: " + file.name);
    console.log("[DEPTH IMPORT] file:", file.name, file.type, file.size, "byte");
    try {
      const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
      let normF32: Float32Array, w: number, h: number, bitDepth = 8;
      let precise = false;          // true = letto davvero a 16 bit dal decoder proprio
      let fallback: string | null = null;

      if (isPng) {
        // Decoder proprio: legge davvero i 16 bit, senza passare da un canvas a 8 bit.
        // Non copre pero' i PNG interlacciati ne' quelli a palette (colorType 3).
        try {
          const dec = decodeDepthmapPng(new Uint8Array(await file.arrayBuffer()));
          normF32 = dec.normF32; w = dec.w; h = dec.h; bitDepth = dec.bitDepth ?? 8;
          precise = true;
        } catch (e: any) {
          fallback = e?.message ?? String(e);
          console.warn("[DEPTH IMPORT] decoder 16 bit non applicabile, ripiego sul canvas:", fallback);
        }
      }

      if (!precise) {
        // Ripiego: qualunque cosa sappia decodificare Chromium, ma a 8 bit per canale.
        const bmp = await createImageBitmap(file);
        w = bmp.width; h = bmp.height; bitDepth = 8;
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0); bmp.close();
        normF32 = lumaFromImageData(ctx.getImageData(0, 0, w, h));
      }

      // Riscalatura con lo stesso filtro di anteprima ed export (low-pass + bilineare).
      let resampledTo: string | null = null;
      if (w * h > MAX * MAX) {
        const r = resampleHeightmapFiltered({ normF32, w, h }, MAX * MAX);
        resampledTo = r.w + "×" + r.h;
        normF32 = r.normF32; w = r.w; h = r.h;
      }

      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < normF32.length; i++) { const v = normF32[i]; if (v < lo) lo = v; if (v > hi) hi = v; }

      rawRef.current = { depth: normF32, luma: null, w, h, device: "import" };
      setDepthImport({ name: file.name, w, h, bitDepth, lossy: !precise, min: lo, max: hi, resampledTo, fallback });
      setDepthRawMode(true);
      setHmState({ normF32, w, h });
      drawDepth(normF32, w, h);
      setStep("relief");
      console.log("[DEPTH IMPORT] ok:", w, "x", h, bitDepth, "bit, range", lo, hi);
      setStatus("Depth map importata: " + w + "×" + h + ", " + bitDepth + " bit.");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error("[DEPTH IMPORT] fallito:", err);
      setDepthError(msg);
      setStatus("Errore depth map: " + msg);
    } finally { setBusy(false); }
  }, [drawDepth]);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setImgDataUrl(url);
      const img = new Image();
      img.onload = () => { imgRef.current = img; runDepth(quality); };
      img.src = url;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [quality, runDepth]);

  // --- Salva / Apri progetto (.rforge = JSON con tutti i parametri + immagine in base64) ---
  const saveProject = useCallback(() => {
    if (!imgDataUrl) { setStatus("Apri prima un'immagine."); return; }
    const proj = {
      app: "ReliefForge", appVersion: __APP_VERSION__, fileVersion: 2, savedAt: new Date().toISOString(),
      image: imgDataUrl, quality, pp, depthPreset: activeDepthPreset,
      relief: { depthMm, baseMm, widthMm, decimate, meshProfile },
      appearance: visualPreferences,
      frame: { frameOn, matOn, glassOn, frameP, matP, glassP, reliefZ, matZ, rimOn, rimW, rimD },
    };
    dl(new Blob([JSON.stringify(proj)], { type: "application/json" }), "progetto.rforge");
    setStatus("Progetto salvato (.rforge).");
  }, [imgDataUrl, quality, pp, activeDepthPreset, depthMm, baseMm, widthMm, decimate, meshProfile, visualPreferences, frameOn, matOn, glassOn, frameP, matP, glassP, reliefZ, matZ, rimOn, rimW, rimD]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveProject();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveProject]);

  const onOpenProject = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(reader.result as string);
        if (p.quality) setQuality(p.quality);
        if (p.depthPreset && p.depthPreset in DEPTH_PRESETS) setActiveDepthPreset(p.depthPreset);
        if (p.pp) setPp({ ...DEPTH_PRESETS.ritratto.values, ...p.pp });
        if (p.appearance) setVisualPreferences({ ...DEFAULT_VISUAL_PREFERENCES, ...p.appearance });
        if (p.relief) {
          setDepthMm(p.relief.depthMm ?? 5);
          setBaseMm(p.relief.baseMm ?? 2);
          setWidthMm(p.relief.widthMm ?? 100);
          setDecimate(p.relief.decimate ?? 1);
          if (p.relief.meshProfile in MESH_PROFILES) setMeshProfile(p.relief.meshProfile);
        }
        if (p.frame) {
          setFrameOn(!!p.frame.frameOn); setMatOn(!!p.frame.matOn); setGlassOn(!!p.frame.glassOn);
          if (p.frame.frameP) setFrameP((s) => ({ ...s, ...p.frame.frameP })); // merge: i progetti vecchi non hanno i campi nuovi (es. reliefGapMm)
          if (p.frame.matP) setMatP(p.frame.matP);
          if (p.frame.glassP) setGlassP(p.frame.glassP);
          setRimOn(!!p.frame.rimOn); setRimW(p.frame.rimW ?? 3); setRimD(p.frame.rimD ?? 2);
          setReliefZ(p.frame.reliefZ ?? 0); setMatZ(p.frame.matZ ?? 0);
        }
        if (p.image) {
          setImgDataUrl(p.image);
          const img = new Image();
          img.onload = () => { imgRef.current = img; runDepth(p.quality ?? "base"); };
          img.src = p.image;
        }
        setStatus("Progetto aperto.");
      } catch { setStatus("File .rforge non valido."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [runDepth]);

  const meshPlan = useMemo(() => {
    if (!hmState) return null;
    const profile = MESH_PROFILES[meshProfile];
    const manualFactor = Math.max(1, Math.floor(decimate || 1));
    const previewBudget = Math.max(4, Math.floor(profile.previewCells / (manualFactor * manualFactor)));
    const exportBudget = Math.max(4, Math.floor(profile.exportCells / (manualFactor * manualFactor)));
    const preview = resampledSize(hmState.w, hmState.h, previewBudget);
    const exported = resampledSize(hmState.w, hmState.h, exportBudget);
    return {
      previewBudget,
      exportBudget,
      preview,
      exported,
      previewTriangles: estimateCompactSolidTriangles(preview.w, preview.h),
      exportTriangles: estimateCompactSolidTriangles(exported.w, exported.h),
    };
  }, [hmState, meshProfile, decimate]);

  // Istogramma + livelli automatici. Dipende solo da denoise e segmentazione:
  // trascinare i punti NON lo ricalcola, cosi' la distribuzione resta ferma sotto
  // le maniglie mentre le muovi.
  const levelsStats = useMemo(() => {
    const raw = rawRef.current;
    if (!raw) return null;
    return depthLevelsStats(raw, pp);
  }, [imgDataUrl, quality, pp.skinDenoise, pp.segment, pp.segThreshold, pp.segFeather]);

  const prepareExportHeightmap = useCallback(() => {
    if (!hmState) return null;
    const profile = MESH_PROFILES[meshProfile];
    const factor = Math.max(1, Math.floor(decimate || 1));
    // Con il mesher adattivo la heightmap va passata a piena risoluzione: la densita'
    // dei triangoli la decide la tolleranza geometrica, non un pre-ricampionamento.
    if (adaptiveMesh && factor === 1) return hmState;
    return resampleHeightmapFiltered(hmState, Math.max(4, Math.floor(profile.exportCells / (factor * factor))));
  }, [hmState, meshProfile, decimate, adaptiveMesh]);

  /** Tolleranza geometrica da passare all'export (0 = griglia uniforme). */
  const exportToleranceMm = adaptiveMesh ? MESH_PROFILES[meshProfile].toleranceMm : 0;

  const exportStl = useCallback(() => {
    if (!hmState) { setStatus("Genera prima il rilievo."); return; }
    try {
      const hm = prepareExportHeightmap();
      if (!hm) return;
      const { triangles } = downloadReliefStlBinary({
        hm, widthMm, depthMm, baseMm, toleranceMm: exportToleranceMm,
        outputMode: "relief" as any, baseStyle: "flat" as any, fileName: "reliefforge",
      });
      // Conteggio REALE: con la mesh adattiva la stima sulla griglia sbagliava di
      // un ordine di grandezza (dichiarava 1,4 M su un file da ~40k).
      setStatus(`STL esportato: ${hm.w}×${hm.h}, ${formatTriangleCount(triangles)} triangoli (${((84 + triangles * 50) / 1048576).toFixed(1)} MB).`);
    } catch (e: any) { setStatus("Errore export STL: " + (e?.message ?? String(e))); }
  }, [hmState, widthMm, depthMm, baseMm, prepareExportHeightmap]);

  const exportAssembly = useCallback(async () => {
    if (!hmState) { setStatus("Genera prima il rilievo."); return; }
    if (!frameOn && !matOn) { setStatus("Attiva Cornice o Passepartout per l'export fuso."); return; }
    setStatus("Fusione 3D (cornice + rilievo) in corso…");
    try {
      const hm = prepareExportHeightmap();
      if (!hm) return;
      const res = await downloadReliefAssemblyStl({
        hm, widthMm, depthMm, baseMm, outputMode: "relief" as any, baseStyle: "flat" as any,
        toleranceMm: exportToleranceMm,
        fileName: "reliefforge-cornice", reliefZmm: reliefZ, matZmm: matZ,
        glassSlot: glassOn ? { enabled: true, grooveDepthMm: glassP.lipWmm, slotThicknessMm: glassP.lipThkmm } : null,
        ledValance: rimOn ? { enabled: true, widthMm: rimW, depthMm: rimD } : null,
        mat: matOn ? { steps: matP.steps, totalBandsMm: matP.totalBandsMm, minBandMm: matP.minBandMm, thicknessMm: matP.thicknessMm, stepDropMm: matP.stepDropMm } : null,
        frame: frameOn ? { solidMm: frameP.solidMm, frameHeightMm: frameP.frameHeightMm, glassMm: frameP.glassMm, glassClearanceMm: frameP.glassClearanceMm, lipMm: frameP.lipMm, pocketDepthMm: frameP.pocketDepthMm, cornerRadiusMm: frameP.cornerRadiusMm, reliefGapMm: frameP.reliefGapMm } : null,
      } as any);
      setStatus(`STL cornice+rilievo (fuso): ${formatTriangleCount(res.triangles)} triangoli (${((84 + res.triangles * 50) / 1048576).toFixed(1)} MB).`);
    } catch (e: any) { setStatus("Errore export fuso: " + (e?.message ?? String(e))); }
  }, [hmState, frameOn, matOn, glassOn, frameP, matP, glassP, widthMm, depthMm, baseMm, prepareExportHeightmap, reliefZ, matZ, rimOn, rimW, rimD]);

  const exportFrameOnly = useCallback(async () => {
    if (!frameOn && !matOn) { setStatus("Attiva Cornice o Passepartout."); return; }
    if (!hmState) { setStatus("Genera prima il rilievo (serve per le proporzioni)."); return; }
    setStatus("Genero la sola cornice…");
    try {
      const hm = prepareExportHeightmap();
      if (!hm) return;
      await downloadReliefAssemblyStl({
        hm, widthMm, depthMm, baseMm, outputMode: "relief" as any, baseStyle: "flat" as any,
        toleranceMm: exportToleranceMm,
        fileName: "reliefforge-cornice-sola", reliefZmm: reliefZ, matZmm: matZ, frameOnly: true,
        glassSlot: glassOn ? { enabled: true, grooveDepthMm: glassP.lipWmm, slotThicknessMm: glassP.lipThkmm } : null,
        ledValance: rimOn ? { enabled: true, widthMm: rimW, depthMm: rimD } : null,
        mat: matOn ? { steps: matP.steps, totalBandsMm: matP.totalBandsMm, minBandMm: matP.minBandMm, thicknessMm: matP.thicknessMm, stepDropMm: matP.stepDropMm } : null,
        frame: frameOn ? { solidMm: frameP.solidMm, frameHeightMm: frameP.frameHeightMm, glassMm: frameP.glassMm, glassClearanceMm: frameP.glassClearanceMm, lipMm: frameP.lipMm, pocketDepthMm: frameP.pocketDepthMm, cornerRadiusMm: frameP.cornerRadiusMm, reliefGapMm: frameP.reliefGapMm } : null,
      } as any);
      setStatus("STL solo cornice esportato (stampa separata).");
    } catch (e: any) { setStatus("Errore export cornice: " + (e?.message ?? String(e))); }
  }, [hmState, frameOn, matOn, glassOn, frameP, matP, glassP, widthMm, depthMm, baseMm, prepareExportHeightmap, reliefZ, matZ, rimOn, rimW, rimD]);

  // V8.4: terza modalità — rilievo + passepartout fusi, SENZA cornice
  // (la cornice si stampa a parte con "Solo cornice" e il gioco regolabile).
  const exportReliefMat = useCallback(async () => {
    if (!hmState) { setStatus("Genera prima il rilievo."); return; }
    if (!matOn) { setStatus("Attiva il Passepartout per questo export."); return; }
    setStatus("Fusione rilievo + passepartout in corso…");
    try {
      const hm = prepareExportHeightmap();
      if (!hm) return;
      await downloadReliefAssemblyStl({
        hm, widthMm, depthMm, baseMm, outputMode: "relief" as any, baseStyle: "flat" as any,
        fileName: "reliefforge-rilievo-passepartout", reliefZmm: reliefZ, matZmm: matZ,
        glassSlot: null, ledValance: null,
        mat: { steps: matP.steps, totalBandsMm: matP.totalBandsMm, minBandMm: matP.minBandMm, thicknessMm: matP.thicknessMm, stepDropMm: matP.stepDropMm },
        frame: null,
      } as any);
      setStatus("STL rilievo+passepartout (fuso) esportato.");
    } catch (e: any) { setStatus("Errore export rilievo+passepartout: " + (e?.message ?? String(e))); }
  }, [hmState, matOn, matP, widthMm, depthMm, baseMm, prepareExportHeightmap, reliefZ, matZ]);

  const buildExportGeometry = useCallback(() => {
    if (!hmState) return null;
    const hm = prepareExportHeightmap();
    if (!hm) return null;
    const { geometry } = buildSolidFromHeightmap({
      height01: hm.normF32, width: hm.w, height: hm.h,
      outWidthMm: Math.max(1, widthMm), depthMm: Math.max(0, depthMm), baseMm: Math.max(0, baseMm),
      baseStyle: "flat" as any, invert: false, clampHeights: true, minBaseMm: 0.4,
    } as any);
    return geometry as any;
  }, [hmState, prepareExportHeightmap, widthMm, depthMm, baseMm]);

  const exportMesh = useCallback((fmt: "obj" | "ply") => {
    if (!hmState) { setStatus("Genera prima il rilievo."); return; }
    try {
      const geo = buildExportGeometry(); if (!geo) return;
      const mesh = new THREE.Mesh(geo);
      if (fmt === "obj") {
        dl(new Blob([new OBJExporter().parse(mesh)], { type: "text/plain" }), "reliefforge.obj");
        setStatus("OBJ esportato.");
      } else {
        new PLYExporter().parse(mesh, (res: any) => {
          const blob = typeof res === "string" ? new Blob([res], { type: "text/plain" }) : new Blob([res]);
          dl(blob, "reliefforge.ply"); setStatus("PLY esportato.");
        }, {} as any);
      }
    } catch (e: any) { setStatus("Errore export: " + (e?.message ?? String(e))); }
  }, [hmState, buildExportGeometry]);

  const exportDepth8 = useCallback(() => {
    const c = dmCanvas.current; if (!c) { setStatus("Genera prima la depth map."); return; }
    c.toBlob((b) => { if (b) { dl(b, "reliefforge-depth8.png"); setStatus("Depth map 8-bit esportata."); } }, "image/png");
  }, []);

  const exportDepth16 = useCallback(() => {
    if (!hmState) { setStatus("Genera prima la depth map."); return; }
    try {
      const bytes = encodePng16(hmState.normF32, hmState.w, hmState.h);
      const b = new Blob([bytes], { type: "image/png" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = "reliefforge-depth16.png"; a.click();
      setStatus("Depth map 16-bit esportata (CNC).");
    } catch (e: any) { setStatus("Errore export depth: " + (e?.message ?? String(e))); }
  }, [hmState]);

  const steps: { id: Step; label: string; Icon: any }[] = [
    { id: "image", label: "Immagine", Icon: ImageIcon },
    { id: "depth", label: "Profondità", Icon: Mountain },
    { id: "relief", label: "Rilievo", Icon: BoxIcon },
    { id: "frame", label: "Cornice", Icon: FrameIcon },
    { id: "export", label: "Esporta", Icon: Download },
  ];

  const QualityPills = (
    <div style={{ display: "flex", border: `1px solid ${C.border2}`, borderRadius: 7, overflow: "hidden", fontSize: 11 }}>
      {(["small", "base", "large"] as Quality[]).map((q, i) => (
        <button key={q} onClick={() => setQuality(q)} style={{
          padding: "4px 10px", border: "none", cursor: "pointer", borderLeft: i ? `1px solid ${C.border2}` : "none",
          background: quality === q ? C.accent : "transparent", color: quality === q ? C.accentInk : C.muted,
          fontWeight: quality === q ? 600 : 400,
        }}>{q === "small" ? "Veloce" : q === "base" ? "Alta" : "Massima"}</button>
      ))}
    </div>
  );

  const themeVariables = {
    "--rf-text": C.text,
    "--rf-muted": C.muted,
    "--rf-bar-dark": C.barDark,
    "--rf-border": C.border,
    "--rf-border-2": C.border2,
    "--rf-accent": C.accent,
  } as React.CSSProperties;

  return (
    <div style={{ ...themeVariables, position: "fixed", inset: 0, background: C.bg, color: C.text, display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden" }}>

      <div style={{ height: 36, background: C.bar, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: C.accent }} /> ReliefForge {__APP_VERSION__}
          </span>
          <div style={{ position: "relative", fontSize: 13 }}>
            <button onClick={() => { setPreferencesMenu(false); setFileMenu((v) => !v); }} style={menuBtn}>File ▾</button>
            {fileMenu && (
              <>
                <div onClick={() => setFileMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: 24, left: 0, zIndex: 50, background: C.bar, border: `1px solid ${C.border2}`, borderRadius: 8, padding: 5, minWidth: 215, boxShadow: "0 8px 24px #0009" }}>
                  <MenuItem onClick={() => { setFileMenu(false); fileRef.current?.click(); }}>Apri immagine…</MenuItem>
                  <MenuItem onClick={() => { setFileMenu(false); projRef.current?.click(); }}>Apri progetto (.rforge)…</MenuItem>
                  <MenuItem onClick={() => { setFileMenu(false); saveProject(); }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Save size={14} /> Salva</span>
                      <span style={{ color: C.hint, fontSize: 11 }}>Ctrl+S</span>
                    </span>
                  </MenuItem>
                  <div style={{ borderTop: `1px solid ${C.border}`, margin: "5px 0" }} />
                  <MenuItem onClick={() => { setFileMenu(false); exportStl(); }}>Esporta STL</MenuItem>
                  <MenuItem onClick={() => { setFileMenu(false); exportDepth16(); }}>Esporta depth 16-bit</MenuItem>
                  <div style={{ borderTop: `1px solid ${C.border}`, margin: "5px 0" }} />
                  <MenuItem onClick={() => { setFileMenu(false); openCommercialEditor(); }}>Messaggio commerciale...</MenuItem>
                </div>
              </>
            )}
          </div>
          <div style={{ position: "relative", fontSize: 13 }}>
            <button
              onClick={() => { setFileMenu(false); setPreferencesMenu((v) => !v); }}
              style={menuBtn}
              title="Preferenze"
              aria-expanded={preferencesMenu}
            >
              <Settings size={14} /> Preferenze ▾
            </button>
            {preferencesMenu && (
              <>
                <div onClick={() => setPreferencesMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: 24, left: 0, zIndex: 50, background: C.bar, border: `1px solid ${C.border2}`, borderRadius: 8, padding: 10, width: 260, boxShadow: "0 8px 24px #0009" }}>
                  <div style={{ fontSize: 11, color: C.hint, marginBottom: 6 }}>Aspetto interfaccia</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: `1px solid ${C.border2}`, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
                    {(["dark", "light"] as ThemeMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateVisualPreference("theme", mode)}
                        style={{ border: "none", padding: "6px 8px", cursor: "pointer", background: visualPreferences.theme === mode ? C.accent : C.barDark, color: visualPreferences.theme === mode ? C.accentInk : C.text, fontSize: 12 }}
                      >
                        {mode === "dark" ? "Scuro" : "Chiaro"}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.hint, marginBottom: 5 }}>Colori modello</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <button onClick={() => updateVisualPreference("reliefColor", "#78B987")} style={{ ...ghostBtn, flex: 1, justifyContent: "center", padding: "5px 6px", fontSize: 10 }}>Verde V8.1</button>
                    <button onClick={() => updateVisualPreference("reliefColor", "#C9A27B")} style={{ ...ghostBtn, flex: 1, justifyContent: "center", padding: "5px 6px", fontSize: 10 }}>Argilla</button>
                    <button onClick={() => updateVisualPreference("reliefColor", "#8CC5D8")} style={{ ...ghostBtn, flex: 1, justifyContent: "center", padding: "5px 6px", fontSize: 10 }}>Azzurro</button>
                  </div>
                  <ColorSetting label="Bassorilievo" value={visualPreferences.reliefColor} onChange={(value) => updateVisualPreference("reliefColor", value)} />
                  <ColorSetting label="Cornice" value={visualPreferences.frameColor} onChange={(value) => updateVisualPreference("frameColor", value)} />
                  <ColorSetting label="Passepartout" value={visualPreferences.matColor} onChange={(value) => updateVisualPreference("matColor", value)} />
                  <button onClick={resetVisualPreferences} style={{ ...ghostBtn, width: "100%", justifyContent: "center", marginTop: 6 }}>
                    <RotateCcw size={14} /> Impostazioni predefinite
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {QualityPills}
          <span style={{ fontSize: 11, color: C.ok, border: "1px solid #275c47", background: "#11241c", padding: "3px 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <Cpu size={13} /> {device ? device.toUpperCase() : "GPU"}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        <div style={{ width: 70, background: C.panel, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 10, gap: 4 }}>
          {steps.map(({ id, label, Icon }) => {
            const on = step === id;
            return (
              <button key={id} onClick={() => setStep(id)} style={{
                width: 60, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                background: on ? C.border : "transparent", color: on ? "#fff" : C.muted,
                boxShadow: on ? `inset 2px 0 0 ${C.accent}` : "none",
              }}>
                <Icon size={20} /><span style={{ fontSize: 10, fontWeight: on ? 600 : 400 }}>{label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, position: "relative", minWidth: 0, background: C.viewport }}>
          {hmState && (
            <button onClick={() => setWire((w) => !w)} style={{ position: "absolute", top: 12, left: 12, zIndex: 10, display: "flex", alignItems: "center", gap: 6, background: wire ? C.accent : "#0e1116cc", color: wire ? C.accentInk : C.text, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <BoxIcon size={14} /> {wire ? "Solido" : "Wireframe"}
            </button>
          )}
          {hmState && (
            <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, display: "flex", alignItems: "center", gap: 10, background: "#0e1116cc", border: `1px solid ${C.border2}`, borderRadius: 7, padding: "5px 10px" }}>
              <button
                onClick={() => setRenderStyle((v) => (v === "matcap" ? "gesso" : v === "gesso" ? "studio" : "matcap"))}
                title="Matcap: luce solidale alla camera, resta ferma mentre ruoti — la migliore per valutare la tridimensionalità. Gesso: opaco con luce radente fissa nello spazio. Studio: resa lucida per presentare il pezzo."
                style={{ background: "none", border: "none", color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, minWidth: 52, textAlign: "left" }}>
                <Sun size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                {renderStyle === "matcap" ? "Matcap" : renderStyle === "gesso" ? "Gesso" : "Studio"}
              </button>
              <input
                type="range" min={0} max={180} step={1} value={keyLightDeg}
                onChange={(e) => setKeyLightDeg(Number(e.target.value))}
                title={renderStyle === "matcap" ? "Direzione del riflesso (resta solidale alla camera)" : "Direzione della luce radente"}
                style={{ width: 96, accentColor: C.accent, cursor: "pointer" }}
              />
              <span style={{ color: C.hint, fontSize: 11, fontVariantNumeric: "tabular-nums", width: 30 }}>{keyLightDeg}°</span>
            </div>
          )}
          {hmState && (frameOn || matOn) && (
            <button
              onClick={() => setPreviewWelded((v) => !v)}
              title="Fuso = quello che produce «Cornice + rilievo (fuso)»: un corpo unico, la cornice morde 1 mm nel rilievo per saldarsi. Separati = quello che produce «Solo cornice»: pezzi distinti, con il gioco impostato attorno al rilievo."
              style={{ position: "absolute", top: 12, left: 132, zIndex: 10, display: "flex", alignItems: "center", gap: 6, background: "#0e1116cc", color: C.text, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <FrameIcon size={14} /> {previewWelded ? "Anteprima: fuso" : "Anteprima: separati"}
            </button>
          )}
          {hmState ? (
            <ReliefPreview3D hmState={hmState} stlWidthMm={widthMm} decimateStep={decimate}
              maxPreviewCells={MESH_PROFILES[meshProfile].previewCells}
              depthMm={depthMm} baseMm={baseMm} baseStyle={"flat" as any} outputMode={"relief"} bgColor={C.viewport}
              reliefZmm={reliefZ}
              matZmm={matZ}
              wireframe={wire}
              colors={previewColors}
              onPreviewError={handlePreviewError}
              frame={previewFrame}
              mat={previewMat}
              glassSlot={previewGlassSlot}
              welded={previewWelded}
              onLayout={setLayout}
              toleranceMm={exportToleranceMm}
              renderStyle={renderStyle}
              keyLightDeg={keyLightDeg}
              ledValance={previewLedValance} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.hint, gap: 14 }}>
              <BoxIcon size={48} strokeWidth={1} />
              <div style={{ fontSize: 13 }}>Nessun rilievo. Apri un'immagine.</div>
              <button onClick={() => fileRef.current?.click()} style={primaryBtn}><ImageIcon size={15} /> Apri immagine</button>
            </div>
          )}
          {busy && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0e1116cc", color: C.text, fontSize: 13 }}>{status}</div>
          )}
        </div>

        <div style={{ width: 250, background: C.panel, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, padding: "14px 15px", overflowY: "auto", minHeight: 0 }}>
            {step === "image" && (
              <>
                <PanelTitle Icon={ImageIcon} text="Immagine" />
                <button onClick={() => fileRef.current?.click()} style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginBottom: 14 }}>
                  <ImageIcon size={15} /> Apri immagine
                </button>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Qualità modello</div>
                <div style={{ marginBottom: 12 }}>{QualityPills}</div>
                <div style={{ fontSize: 11, color: C.hint, lineHeight: 1.6 }}>
                  Veloce/Alta/Massima = modello AI (più alto = più dettagliato, più pesante da scaricare). I dettagli del rilievo si regolano poi in <b style={{ color: C.muted }}>Profondità</b>.
                </div>
                <div style={{ marginTop: 12, padding: 9, border: `1px solid ${C.border}`, borderRadius: 7, color: C.muted, fontSize: 11, lineHeight: 1.5 }}>
                  <b style={{ color: C.text }}>Risoluzione stabile: 1024 px</b><br />La modalità 1600 px è stata rimossa: il dettaglio viene preservato dal filtro V8.3 senza sovraccaricare Electron.
                </div>

                <div style={{ height: 1, background: C.border, margin: "18px 0 14px" }} />
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Oppure: depth map già pronta</div>
                <button onClick={() => depthFileRef.current?.click()} style={{ ...ghostBtn, width: "100%", justifyContent: "center" }}>
                  <Mountain size={15} /> Apri depth map
                </button>
                <div style={{ fontSize: 11, color: C.hint, lineHeight: 1.6, marginTop: 8 }}>
                  Salta la stima AI e usa una depth map elaborata altrove. Non serve nessuna immagine. PNG 16 bit è il formato di riferimento.
                </div>

                {depthError && (
                  <div style={{ marginTop: 12, padding: 9, border: "1px solid #7a3b34", background: "#2a1512", borderRadius: 7, color: "#f0a99c", fontSize: 11, lineHeight: 1.6 }}>
                    <b style={{ color: "#ffbfb2" }}>Import non riuscito</b><br />{depthError}
                    <div style={{ marginTop: 6, color: "#c98d81" }}>Se il PNG e' interlacciato o a palette, riesportalo come PNG grayscale 16 bit non interlacciato.</div>
                  </div>
                )}

                {depthImport && (
                  <div style={{ marginTop: 12, padding: 9, border: `1px solid ${C.border}`, borderRadius: 7, color: C.muted, fontSize: 11, lineHeight: 1.6 }}>
                    <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>{depthImport.name}</div>
                    {depthImport.w}×{depthImport.h} · {depthImport.bitDepth} bit<br />
                    Range usato: <b style={{ color: C.text }}>{Math.round((depthImport.max - depthImport.min) * 100)}%</b> del fondo scala ({depthImport.min.toFixed(3)} → {depthImport.max.toFixed(3)})
                    {depthImport.resampledTo && <><br />Riscalata a {depthImport.resampledTo} per non saturare Electron.</>}

                    {depthImport.max - depthImport.min < 0.4 && (
                      <div style={{ marginTop: 7, color: "#e2b25c" }}>
                        ⚠ Range utile sotto il 40%: il rilievo verrà schiacciato. Non è un difetto del programma, è la depth map che usa poca escursione. Riattiva la rielaborazione qui sotto per ridistribuirla.
                      </div>
                    )}
                    {depthImport.lossy && (
                      <div style={{ marginTop: 7, color: "#e2b25c" }}>
                        ⚠ Letta a 8 bit per canale: possibili gradini e artefatti sulla superficie stampata. Per la stampa preferisci un PNG grayscale 16 bit non interlacciato.
                        {depthImport.fallback && <><br /><span style={{ color: "#b8894a" }}>Motivo: {depthImport.fallback}</span></>}
                      </div>
                    )}

                    <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, color: C.text, cursor: "pointer" }}>
                      <input type="checkbox" checked={!depthRawMode} onChange={(ev) => setDepthRawMode(!ev.target.checked)} />
                      Rielabora con i controlli di Profondità
                    </label>
                    <div style={{ marginTop: 4 }}>
                      {depthRawMode
                        ? "Ora la depth map viene usata esattamente com'è: niente livelli, curva, dettaglio o normalizzazione."
                        : "Livelli, curva e dettaglio della sezione Profondità vengono applicati sopra la depth map importata."}
                    </div>
                  </div>
                )}
              </>
            )}

            {step === "depth" && (
              <>
                <PanelTitle Icon={Mountain} text="Profondità" />
                {!imgDataUrl && <div style={{ fontSize: 12, color: C.hint, marginBottom: 12 }}>Apri prima un'immagine.</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                  {(Object.keys(DEPTH_PRESETS) as DepthPresetId[]).map((id) => (
                    <button key={id} onClick={() => applyDepthPreset(id)} title={DEPTH_PRESETS[id].hint} style={{
                      ...ghostBtn, justifyContent: "center", padding: "6px 5px", fontSize: 10,
                      background: activeDepthPreset === id ? C.accent : C.barDark,
                      color: activeDepthPreset === id ? C.accentInk : C.text,
                    }}>{DEPTH_PRESETS[id].label}</button>
                  ))}
                </div>
                <Slider strong label="Dettaglio micro" value={pp.detailMicro} min={0} max={1.5} step={0.1} onChange={(v) => setP("detailMicro", v)} />
                <Slider label="Raggio dettaglio (σ)" value={pp.detailSigma} min={0.5} max={4} step={0.1} onChange={(v) => setP("detailSigma", v)} />
                <Slider strong label="Rilievo locale" value={pp.localAmount} min={0} max={1.5} step={0.1} onChange={(v) => setP("localAmount", v)} />
                <Slider label="Scala rilievo locale (σ)" value={pp.localSigma} min={1} max={8} step={0.1} onChange={(v) => setP("localSigma", v)} />
                <Slider label="Volume" value={pp.volumeGamma} min={0.5} max={2} step={0.05} onChange={(v) => setP("volumeGamma", v)} />
                <Slider label="Contrasto" value={pp.contrastPct} min={0} max={10} step={1} suffix="%" onChange={(v) => setP("contrastPct", v)} />
                <Slider label="Denoise" value={pp.skinDenoise} min={0} max={4} step={0.1} onChange={(v) => setP("skinDenoise", v)} />
                {(pp.detailMicro > 1 || pp.volumeGamma < 0.65 || (pp.localAmount > 1.2 && pp.skinDenoise < 2)) && (
                  <div style={{ margin: "-2px 0 10px", color: "#e7ad62", fontSize: 10, lineHeight: 1.45 }}>
                    Parametri molto aggressivi: possono trasformare grana e pelle in rilievo artificiale.
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${C.border}`, margin: "10px 0", paddingTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.text, marginBottom: 10, cursor: "pointer", fontWeight: 600 }}>
                    <input type="checkbox" checked={pp.segment} onChange={(e) => setP("segment", e.target.checked)} /> Isola soggetto (bombatura)
                  </label>
                  {pp.segment && (
                    <>
                      <Slider label="Soglia sfondo" value={pp.segThreshold} min={0} max={1} step={0.01} onChange={(v) => setP("segThreshold", v)} />
                      <Slider label="Sfuma bordo" value={pp.segFeather} min={0} max={5} step={0.5} onChange={(v) => setP("segFeather", v)} />
                    </>
                  )}
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, margin: "4px 0 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={pp.invert} onChange={(e) => setP("invert", e.target.checked)} /> Inverti profondità
                </label>
                <button onClick={() => runDepth(quality)} disabled={busy || !imgDataUrl} style={{ ...ghostBtn, width: "100%", justifyContent: "center", opacity: busy || !imgDataUrl ? 0.5 : 1 }}>
                  <RefreshCw size={15} /> Rigenera (AI)
                </button>
              </>
            )}

            {step === "relief" && (
              <>
                <PanelTitle Icon={BoxIcon} text="Rilievo" />
                <Slider strong label="Profondità" value={depthMm} min={0.5} max={20} step={0.5} suffix=" mm" onChange={setDepthMm} />
                <Slider label="Base" value={baseMm} min={0} max={8} step={0.5} suffix=" mm" onChange={setBaseMm} />
                <Slider label="Larghezza" value={widthMm} min={40} max={300} step={5} suffix=" mm" onChange={setWidthMm} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, margin: "-4px 0 12px" }}>
                  <span>Altezza (auto)</span>
                  <span style={{ color: C.text }}>{hmState ? Math.round(widthMm * hmState.h / hmState.w) : "—"} mm</span>
                </div>
                <Slider label="Decimazione" value={decimate} min={1} max={6} step={1} suffix="×" onChange={setDecimate} />
                <div style={{ fontSize: 11, color: C.muted, margin: "2px 0 6px" }}>Profilo geometria</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 8 }}>
                  {(Object.keys(MESH_PROFILES) as MeshProfile[]).map((id) => (
                    <button key={id} onClick={() => setMeshProfile(id)} title={MESH_PROFILES[id].description} style={{
                      ...ghostBtn, justifyContent: "center", padding: "6px 3px", fontSize: 10,
                      background: meshProfile === id ? C.accent : C.barDark,
                      color: meshProfile === id ? C.accentInk : C.text,
                    }}>{id === "balanced" ? "Bilanciato" : id === "fine" ? "Fine" : "Massima"}</button>
                  ))}
                </div>
                <Toggle label="Mesh adattiva (STL leggero)" on={adaptiveMesh} onChange={setAdaptiveMesh} />
                <div style={{ fontSize: 10, color: C.hint, margin: "-2px 0 8px", lineHeight: 1.45 }}>
                  Mette i triangoli dove c'è dettaglio invece di spalmarli sullo sfondo piatto.
                  Tolleranza {MESH_PROFILES[meshProfile].toleranceMm.toLocaleString("it-IT")} mm — su un ritratto tipico
                  l'STL passa da decine di MB a pochi MB, con la stessa resa in stampa.
                </div>
                {meshPlan && (
                  <div style={{ padding: 8, borderRadius: 6, background: C.barDark, border: `1px solid ${C.border}`, color: C.hint, fontSize: 10, lineHeight: 1.5 }}>
                    Preview {meshPlan.preview.w}×{meshPlan.preview.h} · ~{formatTriangleCount(meshPlan.previewTriangles)} triangoli<br />
                    {adaptiveMesh
                      ? <>STL adattivo · tolleranza {MESH_PROFILES[meshProfile].toleranceMm.toLocaleString("it-IT")} mm (conteggio reale a fine export)</>
                      : <>STL {meshPlan.exported.w}×{meshPlan.exported.h} · ~{formatTriangleCount(meshPlan.exportTriangles)} triangoli</>}
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.hint, marginTop: 6 }}>L'export STL è nello step <b style={{ color: C.muted }}>Esporta</b>.</div>
              </>
            )}

            {step === "frame" && (
              <>
                <PanelTitle Icon={FrameIcon} text="Cornice & passepartout" />

                {layout && (frameOn || matOn) && (
                  <div style={{ background: "#0e1116", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 11, lineHeight: 1.7 }}>
                    <div style={{ color: C.muted, fontWeight: 700, marginBottom: 3 }}>Quote risultanti</div>
                    <QuoteRow label="Ingombro esterno" value={`${layout.outerW.toFixed(1)} × ${layout.outerH.toFixed(1)} × ${layout.outerDepthMm.toFixed(1)} mm`} />
                    {frameOn && <QuoteRow label="Apertura visibile" value={`${layout.visibleApertureW.toFixed(1)} × ${layout.visibleApertureH.toFixed(1)} mm`} />}
                    {frameOn && (
                      <QuoteRow
                        label="Cornice copre il rilievo"
                        value={`${layout.reliefCoverPerSideMm.toFixed(1)} mm per lato`}
                        warn={layout.reliefCoverPerSideMm > 5}
                      />
                    )}
                    {matOn && layout.matInnerW !== null && (
                      <QuoteRow label="Apertura passepartout" value={`${layout.matInnerW.toFixed(1)} × ${(layout.matInnerH ?? 0).toFixed(1)} mm`} />
                    )}
                    {layout.warnings.map((w, i) => (
                      <div key={i} style={{ color: "#ffb454", marginTop: 5, lineHeight: 1.45 }}>⚠ {w}</div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Posizione in profondità</div>
                <Slider label="Profondità rilievo" value={reliefZ} min={-40} max={40} step={0.5} suffix=" mm" onChange={setReliefZ} />
                <Slider label="Profondità passepartout" value={matZ} min={-40} max={40} step={0.5} suffix=" mm" onChange={setMatZ} />
                <div style={{ borderTop: `1px solid ${C.border}`, margin: "6px 0 10px" }} />

                <Toggle label="Cornice" on={frameOn} onChange={setFrameOn} />
                {frameOn && (
                  <>
                    <Slider label="Spessore bordo" value={frameP.solidMm} min={1} max={10} step={0.5} suffix=" mm" onChange={(v) => setFP("solidMm", v)} />
                    <Slider label="Altezza cornice" value={frameP.frameHeightMm} min={5} max={60} step={1} suffix=" mm" onChange={(v) => setFP("frameHeightMm", v)} />
                    <Slider label="Gioco rilievo per lato" value={frameP.reliefGapMm} min={0} max={1} step={0.05} suffix=" mm" onChange={(v) => setFP("reliefGapMm", v)} />
                    <div style={{ fontSize: 10, color: C.hint, margin: "-4px 0 8px", lineHeight: 1.4 }}>
                      Vale per anteprima e "Solo cornice": l'apertura è rilievo + gioco. Nell'export fuso i pezzi restano saldati.
                    </div>
                    <button onClick={() => setFrameAdvanced((v) => !v)} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", padding: "2px 0", marginBottom: 6 }}>
                      {frameAdvanced ? "▾" : "▸"} Avanzate
                    </button>
                    {frameAdvanced && (
                      <>
                        <Slider label="Arrotonda bordi" value={frameP.cornerRadiusMm} min={0} max={12} step={0.5} suffix=" mm" onChange={(v) => setFP("cornerRadiusMm", v)} />
                      </>
                    )}
                  </>
                )}

                <Toggle label="Passepartout (gradoni φ)" on={matOn} onChange={setMatOn} />
                {matOn && (
                  <>
                    <Slider label="Gradoni" value={matP.steps} min={1} max={6} step={1} onChange={(v) => setMP("steps", v)} />
                    <Slider label="Larghezza bande" value={matP.totalBandsMm} min={6} max={40} step={1} suffix=" mm" onChange={(v) => setMP("totalBandsMm", v)} />
                    <Slider label="Spessore" value={matP.thicknessMm} min={0.5} max={6} step={0.1} suffix=" mm" onChange={(v) => setMP("thicknessMm", v)} />
                    <Slider label="Salto gradino" value={matP.stepDropMm} min={0} max={4} step={0.1} suffix=" mm" onChange={(v) => setMP("stepDropMm", v)} />
                  </>
                )}

                {frameOn && (
                  <>
                    <div style={{ borderTop: `1px solid ${C.border}`, margin: "10px 0 8px" }} />
                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8 }}>Vetro e illuminazione</div>
                    <Toggle label="Battuta vetro (appoggio a L)" on={glassSeatOn} onChange={setGlassSeatOn} />
                    {glassSeatOn && (
                      <>
                        <Slider label="Larghezza battuta" value={frameP.lipMm} min={1} max={8} step={0.1} suffix=" mm" onChange={(v) => setFP("lipMm", v)} />
                        <Slider label="Profondita incasso" value={frameP.pocketDepthMm} min={frameP.glassMm + 0.5} max={Math.max(frameP.glassMm + 0.5, frameP.frameHeightMm - 0.5)} step={0.1} suffix=" mm" onChange={(v) => setFP("pocketDepthMm", v)} />
                        <Slider label="Spessore vetro" value={frameP.glassMm} min={2} max={3} step={1} suffix=" mm" onChange={(v) => setFrameP((s) => ({ ...s, glassMm: v as 2 | 3, pocketDepthMm: Math.max(s.pocketDepthMm, v + 0.5) }))} />
                        <Slider label="Gioco per lato" value={frameP.glassClearanceMm} min={0} max={1} step={0.05} suffix=" mm" onChange={(v) => setFP("glassClearanceMm", v)} />
                      </>
                    )}
                    <Toggle label="Alloggiamento vetro (scasso a U)" on={glassOn} onChange={(enabled) => { setGlassOn(enabled); if (enabled) setGlassSeatOn(false); }} />
                    {glassOn && (
                      <>
                        <Slider label="Profondita gola" value={glassP.lipWmm} min={0.8} max={8} step={0.1} suffix=" mm" onChange={(v) => setGP("lipWmm", v)} />
                        <Slider label="Spessore sede" value={glassP.lipThkmm} min={1} max={6} step={0.1} suffix=" mm" onChange={(v) => setGP("lipThkmm", v)} />
                      </>
                    )}
                    <Toggle label="Veletta LED" on={rimOn} onChange={setRimOn} />
                    {rimOn && (
                      <>
                        <Slider label="Sporgenza interna" value={rimW} min={1} max={40} step={0.5} suffix=" mm" onChange={setRimW} />
                        <Slider label="Profondita veletta" value={rimD} min={1} max={40} step={0.5} suffix=" mm" onChange={setRimD} />
                      </>
                    )}
                  </>
                )}

                <button onClick={exportAssembly} disabled={!hmState || (!frameOn && !matOn)} style={{ ...primaryBtn, width: "100%", justifyContent: "center", marginTop: 12, opacity: hmState && (frameOn || matOn) ? 1 : 0.5 }}>
                  <Download size={15} /> Cornice + rilievo (fuso)
                </button>
                <button onClick={exportFrameOnly} disabled={!hmState || (!frameOn && !matOn)} style={{ ...ghostBtn, width: "100%", justifyContent: "center", marginTop: 8, opacity: hmState && (frameOn || matOn) ? 1 : 0.5 }}>
                  <Download size={15} /> Solo cornice (STL separato)
                </button>
                <button
                  onClick={exportReliefMat}
                  disabled={!hmState || !matOn}
                  title={matOn ? "Esporta rilievo e passepartout saldati, senza la cornice." : "Serve il passepartout attivo: senza, questo export coinciderebbe con l'STL del solo rilievo (step Esporta)."}
                  style={{ ...ghostBtn, width: "100%", justifyContent: "center", marginTop: 8, opacity: hmState && matOn ? 1 : 0.5 }}>
                  <Download size={15} /> Rilievo + passepartout (senza cornice)
                </button>
                {hmState && !matOn && (
                  <div style={{ fontSize: 10, color: C.hint, marginTop: 5, lineHeight: 1.45 }}>
                    Disattivato perché il <b style={{ color: C.muted }}>passepartout è spento</b>. Senza passepartout
                    questo file sarebbe identico all'STL del solo rilievo, che trovi nello step <b style={{ color: C.muted }}>Esporta</b>.
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.hint, marginTop: 8, lineHeight: 1.5 }}>
                  La <b style={{ color: C.muted }}>battuta a L</b> crea un appoggio continuo sui quattro lati. Lo <b style={{ color: C.muted }}>scasso a U</b> resta disponibile come alternativa aperta in alto.
                </div>
              </>
            )}

            {step === "export" && (
              <>
                <PanelTitle Icon={Download} text="Esporta" />
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>Mesh 3D (stampa / CNC)</div>
                <button onClick={exportStl} disabled={!hmState} style={{ ...primaryBtn, width: "100%", justifyContent: "center", opacity: hmState ? 1 : 0.5 }}>
                  <Download size={15} /> STL
                </button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => exportMesh("obj")} disabled={!hmState} style={{ ...ghostBtn, flex: 1, justifyContent: "center", opacity: hmState ? 1 : 0.5 }}>OBJ</button>
                  <button onClick={() => exportMesh("ply")} disabled={!hmState} style={{ ...ghostBtn, flex: 1, justifyContent: "center", opacity: hmState ? 1 : 0.5 }}>PLY</button>
                </div>
                <div style={{ fontSize: 11, color: C.muted, margin: "14px 0 7px" }}>Depth map (CNC / CAM)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={exportDepth16} disabled={!hmState} style={{ ...ghostBtn, flex: 1, justifyContent: "center", opacity: hmState ? 1 : 0.5 }}><FileDown size={14} /> 16-bit</button>
                  <button onClick={exportDepth8} disabled={!hmState} style={{ ...ghostBtn, flex: 1, justifyContent: "center", opacity: hmState ? 1 : 0.5 }}>8-bit</button>
                </div>
              </>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px", background: C.barDark }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, marginBottom: 7 }}>
              <Mountain size={13} /> Depth map {hmState ? `· ${hmState.w}×${hmState.h}` : ""}
            </div>
            <div style={{ width: "100%", aspectRatio: "1 / 1", background: "#000", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {hmState ? (
                <canvas ref={dmCanvas} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              ) : (
                <span style={{ fontSize: 11, color: C.hint }}>—</span>
              )}
            </div>

            {levelsStats && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: C.muted }}>
                  <span>Curva profondità</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => { setActiveDepthPreset("custom"); setPp((st) => ({ ...st, levelsAuto: false, curve: levelsCurve(levelsStats.lo, levelsStats.hi) })); }}
                      title="Riporta la curva ai livelli automatici (fondo e cima rilevati dal soggetto)."
                      style={{ background: "none", border: "none", color: C.hint, fontSize: 10, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                      Ripristina
                    </button>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: pp.levelsAuto ? C.muted : C.text }}>
                      <input
                        type="checkbox"
                        checked={pp.levelsAuto}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setActiveDepthPreset("custom");
                          // Passando a manuale si parte dalla curva automatica corrente:
                          // il rilievo non salta, e da li' si aggiusta.
                          setPp((st) => ({ ...st, levelsAuto: on, curve: on ? st.curve : levelsCurve(levelsStats.lo, levelsStats.hi) }));
                        }}
                      />
                      Auto
                    </label>
                  </div>
                </div>
                <DepthCurve
                  histogram={levelsStats.histogram}
                  points={pp.levelsAuto ? levelsCurve(levelsStats.lo, levelsStats.hi) : pp.curve}
                  threshold={pp.segment ? pp.segThreshold : null}
                  accent={C.accent}
                  onChange={(pts) => {
                    setActiveDepthPreset("custom");
                    setPp((st) => ({ ...st, levelsAuto: false, curve: pts }));
                  }}
                />
                <div style={{ fontSize: 10, color: C.hint, marginTop: 5, lineHeight: 1.45 }}>
                  {pp.levelsAuto
                    ? "Automatico: il soggetto viene steso su tutta l'altezza. Togli la spunta, o trascina un punto, per governare la curva a mano."
                    : "Clic = aggiungi punto · trascina = muovi · doppio clic = togli. La curva resta sempre crescente: non può invertire il rilievo. In tratteggio azzurro la soglia di segmentazione."}
                </div>
              </>
            )}
          </div>

          {commercialMessage.enabled && (
            <a
              href={commercialHref || "#"}
              target={commercialHref ? "_blank" : undefined}
              rel={commercialHref ? "noreferrer" : undefined}
              onClick={(e) => { if (!commercialHref) e.preventDefault(); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "10px 12px", background: C.accent, color: C.accentInk, fontSize: 12, fontWeight: 600, textDecoration: "none" }}
              title="Messaggio commerciale modificabile dal menu File"
            >
              <Coffee size={16} />
              <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{commercialMessage.cta}</span>
                {commercialMessage.body ? (
                  <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {commercialMessage.body}
                  </span>
                ) : null}
              </span>
            </a>
          )}
        </div>
      </div>

      <div style={{ height: 26, background: C.barDark, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", fontSize: 11, color: C.hint }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {busy ? <Sun size={12} /> : <span style={{ width: 8, height: 8, borderRadius: 4, background: hmState ? C.ok : C.hint }} />}{status}
        </span>
        <span style={{ display: "flex", gap: 14 }}>
          {hmState && <span>{hmState.w}×{hmState.h}</span>}
          <span>Modello: {quality === "small" ? "Small" : quality === "base" ? "Base" : "Large"}</span>
        </span>
      </div>

      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
      <input ref={projRef} type="file" accept=".rforge,application/json" onChange={onOpenProject} style={{ display: "none" }} />
      <input ref={depthFileRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={onDepthFile} style={{ display: "none" }} />

      {commercialEditorOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "#0009", padding: 24 }}>
          <div style={{ width: "min(560px, 100%)", background: C.panel, border: `1px solid ${C.border2}`, borderRadius: 12, boxShadow: "0 24px 80px #000c", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 15px", background: C.bar, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <Megaphone size={17} color={C.accent} /> Messaggio commerciale
              </div>
              <button onClick={() => setCommercialEditorOpen(false)} style={{ ...ghostBtn, padding: "5px 9px" }}>Chiudi</button>
            </div>

            <div style={{ padding: 16 }}>
              <label style={fieldLabel}>
                <span>Visibile in Studio</span>
                <input
                  type="checkbox"
                  checked={commercialDraft.enabled}
                  onChange={(e) => setCommercialDraft((s) => ({ ...s, enabled: e.target.checked }))}
                />
              </label>

              <Field
                label="Titolo interno"
                value={commercialDraft.title}
                onChange={(title) => setCommercialDraft((s) => ({ ...s, title }))}
                placeholder="Es. Sostieni ReliefForge"
              />
              <Field
                label="Testo breve"
                value={commercialDraft.body}
                onChange={(body) => setCommercialDraft((s) => ({ ...s, body }))}
                placeholder="Es. Versione gratuita in sviluppo continuo."
              />
              <Field
                label="Testo pulsante"
                value={commercialDraft.cta}
                onChange={(cta) => setCommercialDraft((s) => ({ ...s, cta }))}
                placeholder="Es. Offri un caffe per lo sviluppo"
              />
              <Field
                label="Link"
                value={commercialDraft.href}
                onChange={(href) => setCommercialDraft((s) => ({ ...s, href }))}
                placeholder="https://..."
              />

              <div style={{ marginTop: 13, border: `1px solid ${C.border}`, borderRadius: 9, padding: 12, background: C.barDark }}>
                <div style={{ color: C.hint, fontSize: 11, marginBottom: 7 }}>Anteprima</div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 8, background: C.accent, color: C.accentInk, fontSize: 12, fontWeight: 700 }}>
                  <Coffee size={16} />
                  <span style={{ display: "grid", gap: 1 }}>
                    <span>{commercialDraft.cta || DEFAULT_COMMERCIAL_MESSAGE.cta}</span>
                    {commercialDraft.body ? <span style={{ fontSize: 10, opacity: 0.8 }}>{commercialDraft.body}</span> : null}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: 15, borderTop: `1px solid ${C.border}`, background: C.barDark }}>
              <button onClick={resetCommercialDraft} style={ghostBtn}>Ripristina default</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setCommercialEditorOpen(false)} style={ghostBtn}>Annulla</button>
                <button onClick={applyCommercialDraft} style={primaryBtn}>Salva messaggio</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const menuBtn: React.CSSProperties = { background: "none", border: "none", color: "var(--rf-muted)", cursor: "pointer", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 5 };
const primaryBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, background: "#E26D5C", color: "#2a1209", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, background: "transparent", color: "var(--rf-muted)", border: "1px solid var(--rf-border-2)", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" };
const fieldLabel: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: "var(--rf-text)", fontSize: 12, marginBottom: 12 };

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 6, marginBottom: 12, color: "var(--rf-muted)", fontSize: 12 }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", background: "var(--rf-bar-dark)", color: "var(--rf-text)", border: "1px solid var(--rf-border-2)", borderRadius: 7, padding: "8px 9px", fontSize: 13 }}
      />
    </label>
  );
}

function ColorSetting({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: "var(--rf-text)", fontSize: 12, marginBottom: 7 }}>
      <span>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ color: "var(--rf-muted)", fontFamily: "monospace", fontSize: 10 }}>{value.toUpperCase()}</span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Colore ${label}`}
          style={{ width: 30, height: 24, padding: 1, border: "1px solid var(--rf-border-2)", background: "var(--rf-bar-dark)", cursor: "pointer" }}
        />
      </span>
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (b: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: on ? "var(--rf-text)" : "var(--rf-muted)", margin: "8px 0 10px", cursor: "pointer", fontWeight: on ? 600 : 400 }}>
      <span>{label}</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "var(--rf-text)", fontSize: 13, padding: "7px 10px", borderRadius: 5, cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--rf-border)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {children}
    </button>
  );
}

function PanelTitle({ Icon, text }: { Icon: any; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 13, fontWeight: 600, fontSize: 13 }}>
      <Icon size={16} color="var(--rf-accent)" /> {text}
    </div>
  );
}

/** Riga di sola lettura per le quote derivate dell'assieme (V8.5). */
function QuoteRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "var(--rf-hint, #7b8494)" }}>{label}</span>
      <span style={{ color: warn ? "#ffb454" : "var(--rf-text, #e6e9ef)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
