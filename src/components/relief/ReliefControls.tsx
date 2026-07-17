import React from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

import type { OutputMode, BaseStyle } from "@/lib/reliefTypes";

// (Compat: se qualche file importava i tipi da qui)
export type { OutputMode, BaseStyle } from "@/lib/reliefTypes";

export type ProjectType =
  | "logo_text"
  | "human_face"
  | "animal"
  | "nature_landscape"
  | "decorative_pattern";

export type EdgeMode = "round" | "sharp";

export type ReliefParams = {
  projectType: ProjectType;
  depthMm: number;
  baseMm: number; // can be 0
  detail: number; // 0..1
  smooth: number; // 0..1
  edge: EdgeMode;

  // tenuti nei params per compatibilità (UI fisso):
  outputMode: OutputMode;

  baseStyle: BaseStyle;

  // ✅ manteniamo per compatibilità, ma NON è più esposto in UI
  cutoutEnabled?: boolean;
};

type Props = {
  value: ReliefParams;
  onChange: (next: ReliefParams) => void;
  disabled?: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const DEFAULTS: ReliefParams = {
  projectType: "logo_text",
  depthMm: 2,
  baseMm: 1,
  detail: 0.5,
  smooth: 0.5,
  edge: "round",
  outputMode: "relief", // ✅ fisso
  baseStyle: "flat",
  cutoutEnabled: false, // ✅ fissato a false (compat)
};

export default function ReliefControls({ value, onChange, disabled }: Props) {
  // outputMode sempre fisso a "relief"
  const v: ReliefParams = { ...DEFAULTS, ...value, outputMode: "relief" as const };

  const set = (patch: Partial<ReliefParams>) =>
    onChange({
      ...v,
      ...patch,
      outputMode: "relief",
      // ✅ Cutout disabilitato “hard”
      cutoutEnabled: false,
    });

  return (
    <div className="space-y-4">
      {/* Tipo progetto */}
      <div className="space-y-2">
        <Label>Tipo progetto</Label>
        <Select
          disabled={disabled}
          value={v.projectType}
          onValueChange={(x) => set({ projectType: x as ProjectType })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Scegli..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="logo_text">Logo / Testo (bordi netti)</SelectItem>
            <SelectItem value="human_face">Volto umano (sfumature)</SelectItem>
            <SelectItem value="animal">Animale (texture)</SelectItem>
            <SelectItem value="nature_landscape">
              Natura / Paesaggio (profondità)
            </SelectItem>
            <SelectItem value="decorative_pattern">
              Pattern decorativo (ripetizione)
            </SelectItem>
          </SelectContent>
        </Select>

        <p className="text-xs text-slate-600">
          Suggerimento:{" "}
          <span className="font-medium text-slate-700">Logo/Testo</span> aumenta
          contrasto e bordi;{" "}
          <span className="font-medium text-slate-700">Volto</span> mantiene
          sfumature e volumi.
        </p>
      </div>

      <Separator />

      {/* Base style */}
      <div className="space-y-2">
        <Label>Base</Label>
        <Select
          disabled={disabled}
          value={v.baseStyle}
          onValueChange={(x) => set({ baseStyle: x as BaseStyle })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Scegli..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="flat">Piatta</SelectItem>
            <SelectItem value="recessed">Incassata</SelectItem>
            <SelectItem value="offset">Offset</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Profondità */}
      <div className="space-y-2">
        <Label>Profondità rilievo (mm): {v.depthMm.toFixed(1)}</Label>
        <Slider
          disabled={disabled}
          value={[v.depthMm]}
          min={0}
          max={30}
          step={0.1}
          onValueChange={(arr) => set({ depthMm: clamp(arr[0] ?? 0, 0, 30) })}
        />
      </div>

      {/* Base mm */}
      <div className="space-y-2">
        <Label>Spessore base (mm): {v.baseMm.toFixed(1)}</Label>
        <Slider
          disabled={disabled}
          value={[v.baseMm]}
          min={0}
          max={30}
          step={0.1}
          onValueChange={(arr) => set({ baseMm: clamp(arr[0] ?? 0, 0, 30) })}
        />

        <p className="text-xs text-slate-600">
          Se imposti <span className="font-medium text-slate-700">0</span>, ottieni solo il rilievo (senza basetta).
        </p>
      </div>

      <Separator />

      {/* Dettaglio */}
      <div className="space-y-2">
        <Label>Dettaglio: {v.detail.toFixed(2)}</Label>
        <Slider
          disabled={disabled}
          value={[v.detail]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(arr) => set({ detail: clamp(arr[0] ?? 0, 0, 1) })}
        />
      </div>

      {/* Smussatura */}
      <div className="space-y-2">
        <Label>Smussatura: {v.smooth.toFixed(2)}</Label>
        <Slider
          disabled={disabled}
          value={[v.smooth]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(arr) => set({ smooth: clamp(arr[0] ?? 0, 0, 1) })}
        />
      </div>

      <Separator />

      {/* Bordi arrotondati */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>Bordi arrotondati</Label>
          <Switch
            disabled={disabled}
            checked={v.edge === "round"}
            onCheckedChange={(checked) =>
              set({ edge: checked ? "round" : "sharp" })
            }
          />
        </div>
        <p className="text-xs text-slate-600">
          Attivo = bordi più morbidi. Disattivo = bordi più incisi (più “taglienti”).
        </p>
      </div>
    </div>
  );
}
