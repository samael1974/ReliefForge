// src/components/relief/DepthCurve.tsx
//
// Editor di curva tonale sulla depth map (V8.8), con l'istogramma sullo sfondo.
//
// Sostituisce il pannello Livelli: i livelli sono la curva con i soli due estremi,
// quindi non si perde niente. Trascinare il punto in basso a sinistra verso destra
// e' esattamente "alza il fondo"; trascinare quello in alto a sinistra e' "abbassa
// la cima". In piu' si possono aggiungere punti intermedi, che e' cio' che serve
// quando l'istogramma e' bimodale (sfondo + soggetto).
//
// La curva e' vincolata a essere MONOTONA CRESCENTE: su un campo di altezze una
// curva che scende inverte il rilievo e crea sottosquadri. Il vincolo e' applicato
// sia sui punti (in sanitizeCurve) sia sull'interpolazione (Fritsch-Carlson).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { buildCurveLut, evalCurve, sanitizeCurve, type CurvePoint } from "@/lib/relief/transform/toneCurve";

export type DepthCurveProps = {
  histogram: Uint32Array | null;
  points: CurvePoint[];
  /** Soglia di segmentazione, disegnata come riferimento. null = spenta. */
  threshold?: number | null;
  onChange: (points: CurvePoint[]) => void;
  accent?: string;
};

const HGT = 168;
const HIT = 0.045; // raggio di presa, in unita' curva

export default function DepthCurve({ histogram, points, threshold = null, onChange, accent = "#ff7a5c" }: DepthCurveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragIdx = useRef<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const w = cv.clientWidth || 260;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(HGT * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, HGT);
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(0, 0, w, HGT);

    // Istogramma, scala a radice: senza, il picco dello sfondo piatto schiaccia
    // tutto il resto a una riga invisibile.
    if (histogram && histogram.length) {
      let max = 0;
      for (let i = 0; i < histogram.length; i++) if (histogram[i]! > max) max = histogram[i]!;
      const norm = max > 0 ? 1 / Math.sqrt(max) : 0;
      ctx.fillStyle = "#242c39";
      const bw = w / histogram.length;
      for (let i = 0; i < histogram.length; i++) {
        const v = Math.sqrt(histogram[i]!) * norm;
        const bh = v * HGT;
        ctx.fillRect(i * bw, HGT - bh, Math.max(1, bw), bh);
      }
    }

    // Griglia ai quarti
    ctx.strokeStyle = "#1b212b";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = (i / 4) * w, u = (i / 4) * HGT;
      ctx.beginPath(); ctx.moveTo(t, 0); ctx.lineTo(t, HGT); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, u); ctx.lineTo(w, u); ctx.stroke();
    }
    // Diagonale identita'
    ctx.strokeStyle = "#2b3444";
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, HGT); ctx.lineTo(w, 0); ctx.stroke();
    ctx.setLineDash([]);

    if (threshold !== null && threshold !== undefined) {
      ctx.strokeStyle = "#5ec8f0";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(threshold * w, 0); ctx.lineTo(threshold * w, HGT); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Curva
    const lut = buildCurveLut(points, 512);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = 0; px <= w; px++) {
      const y = evalCurve(lut, px / w);
      const cy = (1 - y) * HGT;
      if (px === 0) ctx.moveTo(px, cy); else ctx.lineTo(px, cy);
    }
    ctx.stroke();

    // Punti
    points.forEach((p, i) => {
      const cx = p.x * w, cy = (1 - p.y) * HGT;
      ctx.beginPath();
      ctx.arc(cx, cy, i === sel ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === sel ? "#ffffff" : "#0b0e13";
      ctx.fill();
      ctx.strokeStyle = i === sel ? accent : "#c9d1de";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }, [histogram, points, threshold, accent, sel]);

  const toCurve = useCallback((clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) return { x: 0, y: 0 };
    const r = box.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, 1 - (clientY - r.top) / Math.max(1, r.height))),
    };
  }, []);

  const nearest = (c: CurvePoint) => {
    let best = -1, bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= HIT ? best : -1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!histogram) return;
    const c = toCurve(e.clientX, e.clientY);
    let i = nearest(c);
    if (i < 0) {
      // Clic nel vuoto: aggiunge un punto e lo prende subito in trascinamento.
      const next = sanitizeCurve([...points, c]);
      i = next.findIndex((p) => Math.abs(p.x - c.x) < 1e-6);
      onChange(next);
      if (i < 0) i = 0;
    }
    dragIdx.current = i;
    setSel(i);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const i = dragIdx.current;
    if (i === null) return;
    const c = toCurve(e.clientX, e.clientY);
    const next = points.map((p, k) => (k === i ? c : p));
    onChange(sanitizeCurve(next));
  };

  const endDrag = () => { dragIdx.current = null; };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (points.length <= 2) return; // gli estremi non si tolgono
    const c = toCurve(e.clientX, e.clientY);
    const i = nearest(c);
    if (i < 0 || i === 0 || i === points.length - 1) return;
    onChange(points.filter((_, k) => k !== i));
    setSel(null);
  };

  const selPoint = sel !== null ? points[sel] : undefined;

  return (
    <div style={{ marginTop: 8 }}>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        style={{
          position: "relative", height: HGT, borderRadius: 5,
          border: "1px solid #232935", cursor: histogram ? "crosshair" : "default",
          touchAction: "none",
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: HGT, display: "block", borderRadius: 4 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7b8494", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        <span>{selPoint ? `X ${selPoint.x.toFixed(3)}` : `${points.length} punti`}</span>
        {threshold !== null && threshold !== undefined && <span style={{ color: "#5ec8f0" }}>soglia {threshold.toFixed(2)}</span>}
        <span>{selPoint ? `Y ${selPoint.y.toFixed(3)}` : "clic = aggiungi"}</span>
      </div>
    </div>
  );
}
