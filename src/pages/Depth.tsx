// src/pages/Depth.tsx — Generatore Depth Map in-app (versione avanzata).
// Depth Anything V2 (stima 1 volta) + post-processing ricalcolato a ogni slider:
// denoise pelle, rilievo locale, micro-dettaglio (fusione luma), volume (gamma),
// contrasto (percentile), inverti. Export PNG 16-bit (CNC/ReliefForge) e 8-bit.
import React, { useRef, useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { estimateDepth } from "@/lib/relief/depth/estimateDepth";
import { fuseDepthDetail } from "@/lib/relief/depth/fuseDepthDetail";
import { gaussianBlurF32, gammaF32, percentileClipF32 } from "@/lib/relief/transform/tonemap";
import { encodePng16 } from "@/lib/relief/encodePng16";

const MAX_PROC = 1024; // profilo desktop stabile V8.1/V8.3, formato preservato

function lumaFromImageData(id: ImageData): Float32Array {
  const d = id.data, out = new Float32Array(id.width * id.height);
  for (let i = 0, j = 0; j < out.length; j++, i += 4)
    out[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return out;
}

type Raw = { depth: Float32Array; luma: Float32Array; w: number; h: number; device: string };

type Params = {
  detailMicro: number; detailSigma: number; skinDenoise: number; volumeGamma: number;
  localAmount: number; localSigma: number; contrastPct: number; invert: boolean; view: "fuso" | "depth";
};

function processHeightmap(raw: Raw, p: Params): Float32Array {
  const { w, h } = raw;
  if (p.view === "depth") {
    let d = percentileClipF32(raw.depth, p.contrastPct / 100);
    if (p.invert) { const o = new Float32Array(d.length); for (let i = 0; i < d.length; i++) o[i] = 1 - d[i]; d = o; }
    return d;
  }
  let d = p.skinDenoise > 0 ? gaussianBlurF32(raw.depth, w, h, p.skinDenoise) : raw.depth.slice();
  if (p.localAmount > 0) {
    const low = gaussianBlurF32(d, w, h, p.localSigma);
    const o = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) o[i] = d[i] + p.localAmount * (d[i] - low[i]);
    d = o;
  }
  let f = fuseDepthDetail(d, raw.luma, w, h, { detailAmount: p.detailMicro, detailSigma: p.detailSigma, renormalize: false });
  f = gammaF32(f, p.volumeGamma);
  f = percentileClipF32(f, p.contrastPct / 100);
  if (p.invert) { const o = new Float32Array(f.length); for (let i = 0; i < f.length; i++) o[i] = 1 - f[i]; f = o; }
  return f;
}

function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; strong?: boolean; suffix?: string;
}) {
  return (
    <div>
      <div className={"text-sm " + (props.strong ? "font-semibold text-slate-800" : "text-slate-700")}>
        {props.label}: {props.value}{props.suffix ?? ""}
      </div>
      <input
        type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(+e.target.value)} className="w-full"
      />
    </div>
  );
}

