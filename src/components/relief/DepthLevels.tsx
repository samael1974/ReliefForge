// src/components/relief/DepthLevels.tsx
//
// Istogramma della depth map con LIVELLI trascinabili (V8.6).
//
// Perche' serve: la depth map E' il campo di altezze, quindi decidere quale
// profondita' diventa il piano di fondo e quale il punto piu' alto e' la scelta
// che determina la resa del rilievo. Fino alla 8.5 quel valore si sceglieva a
// occhio digitando un numero in "Soglia sfondo", senza vedere la distribuzione:
// ogni tentativo costava una rigenerazione.
//
// Qui la distribuzione si vede, e i due punti si trascinano sopra di essa. La
// soglia di segmentazione e' disegnata nello STESSO dominio, cosi' si capisce a
// colpo d'occhio cosa si sta tagliando.
//
// Nota di progetto: niente curve libere. Su un'altezza fisica una curva arbitraria
// produce facilmente gradini visibili in stampa; i livelli restano prevedibili.

import React, { useCallback, useEffect, useRef } from "react";

export type DepthLevelsProps = {
  /** Conteggi per bin, gia' calcolati sul dominio 0..1. */
  histogram: Uint32Array | null;
  /** Punto nero: la profondita' che diventa il fondo (0..1). */
  black: number;
  /** Punto bianco: la profondita' che diventa il punto piu' alto (0..1). */
  white: number;
  /** Soglia di segmentazione, disegnata come riferimento. null = segmentazione spenta. */
  threshold?: number | null;
  /** true = i punti li calcola l'app dai dati; le maniglie restano visibili ma inattive. */
  auto?: boolean;
  onChange: (black: number, white: number) => void;
  accent?: string;
};

const H = 74;

export default function DepthLevels({
  histogram, black, white, threshold = null, auto = false, onChange, accent = "#ff7a5c",
}: DepthLevelsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<"black" | "white" | null>(null);

  // --- disegno ---
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const w = cv.clientWidth || 260;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);

    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(0, 0, w, H);

    if (histogram && histogram.length) {
      // Scala radice: senza, il picco dello sfondo piatto (decine di migliaia di
      // pixel sullo stesso valore) schiaccia tutto il resto a una riga invisibile.
      let max = 0;
      for (let i = 0; i < histogram.length; i++) if (histogram[i]! > max) max = histogram[i]!;
      const norm = max > 0 ? 1 / Math.sqrt(max) : 0;

      ctx.fillStyle = "#3a4658";
      const bw = w / histogram.length;
      for (let i = 0; i < histogram.length; i++) {
        const v = Math.sqrt(histogram[i]!) * norm;
        const bh = Math.max(v > 0 ? 1 : 0, v * (H - 12));
        ctx.fillRect(i * bw, H - bh, Math.max(1, bw), bh);
      }

      // Zona effettivamente usata: fuori dai livelli il materiale viene appiattito.
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, black * w, H);
      ctx.fillRect(white * w, 0, w - white * w, H);
    } else {
      ctx.fillStyle = "#39404d";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText("—", 8, H / 2);
    }

    if (threshold !== null && threshold !== undefined) {
      ctx.strokeStyle = "#5ec8f0";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(threshold * w, 0);
      ctx.lineTo(threshold * w, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [histogram, black, white, threshold]);

  // --- trascinamento ---
  const posFromEvent = useCallback((clientX: number) => {
    const box = boxRef.current;
    if (!box) return 0;
    const r = box.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (auto || !histogram) return;
    const x = posFromEvent(e.clientX);
    dragging.current = Math.abs(x - black) <= Math.abs(x - white) ? "black" : "white";
    (e.target as Element).setPointerCapture?.(e.pointerId);
    applyDrag(x);
  };

  const applyDrag = (x: number) => {
    const MIN_SPAN = 0.02; // sotto questa distanza il rilievo diventa un gradino
    if (dragging.current === "black") onChange(Math.min(x, white - MIN_SPAN), white);
    else if (dragging.current === "white") onChange(black, Math.max(x, black + MIN_SPAN));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    applyDrag(posFromEvent(e.clientX));
  };
  const endDrag = () => { dragging.current = null; };

  const handle = (pos: number, label: string, color: string): React.CSSProperties => ({
    position: "absolute", top: -3, bottom: -3, left: `calc(${pos * 100}% - 1px)`,
    width: 2, background: color, pointerEvents: "none",
  });

  return (
    <div style={{ marginTop: 8 }}>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: "relative", height: H, borderRadius: 5, overflow: "visible",
          border: "1px solid #232935",
          cursor: auto || !histogram ? "default" : "ew-resize",
          touchAction: "none",
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: H, display: "block", borderRadius: 4 }} />
        {histogram && <div style={handle(black, "nero", auto ? "#5a6376" : "#ffffff")} />}
        {histogram && <div style={handle(white, "bianco", auto ? "#5a6376" : accent)} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7b8494", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        <span>fondo {black.toFixed(3)}</span>
        {threshold !== null && threshold !== undefined && <span style={{ color: "#5ec8f0" }}>soglia {threshold.toFixed(2)}</span>}
        <span>cima {white.toFixed(3)}</span>
      </div>
    </div>
  );
}
