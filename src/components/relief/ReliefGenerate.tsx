import * as React from "react";
import ReliefPreview3D from "@/components/relief/ReliefPreview3D";
import type { BaseStyle } from "@/lib/relief/reliefTypes";

const ReliefPreview3DAny =
  ReliefPreview3D as unknown as React.ComponentType<Record<string, unknown>>;

type HeightmapState = {
  normF32: Float32Array;
  w: number;
  h: number;
};

type Props = {
  hmState: HeightmapState | null;
  widthMm: number;
  depthMm: number;
  baseMm: number;
  previewDecimateStep: number;
  baseStyle: BaseStyle;
};

export default function ReliefGenerate({
  hmState,
  widthMm,
  depthMm,
  baseMm,
  previewDecimateStep,
  baseStyle,
}: Props) {
  return (
    <div className="h-full w-full">
      <ReliefPreview3DAny
        hmState={hmState}
        stlWidthMm={widthMm}
        decimateStep={previewDecimateStep}
        depthMm={depthMm}
        baseMm={baseMm}
        outputMode="relief"
        baseStyle={baseStyle}
      />
    </div>
  );
}
