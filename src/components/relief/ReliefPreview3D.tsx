// src/components/relief/ReliefPreview3D.tsx
import React, { useMemo, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment, Grid } from "@react-three/drei";
import * as THREE from "three";

import { buildSolidFromHeightmap } from "@/lib/relief/buildSolidFromHeightmap";
import type { BaseStyle } from "@/lib/relief/reliefTypes";
import { buildPassepartoutRectPhi, passepartoutOuterBandsMm } from "@/lib/relief/frame/buildPassepartoutRectPhi";
import { buildFrameRectPocket, effectiveFrameLipMm } from "@/lib/relief/frame/buildFrameRectPocket";
import { resampleHeightmapFiltered } from "@/lib/relief/heightmapMesh";

export type HeightmapState = {
  normF32: Float32Array;
  w: number;
  h: number;
};

type FrameUI = {
  enabled: boolean;
  solidMm: number;
  frameHeightMm: number;
  glassMm: 2 | 3;
  glassClearanceMm: number;
  pocketDepthMm: number;
  lipMm: number;
  pocketRadialMm: number;
  cornerRadiusMm?: number;
  /** Gioco per lato tra rilievo e apertura cornice (mm) — solo assemblaggio separato */
  reliefGapMm?: number;
};

type MatUI = {
  enabled: boolean;
  steps: 1 | 2 | 3 | 4 | 5 | 6;
  totalBandsMm: number;
  minBandMm: number;
  thicknessMm: number;
  stepDropMm: number;
  matDropMm: number;
  reliefGapMm: number;
};

type Props = {
  hmState: HeightmapState | null;
  stlWidthMm: number;
  decimateStep: number;
  maxPreviewCells?: number;
  depthMm: number;
  baseMm: number;
  baseStyle: BaseStyle;

  // outputMode lo accettiamo anche qui
  outputMode?: string; // o il tipo reale che usi in ReliefWizard

  // cornice & mat
  frame?: FrameUI;
  mat?: MatUI;

  // posizionamento in profondità (Z, mm) di rilievo e passepartout
  reliefZmm?: number;
  matZmm?: number;

  // Alloggiamento vetro negativo a U, aperto superiormente.
  glassSlot?: { enabled: boolean; grooveDepthMm: number; slotThicknessMm: number };

  // colore di sfondo del viewport (default chiaro; lo Studio desktop lo passa scuro)
  bgColor?: string;

  // Colori configurabili dei materiali nella preview.
  colors?: { relief: string; frame: string; mat: string };

  // modalità wireframe (per ispezionare la geometria interna: battuta, vassoio, ecc.)
  wireframe?: boolean;

  // Veletta positiva che nasconde una strip LED.
  ledValance?: { enabled: boolean; widthMm: number; depthMm: number };
  onPreviewError?: (message: string) => void;
};

const SHOW_HELPERS = true;
const PREVIEW_MIRROR_Y_180 = false;
const BG_COLOR = "#f6f7fb";
// Compenetrazione (mm): rilievo/passepartout/cornice si sovrappongono per fondere in un solido stampabile.
const ASSEMBLY_OVERLAP = 3.0;
// Inset della cornice rispetto al perimetro del rilievo: piccolo = cornice "a filo"
// (entra di poco nel rilievo solo quel tanto che basta per fondersi, non lo copre).
const FRAME_INSET = 1.0;

function frameBackInnerSize(reliefSizeMm: number, matBandsMm: number, reliefGapMm = 0.3) {
  if (matBandsMm > 0) {
    return Math.max(1, reliefSizeMm + 2 * matBandsMm - 2 * ASSEMBLY_OVERLAP - 2 * FRAME_INSET);
  }
  // V8.4: senza passepartout l'anteprima mostra l'assemblaggio FISICO:
  // apertura = rilievo + gioco per lato (niente compenetrazione).
  // Il "morso" FRAME_INSET resta solo nell'export fuso, dove serve per saldare.
  return Math.max(1, reliefSizeMm + 2 * Math.max(0, reliefGapMm));
}