export default function Depth() {
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const outRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rawRef = useRef<Raw | null>(null);
  const runRef = useRef<() => void>(() => {});

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Carica una foto e premi Genera.");
  const [hmap, setHmap] = useState<{ f: Float32Array; w: number; h: number } | null>(null);

  const [detailMicro, setDetailMicro] = useState(1.5);
  const [detailSigma, setDetailSigma] = useState(1.8);
  const [skinDenoise, setSkinDenoise] = useState(1.5);
  const [volumeGamma, setVolumeGamma] = useState(1.0);
  const [localAmount, setLocalAmount] = useState(0.5);
  const [localSigma, setLocalSigma] = useState(2);
  const [contrastPct, setContrastPct] = useState(4);
  const [invert, setInvert] = useState(false);
  const [view, setView] = useState<"fuso" | "depth">("fuso");
  const [quality, setQuality] = useState<"small" | "base" | "large">("small");

  const params: Params = { detailMicro, detailSigma, skinDenoise, volumeGamma, localAmount, localSigma, contrastPct, invert, view };

  const draw = useCallback((f: Float32Array, w: number, h: number) => {
    const c = outRef.current!; c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < f.length; i++, j += 4) {
      const v = Math.round(Math.max(0, Math.min(1, f[i])) * 255);
      out.data[j] = out.data[j + 1] = out.data[j + 2] = v; out.data[j + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, []);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = srcRef.current!; const sc = Math.min(1, 640 / img.naturalWidth);
      c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      rawRef.current = null; setHmap(null);
      setMsg("Genero automaticamente la depth map…");
      setTimeout(() => runRef.current(), 50); // Auto Depth Map al caricamento
    };
    img.src = url;
  }, []);

  const run = useCallback(async () => {
    if (!imgRef.current) { setMsg("Carica prima una foto."); return; }
    setBusy(true); setMsg("Stimo la profondità (primo avvio: scarico il modello ~50-100 MB)…");
    try {
      const img = imgRef.current;
      const sc = Math.min(1, MAX_PROC / Math.max(img.naturalWidth, img.naturalHeight));
      const pw = Math.max(2, Math.round(img.naturalWidth * sc));
      const ph = Math.max(2, Math.round(img.naturalHeight * sc));
      const oc = document.createElement("canvas"); oc.width = pw; oc.height = ph;
      const octx = oc.getContext("2d", { willReadFrequently: true })!;
      octx.drawImage(img, 0, 0, pw, ph);
      const id = octx.getImageData(0, 0, pw, ph);
      const dep = await estimateDepth(id, { model: quality, onProgress: (p) => setMsg("Modello: " + p.status) });
      const lc = document.createElement("canvas"); lc.width = dep.w; lc.height = dep.h;
      const lctx = lc.getContext("2d", { willReadFrequently: true })!;
      lctx.drawImage(img, 0, 0, dep.w, dep.h);
      const lu = lumaFromImageData(lctx.getImageData(0, 0, dep.w, dep.h));
      rawRef.current = { depth: dep.normF32, luma: lu, w: dep.w, h: dep.h, device: dep.device };
      const f = processHeightmap(rawRef.current, params);
      setHmap({ f, w: dep.w, h: dep.h }); draw(f, dep.w, dep.h);
      setMsg("Fatto (" + dep.device + "). Regola i parametri e scarica 16-bit.");
    } catch (err: any) { setMsg("Errore: " + (err?.message || err)); }
    finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, quality]);

  useEffect(() => { runRef.current = run; }, [run]);

  useEffect(() => {
    if (!rawRef.current) return;
    const f = processHeightmap(rawRef.current, params);
    setHmap({ f, w: rawRef.current.w, h: rawRef.current.h });
    draw(f, rawRef.current.w, rawRef.current.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailMicro, detailSigma, skinDenoise, volumeGamma, localAmount, localSigma, contrastPct, invert, view]);

  const download16 = useCallback(() => {
    if (!hmap) return;
    const bytes = encodePng16(hmap.f, hmap.w, hmap.h);
    const b = new Blob([bytes], { type: "image/png" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "heightmap-16bit.png"; a.click();
  }, [hmap]);

  const download8 = useCallback(() => {
    const c = outRef.current; if (!c) return;
    c.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "heightmap-8bit.png"; a.click(); }, "image/png");
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Generatore Depth Map</h1>
        <Link to="/relief" className="text-sm text-[#2f6f7e] underline">→ Vai al generatore STL</Link>
      </div>

      <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        Foto → profondità reale (Depth Anything V2) + micro-dettaglio della foto + <strong>denoise pelle</strong>.
        Esporta heightmap <strong>PNG 16-bit</strong> (niente banding, niente errore in ReliefForge Depth map).
        Primo avvio: ~50-100 MB modello (poi in cache).
      </div>

      <div className="mb-3 rounded-lg border bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept="image/*" onChange={onFile} />
          <div className="inline-flex items-center gap-2">
            <span className="text-sm text-slate-600">Qualità:</span>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
              <button
                type="button"
                onClick={() => { setQuality("small"); setMsg("Qualità: Veloce. Premi Genera per applicare."); }}
                className={"px-2.5 py-1 text-xs font-semibold " + (quality === "small" ? "bg-[#2f6f7e] text-white" : "bg-white text-slate-700")}
              >Veloce</button>
              <button
                type="button"
                onClick={() => { setQuality("base"); setMsg("Qualità: Alta (modello Base). Premi Genera — al primo uso scarica ~190 MB."); }}
                className={"px-2.5 py-1 text-xs font-semibold " + (quality === "base" ? "bg-[#2f6f7e] text-white" : "bg-white text-slate-700")}
              >Alta</button>
              <button
                type="button"
                onClick={() => { setQuality("large"); setMsg("Qualità: Massima (modello Large). Consigliato su desktop/GPU. Premi Genera — al primo uso scarica ~660 MB."); }}
                className={"px-2.5 py-1 text-xs font-semibold " + (quality === "large" ? "bg-[#2f6f7e] text-white" : "bg-white text-slate-700")}
              >Massima</button>
            </div>
          </div>
          <button onClick={run} disabled={busy} className="rounded-md bg-[#E26D5C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Genera</button>
          <button onClick={download16} disabled={!hmap} className="rounded-md bg-[#2f6f7e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Scarica PNG 16-bit</button>
          <button onClick={download8} disabled={!hmap} className="rounded-md border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">PNG 8-bit</button>
        </div>
        <p className="mt-2 text-sm text-slate-500">{msg}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 text-sm font-semibold">Foto originale</div>
          <canvas ref={srcRef} className="w-full rounded-lg bg-black" />
        </div>

        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Heightmap</div>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
              <button type="button" onClick={() => setView("fuso")} className={"px-2.5 py-1 text-xs font-semibold " + (view === "fuso" ? "bg-[#2f6f7e] text-white" : "bg-white text-slate-700")}>Fuso</button>
              <button type="button" onClick={() => setView("depth")} className={"px-2.5 py-1 text-xs font-semibold " + (view === "depth" ? "bg-[#2f6f7e] text-white" : "bg-white text-slate-700")}>Solo depth</button>
            </div>
          </div>
          <canvas ref={outRef} className="w-full rounded-lg bg-black" />

          <div className="mt-4 space-y-3">
            <Slider strong label="Dettaglio micro" value={detailMicro} min={0} max={1.5} step={0.1} onChange={setDetailMicro} />
            <Slider label="Raggio dettaglio (σ)" value={detailSigma} min={0.5} max={5} step={0.1} onChange={setDetailSigma} />
            <Slider label="Denoise pelle (σ)" value={skinDenoise} min={0} max={4} step={0.1} onChange={setSkinDenoise} />
            <Slider label="Volume busto (gamma)" value={volumeGamma} min={0.5} max={2} step={0.05} onChange={setVolumeGamma} />
            <Slider strong label="Rilievo locale" value={localAmount} min={0} max={1.5} step={0.1} onChange={setLocalAmount} />
            <Slider label="Scala rilievo locale (σ)" value={localSigma} min={1} max={8} step={1} onChange={setLocalSigma} />
            <Slider label="Contrasto (percentile)" value={contrastPct} min={0} max={10} step={1} onChange={setContrastPct} suffix="%" />

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} className="h-4 w-4" />
              Inverti profondità
            </label>

            <p className="text-xs text-slate-500">
              Volti: Dettaglio 0.5-0.8, Denoise 0.8-1.5 (pelle liscia), Volume 1.1-1.4 (busto più tondo).
              In ReliefForge: Ultra, Smussatura 0, Dettaglio basso (è già nella heightmap).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