function toBufferGeometry(vertices: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function ReliefPreview3DScene({
  hmState,
  stlWidthMm,
  decimateStep,
  maxPreviewCells = 300_000,
  depthMm,
  baseMm,
  baseStyle,
  frame,
  mat,
  reliefZmm = 0,
  matZmm = 0,
  glassSlot,
  ledValance,
  bgColor = BG_COLOR,
  colors = { relief: "#2A6075", frame: "#2B2B2B", mat: "#E9E3D6" },
  wireframe = false,
  onPreviewError,
}: Props): JSX.Element {
  const solidGeometry = useMemo(() => {
    if (!hmState) return null;

    const manualFactor = Math.max(1, Math.floor(decimateStep || 1));
    const hm = resampleHeightmapFiltered(hmState, Math.max(4, Math.floor(maxPreviewCells / (manualFactor * manualFactor))));
    const { geometry } = buildSolidFromHeightmap({
      height01: hm.normF32,
      width: hm.w,
      height: hm.h,
      outWidthMm: Math.max(1, stlWidthMm),
      depthMm: Math.max(0, depthMm),
      baseMm: Math.max(0, baseMm),
      baseStyle,
      invert: false,
      clampHeights: true,
      minBaseMm: 0.4,
    });

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (bb) {
      const center = new THREE.Vector3();
      bb.getCenter(center);
      geometry.translate(-center.x, -bb.min.y, -center.z);
      geometry.computeBoundingBox();
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }, [hmState, stlWidthMm, decimateStep, maxPreviewCells, depthMm, baseMm, baseStyle]);

  const reliefTopY = useMemo(() => {
    if (!solidGeometry) return 0;
    solidGeometry.computeBoundingBox();
    const bb = solidGeometry.boundingBox;
    return bb ? bb.max.y : 0;
  }, [solidGeometry]);

  const reliefPlan = useMemo(() => {
    if (!hmState) return { w: Math.max(1, stlWidthMm), h: Math.max(1, stlWidthMm) };
    const w = Math.max(1, stlWidthMm);
    const h = w * (hmState.h / hmState.w);
    return { w, h };
  }, [hmState, stlWidthMm]);

  const matGeometry = useMemo(() => {
    if (!hmState) return null;
    if (!mat?.enabled) return null;
    const out = buildPassepartoutRectPhi({
      innerWmm: reliefPlan.w - 2 * ASSEMBLY_OVERLAP,
      innerHmm: reliefPlan.h - 2 * ASSEMBLY_OVERLAP,
      steps: mat.steps,
      totalBandsMm: mat.totalBandsMm,
      thicknessMm: mat.thicknessMm,
      stepDropMm: mat.stepDropMm,
      minBandMm: mat.minBandMm,
    });
    const vertices = (out as any)?.vertices ?? ((out as any)?.[0] as Float32Array | undefined);
    const indices = (out as any)?.indices ?? ((out as any)?.[1] as Uint32Array | undefined);
    if (!vertices || !indices) return null;
    return toBufferGeometry(vertices, indices);
  }, [hmState, mat, reliefPlan.w, reliefPlan.h]);

  // Cornice a vassoio (L-profile): apertura fronte stretta, vassoio retro più largo.
  // La battuta è il gradino strutturale tra le due aperture — non più una mesh separata.
  const frameGeometry = useMemo(() => {
    if (!hmState) return null;
    if (!frame?.enabled) return null;
    const matBands = mat?.enabled
      ? passepartoutOuterBandsMm({ steps: mat.steps, totalBandsMm: mat.totalBandsMm, minBandMm: mat.minBandMm })
      : 0;
    // Apertura RETRO (vassoio) = bordo esterno del passepartout meno un piccolo morso.
    // Il passepartout parte da reliefPlan - 2*ASSEMBLY_OVERLAP, quindi anche qui
    // dobbiamo includere ASSEMBLY_OVERLAP per non lasciare un gap quando la banda cresce.
    const backInnerW = frameBackInnerSize(reliefPlan.w, matBands, (frame as any).reliefGapMm);
    const backInnerH = frameBackInnerSize(reliefPlan.h, matBands, (frame as any).reliefGapMm);
    const out = buildFrameRectPocket({
      innerWmm: backInnerW,
      innerHmm: backInnerH,
      thicknessMm: frame.solidMm,
      heightMm: frame.frameHeightMm,
      pocketDepthMm: frame.pocketDepthMm,
      lipMm: effectiveFrameLipMm(frame.lipMm),
      cornerRadiusMm: frame.cornerRadiusMm ?? 0,
    });
    const vertices = (out as any)?.vertices ?? ((out as any)?.[0] as Float32Array | undefined);
    const indices = (out as any)?.indices ?? ((out as any)?.[1] as Uint32Array | undefined);
    if (!vertices || !indices) return null;
    return toBufferGeometry(vertices, indices);
  }, [hmState, frame, mat, reliefPlan.w, reliefPlan.h]);

  // Veletta LED: stesso anello positivo usato nell'export STL, sul fronte
  // interno della cornice. Prima il parametro arrivava alla preview ma non
  // veniva mai trasformato in geometria.
  const ledValanceGeometry = useMemo(() => {
    if (!hmState || !frame?.enabled || !ledValance?.enabled) return null;
    if (ledValance.widthMm <= 0 || ledValance.depthMm <= 0) return null;

    const matBands = mat?.enabled
      ? passepartoutOuterBandsMm({ steps: mat.steps, totalBandsMm: mat.totalBandsMm, minBandMm: mat.minBandMm })
      : 0;
    const frameInnerW = frameBackInnerSize(reliefPlan.w, matBands, (frame as any).reliefGapMm);
    const frameInnerH = frameBackInnerSize(reliefPlan.h, matBands, (frame as any).reliefGapMm);
    const rimW = Math.max(0.5, ledValance.widthMm);
    const rimD = Math.max(0.5, Math.min(ledValance.depthMm, frame.frameHeightMm - 0.5));
    const innerW = Math.max(1, frameInnerW - 2 * rimW);
    const innerH = Math.max(1, frameInnerH - 2 * rimW);
    const rOut = Math.max(0, (frame.cornerRadiusMm ?? 0) - frame.solidMm);

    const out = buildFrameRectPocket({
      innerWmm: innerW,
      innerHmm: innerH,
      thicknessMm: rimW,
      heightMm: rimD,
      pocketDepthMm: 0,
      lipMm: 0,
      cornerRadiusMm: rOut,
    });
    const vertices = (out as any)?.vertices ?? ((out as any)?.[0] as Float32Array | undefined);
    const indices = (out as any)?.indices ?? ((out as any)?.[1] as Uint32Array | undefined);
    if (!vertices || !indices) return null;
    return toBufferGeometry(vertices, indices);
  }, [hmState, frame, mat, ledValance, reliefPlan.w, reliefPlan.h]);

  useEffect(() => {
    return () => {
      solidGeometry?.dispose();
      matGeometry?.dispose();
      frameGeometry?.dispose();
      ledValanceGeometry?.dispose();
    };
  }, [solidGeometry, matGeometry, frameGeometry, ledValanceGeometry]);

  if (!hmState) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
        Carica un file per vedere il 3D.
      </div>
    );
  }
  if (!solidGeometry) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
        La preview 3D appare dopo la generazione della heightmap.
      </div>
    );
  }

  const width = Math.max(1, stlWidthMm);
  const camDist = Math.max(220, width * 1.6);
  const matDrop = mat?.enabled ? mat.matDropMm : 0;
  const reliefGap = mat?.enabled ? mat.reliefGapMm : 0;
  const matTopY = reliefTopY - matDrop;
  const reliefBaseY = matTopY + reliefGap;
  const groundY = -0.01;

  // --- Allineamento cornice/passepartout al rilievo ---
  // Il rilievo ha l'immagine sul piano XY (sta in piedi) e la profondità su Z.
  // Centro verticale del rilievo (Y) tenendo conto del render offset [0,1,0],
  // e piano frontale del rilievo (Z) per appoggiarci cornice e passepartout.
  const reliefCenterY = reliefTopY / 2 + 1;
  const reliefFrontZ = solidGeometry.boundingBox ? solidGeometry.boundingBox.max.z : 0;
  // Piano POSTERIORE del rilievo: il passepartout ci si appoggia (continuo, dietro).
  const reliefBackZ = solidGeometry.boundingBox ? solidGeometry.boundingBox.min.z : 0;

  // Rappresentazione del vetro (solo visiva): mostra dove andrà il vetro.
  // - Modalità vassoio: il vetro appoggia sul gradino di battuta (parete posteriore del bordo frontale della cornice).
  // - Modalità gola a U: il vetro infilato attraverso la fessura sui lati interni.
  const matBandsR = mat?.enabled
    ? passepartoutOuterBandsMm({ steps: mat.steps, totalBandsMm: mat.totalBandsMm, minBandMm: mat.minBandMm })
    : 0;
  const frameInnerWR = frameBackInnerSize(reliefPlan.w, matBandsR);
  const frameInnerHR = frameBackInnerSize(reliefPlan.h, matBandsR);
  const effLipR = frame?.enabled ? effectiveFrameLipMm(frame.lipMm) : 0;
  const hasPocket = !!(frame?.enabled && effLipR > 0 && frame.pocketDepthMm > 0);
  const glassThk = glassSlot?.enabled
    ? Math.max(1, glassSlot.slotThicknessMm)
    : (hasPocket ? frame!.glassMm : 2);
  // In modalità vassoio: il vetro entra dal fronte e appoggia sul gradino.
  // Altrimenti (gola o nessuna battuta): comportamento legacy a 0.8mm dal fronte.
  const glassZ = glassSlot?.enabled
    ? reliefFrontZ - 1.5 - glassThk / 2
    : (hasPocket
      ? reliefFrontZ - frame!.pocketDepthMm + glassThk / 2
      : reliefFrontZ - 0.8 - glassThk / 2);
  // La lastra deve essere più grande dell'apertura visibile per sovrapporsi alla
  // battuta; il gioco viene sottratto dal vassoio su ciascun lato.
  const glassClearance = frame?.enabled ? Math.max(0, frame.glassClearanceMm) : 0;
  const glassW = hasPocket ? Math.max(1, frameInnerWR - 2 * glassClearance) : Math.max(1, frameInnerWR);
  const glassH = hasPocket ? Math.max(1, frameInnerHR - 2 * glassClearance) : Math.max(1, frameInnerHR);
  const showGlass = !!frame?.enabled && (hasPocket || !!glassSlot?.enabled);

  return (
    <div style={{ width: "100%", height: "100%", background: bgColor }}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        frameloop="demand"
        camera={{ position: [0, camDist * 0.55, camDist], fov: 38, near: 0.1, far: 20000 }}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.94;
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onPreviewError?.("Il renderer 3D ha esaurito le risorse. La preview è stata alleggerita: usa Bilanciato o Fine V8.3.");
          }, { once: true });
        }}
      >
        <color attach="background" args={[bgColor]} />
        <Environment preset="studio" />
        <ambientLight intensity={0.14} />
        <directionalLight
          position={[420, 680, 380]}
          intensity={1.35}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={1}
          shadow-camera-far={4000}
          shadow-bias={-0.00015}
        />
        <directionalLight position={[-380, 260, -260]} intensity={0.65} />
        {/* Luci radenti: rivelano i dettagli del rilievo e i gradini del passepartout */}
        <directionalLight position={[420, 120, 520]} intensity={0.85} />
        <directionalLight position={[-420, 120, 520]} intensity={0.5} />

        {SHOW_HELPERS && (
          <>
            <Grid
              position={[0, groundY, 0]}
              infiniteGrid
              fadeDistance={1400}
              fadeStrength={2.5}
              cellSize={10}
              sectionSize={50}
            />
            <axesHelper args={[Math.max(60, stlWidthMm * 0.7)]} />
          </>
        )}

        <group>
          {matGeometry && (
            <mesh
              geometry={matGeometry}
              position={[0, reliefCenterY, reliefBackZ + reliefZmm + ASSEMBLY_OVERLAP + matZmm]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color={colors.mat}
                roughness={0.85}
                metalness={0.0}
                clearcoat={0.0}
                envMapIntensity={0.9}
                side={THREE.DoubleSide}
                wireframe={wireframe}
              />
            </mesh>
          )}

  
  <mesh
  geometry={solidGeometry}
  position={[0, 1, reliefZmm]}   // ✅ incrocio assi griglia + offset profondità
  rotation={PREVIEW_MIRROR_Y_180 ? [0, Math.PI, 0] : [0, 0, 0]}
  castShadow
  receiveShadow
>


            <meshPhysicalMaterial
              color={colors.relief}
              roughness={0.76}
              metalness={0.0}
              clearcoat={0.0}
              envMapIntensity={0.48}
              wireframe={wireframe}
            />
          </mesh>

          {frameGeometry && (
            <mesh
              geometry={frameGeometry}
              position={[0, reliefCenterY, reliefFrontZ]}
              rotation={[-Math.PI / 2, 0, 0]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color={colors.frame}
                roughness={0.55}
                metalness={0.05}
                clearcoat={0.15}
                clearcoatRoughness={0.75}
                envMapIntensity={1.1}
                side={THREE.DoubleSide}
                wireframe={wireframe}
              />
            </mesh>
          )}

          {ledValanceGeometry && (
            <mesh
              geometry={ledValanceGeometry}
              position={[0, reliefCenterY, reliefFrontZ]}
              rotation={[-Math.PI / 2, 0, 0]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color={colors.frame}
                roughness={0.55}
                metalness={0.05}
                clearcoat={0.15}
                clearcoatRoughness={0.75}
                envMapIntensity={1.1}
                side={THREE.DoubleSide}
                wireframe={wireframe}
              />
            </mesh>
          )}

          {showGlass && (
            <mesh position={[0, reliefCenterY, glassZ]}>
              <boxGeometry args={[glassW, glassH, glassThk]} />
              <meshPhysicalMaterial
                color={"#bcd6e6"}
                transparent
                opacity={0.25}
                roughness={0.05}
                metalness={0}
                transmission={0.6}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
        </group>

        <ContactShadows
          key={`${solidGeometry.uuid}-${frameGeometry?.uuid ?? "no-frame"}`}
          position={[0, groundY, 0]}
          scale={Math.max(260, stlWidthMm * 2.4)}
          opacity={0.38}
          blur={2.9}
          far={Math.max(260, stlWidthMm * 2.4)}
          frames={1}
        />

        <OrbitControls
  makeDefault
  // target dinamico centrato sulla mesh
  target={[0, reliefTopY * 0.5, 0]}
  enableDamping
  dampingFactor={0.08}
  enablePan={true}       // abilita pan per muovere il centro
  minPolarAngle={0.15}
  maxPolarAngle={Math.PI * 0.9}
/>
      </Canvas>
    </div>
  );
}

type PreviewBoundaryState = { error: string | null };

class PreviewErrorBoundary extends React.Component<{
  children: React.ReactNode;
  resetKey: string;
  onError?: (message: string) => void;
}, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewBoundaryState {
    return { error: error.message || "Errore renderer 3D" };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error.message || "Errore renderer 3D");
  }

  componentDidUpdate(previous: Readonly<{ children: React.ReactNode; resetKey: string; onError?: (message: string) => void }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-gray-400">
          <strong className="text-gray-200">Preview 3D sospesa</strong>
          <span>{this.state.error}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function ReliefPreview3D(props: Props): JSX.Element {
  const resetKey = `${props.hmState?.w ?? 0}x${props.hmState?.h ?? 0}-${props.maxPreviewCells ?? 0}-${props.decimateStep}`;
  return (
    <PreviewErrorBoundary resetKey={resetKey} onError={props.onPreviewError}>
      <ReliefPreview3DScene {...props} />
    </PreviewErrorBoundary>
  );
}

export default React.memo(ReliefPreview3D);
