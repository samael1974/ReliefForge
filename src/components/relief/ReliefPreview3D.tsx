// src/components/relief/ReliefPreview3D.tsx
import React, { useMemo, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment, Grid } from "@react-three/drei";
import * as THREE from "three";

import { buildSolidFromHeightmap } from "@/lib/relief/buildSolidFromHeightmap";
import { buildAdaptiveSolidFromHeightmap } from "@/lib/relief/buildAdaptiveSolid";
import type { BaseStyle } from "@/lib/relief/reliefTypes";
import { buildPassepartoutRectPhi } from "@/lib/relief/frame/buildPassepartoutRectPhi";
import { buildFrameRectPocket } from "@/lib/relief/frame/buildFrameRectPocket";
import { computeAssemblyLayout, type AssemblyLayout } from "@/lib/relief/frame/assemblyLayout";

/** Segnaposto per la mesh del rilievo nei progetti di sola cornice: non disegna nulla. */
const EMPTY_GEOMETRY = new THREE.BufferGeometry();
import { resampleHeightmapFiltered } from "@/lib/relief/heightmapMesh";
import { makeMatcapTexture } from "@/lib/relief/render/makeMatcap";

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
  /** @deprecated Non usato da nessuna geometria. Resta nel tipo perche' lo passa
   *  ancora ReliefWizard (web, congelato alla 8.1). Da togliere insieme al wizard. */
  pocketRadialMm: number;
  cornerRadiusMm?: number;
  /** Battuta vetro frontale: larghezza radiale del labbro e suo spessore. */
  glassSeatMm?: number;
  glassSeatDepthMm?: number;
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
  /** @deprecated Non usato da nessuna geometria (vedi pocketRadialMm). */
  matDropMm: number;
  /** @deprecated Non usato: il gioco del passepartout e' MAT_OVERLAP in assemblyLayout. */
  reliefGapMm: number;
};

type Props = {
  hmState: HeightmapState | null;
  stlWidthMm: number;
  /** Altezza dell'apertura in mm quando non c'e' rilievo (progetto di sola cornice). */
  openingHeightMm?: number;
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

  /** true = mostra l'assieme SALDATO (quello che produce l'export fuso).
   *  false = mostra i pezzi separati (quello che produce l'export "solo cornice").
   *  V8.5: e' l'interruttore che rende l'anteprima fedele all'export scelto. */
  welded?: boolean;
  /** Riporta al genitore le quote derivate, per mostrarle in UI. */
  onLayout?: (layout: AssemblyLayout) => void;

  /** V8.5 — resa del viewport. "gesso" = materiale opaco + luce radente, per
   *  GIUDICARE il rilievo (e' come si valuta un bassorilievo dal vero).
   *  "studio" = resa lucida, per presentare il pezzo. */
  renderStyle?: "gesso" | "studio" | "matcap";
  /** V8.5 — azimut della luce chiave, in gradi. La luce radente rivela incisioni
   *  che con l'illuminazione frontale sono invisibili. */
  keyLightDeg?: number;

  /** V8.5 — tolleranza (mm) del mesher adattivo. 0/assente = griglia uniforme.
   *  Passando la STESSA tolleranza dell'export, l'anteprima mostra esattamente la
   *  mesh che verra' esportata, e il viewport regge 30-100x meno triangoli. */
  toleranceMm?: number;
};

const SHOW_HELPERS = true;
const PREVIEW_MIRROR_Y_180 = false;
const BG_COLOR = "#f6f7fb";

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
  openingHeightMm,
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
  welded = true,
  onLayout,
  toleranceMm = 0,
  renderStyle = "gesso",
  keyLightDeg = 35,
}: Props): JSX.Element {
  const solidGeometry = useMemo(() => {
    if (!hmState) return null;

    const manualFactor = Math.max(1, Math.floor(decimateStep || 1));
    const common = {
      outWidthMm: Math.max(1, stlWidthMm),
      depthMm: Math.max(0, depthMm),
      baseMm: Math.max(0, baseMm),
      baseStyle,
      invert: false,
      clampHeights: true,
      minBaseMm: 0.4,
    };
    // V8.5: con l'adattivo l'anteprima usa lo STESSO mesher dell'export, alla stessa
    // tolleranza -> quello che vedi e' la mesh che esporti, non un'approssimazione.
    const geometry = toleranceMm > 0 && manualFactor === 1
      ? buildAdaptiveSolidFromHeightmap({
          height01: hmState.normF32, width: hmState.w, height: hmState.h,
          toleranceMm, ...common,
        }).geometry
      : (() => {
          const hm = resampleHeightmapFiltered(hmState, Math.max(4, Math.floor(maxPreviewCells / (manualFactor * manualFactor))));
          return buildSolidFromHeightmap({ height01: hm.normF32, width: hm.w, height: hm.h, ...common }).geometry;
        })();

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
  }, [hmState, stlWidthMm, decimateStep, maxPreviewCells, depthMm, baseMm, baseStyle, toleranceMm]);

  const reliefTopY = useMemo(() => {
    if (!solidGeometry) return 0;
    solidGeometry.computeBoundingBox();
    const bb = solidGeometry.boundingBox;
    return bb ? bb.max.y : 0;
  }, [solidGeometry]);

  const reliefPlan = useMemo(() => {
    // Senza rilievo l'impronta la detta l'apertura dichiarata: e' il progetto di
    // sola cornice. Il quadrato resta solo come ultimo ripiego.
    if (!hmState) return { w: Math.max(1, stlWidthMm), h: Math.max(1, openingHeightMm ?? stlWidthMm) };
    const w = Math.max(1, stlWidthMm);
    // Stessa formula di buildSolidFromHeightmap (segmenti, non pixel).
    const h = w * ((hmState.h - 1) / (hmState.w - 1));
    return { w, h };
  }, [hmState, stlWidthMm, openingHeightMm]);

  /** Spessore Z reale del solido rilievo, letto dalla geometria costruita. */
  const reliefThicknessMm = useMemo(() => {
    const bb = solidGeometry?.boundingBox;
    return bb ? bb.max.z - bb.min.z : Math.max(0.4, baseMm) + Math.max(0, depthMm);
  }, [solidGeometry, baseMm, depthMm]);

  // V8.5: STESSA funzione usata dall'export. Anteprima ed export non possono piu' divergere.
  const layout = useMemo(() => computeAssemblyLayout({
    reliefW: reliefPlan.w,
    reliefH: reliefPlan.h,
    reliefThicknessMm,
    reliefYOffset: 1,
    reliefZmm,
    matZmm,
    frame: frame?.enabled ? {
      solidMm: frame.solidMm,
      frameHeightMm: frame.frameHeightMm,
      lipMm: frame.lipMm,
      pocketDepthMm: frame.pocketDepthMm,
      cornerRadiusMm: frame.cornerRadiusMm,
      reliefGapMm: frame.reliefGapMm,
      glassMm: frame.glassMm,
      glassClearanceMm: frame.glassClearanceMm,
    } : null,
    mat: mat?.enabled ? {
      steps: mat.steps,
      totalBandsMm: mat.totalBandsMm,
      minBandMm: mat.minBandMm,
      thicknessMm: mat.thicknessMm,
      stepDropMm: mat.stepDropMm,
    } : null,
    welded,
  }), [reliefPlan.w, reliefPlan.h, reliefThicknessMm, reliefZmm, matZmm, frame, mat, welded]);

  useEffect(() => { onLayout?.(layout); }, [layout, onLayout]);

  // Matcap: l'ombreggiatura dipende SOLO dalla normale in spazio-camera, quindi la
  // luce resta ferma mentre ruoti il pezzo e si giudica la forma. Lo slider della
  // luce ruota il riflesso dentro la texture invece di muovere una lampada.
  const matcap = useMemo(
    () => (renderStyle === "matcap" ? makeMatcapTexture({ lightDeg: keyLightDeg, metallic: 0.8 }) : null),
    [renderStyle, keyLightDeg]
  );
  useEffect(() => () => { matcap?.dispose(); }, [matcap]);

  const matGeometry = useMemo(() => {
    if (!mat?.enabled) return null;
    if (layout.matInnerW === null || layout.matInnerH === null) return null;
    const out = buildPassepartoutRectPhi({
      innerWmm: layout.matInnerW,
      innerHmm: layout.matInnerH,
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
  }, [hmState, mat, layout.matInnerW, layout.matInnerH]);

  // Cornice a vassoio (L-profile): apertura fronte stretta, vassoio retro più largo.
  // La battuta è il gradino strutturale tra le due aperture — non più una mesh separata.
  const frameGeometry = useMemo(() => {
    if (!frame?.enabled) return null;
    const out = buildFrameRectPocket({
      innerWmm: layout.framePocketW,
      innerHmm: layout.framePocketH,
      thicknessMm: frame.solidMm,
      heightMm: frame.frameHeightMm,
      pocketDepthMm: layout.effectivePocketDepthMm,
      lipMm: layout.effectiveLipMm,
      cornerRadiusMm: frame.cornerRadiusMm ?? 0,
      glassSeatMm: frame.glassSeatMm ?? 0,
      glassSeatDepthMm: frame.glassSeatDepthMm ?? 0,
    });
    const vertices = (out as any)?.vertices ?? ((out as any)?.[0] as Float32Array | undefined);
    const indices = (out as any)?.indices ?? ((out as any)?.[1] as Uint32Array | undefined);
    if (!vertices || !indices) return null;
    return toBufferGeometry(vertices, indices);
  }, [hmState, frame, layout.framePocketW, layout.framePocketH, layout.effectivePocketDepthMm, layout.effectiveLipMm]);

  // Veletta LED: stesso anello positivo usato nell'export STL, sul fronte
  // interno della cornice. Prima il parametro arrivava alla preview ma non
  // veniva mai trasformato in geometria.
  const ledValanceGeometry = useMemo(() => {
    if (!frame?.enabled || !ledValance?.enabled) return null;
    if (ledValance.widthMm <= 0 || ledValance.depthMm <= 0) return null;

    const frameInnerW = layout.framePocketW;
    const frameInnerH = layout.framePocketH;
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
  }, [hmState, frame, ledValance, layout.framePocketW, layout.framePocketH]);

  useEffect(() => {
    return () => {
      solidGeometry?.dispose();
      matGeometry?.dispose();
      frameGeometry?.dispose();
      ledValanceGeometry?.dispose();
    };
  }, [solidGeometry, matGeometry, frameGeometry, ledValanceGeometry]);

  // Un progetto puo' contenere solo la cornice: in quel caso non c'e' heightmap e
  // non c'e' solidGeometry, ma c'e' comunque qualcosa da mostrare.
  const hasFrameOrMat = !!frame?.enabled || !!mat?.enabled;
  if (!hmState && !hasFrameOrMat) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
        Carica un file, oppure attiva la cornice per un progetto di sola cornice.
      </div>
    );
  }
  if (!solidGeometry && !hasFrameOrMat) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
        La preview 3D appare dopo la generazione della heightmap.
      </div>
    );
  }

  const width = Math.max(1, stlWidthMm);
  const camDist = Math.max(220, width * 1.6);
  const groundY = -0.01;

  // --- Allineamento cornice/passepartout al rilievo ---
  // Tutte le quote vengono dal layout condiviso con l'export: qui non si ricalcola nulla.
  const reliefCenterY = layout.centerY;

  // Rappresentazione del vetro (solo visiva).
  // - Modalità vassoio: il vetro appoggia sul gradino di battuta.
  // - Modalità gola a U: il vetro infilato attraverso la fessura sui lati interni.
  const glassThk = glassSlot?.enabled ? Math.max(1, glassSlot.slotThicknessMm) : layout.glassThkMm;
  const glassZ = glassSlot?.enabled
    ? layout.frameFrontZ - 1.5 - glassThk / 2
    : layout.glassZ;
  const glassW = layout.glassW;
  const glassH = layout.glassH;
  const showGlass = !!frame?.enabled && (layout.showGlass || !!glassSlot?.enabled);

  // Resa "gesso": materiale opaco e luce quasi tangente. E' la condizione in cui
  // si giudica un bassorilievo: le incisioni proiettano micro-ombre invece di
  // essere annegate nei riflessi speculari.
  const clay = renderStyle !== "studio"; // matcap ignora le luci, ma tiene l'ambiente basso
  const keyRad = (keyLightDeg * Math.PI) / 180;
  const keyDist = Math.max(400, width * 4);
  const keyPos: [number, number, number] = [
    Math.cos(keyRad) * keyDist,
    Math.sin(keyRad) * keyDist * 0.55 + width * 0.4,
    Math.abs(Math.sin(keyRad)) * keyDist * 0.35 + width * 1.2,
  ];
  const reliefMat = clay
    ? { roughness: 0.98, metalness: 0.0, clearcoat: 0.0, envMapIntensity: 0.18 }
    : { roughness: 0.76, metalness: 0.0, clearcoat: 0.0, envMapIntensity: 0.48 };
  const frameMat = clay
    ? { roughness: 0.9, metalness: 0.0, clearcoat: 0.0, clearcoatRoughness: 1, envMapIntensity: 0.25 }
    : { roughness: 0.55, metalness: 0.05, clearcoat: 0.15, clearcoatRoughness: 0.75, envMapIntensity: 1.1 };

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
            onPreviewError?.("Il renderer 3D ha esaurito le risorse. La preview è stata alleggerita: passa a Bilanciato o Fine.");
          }, { once: true });
        }}
      >
        <color attach="background" args={[bgColor]} />
        <Environment preset="studio" environmentIntensity={clay ? 0.35 : 1} />
        <ambientLight intensity={clay ? 0.22 : 0.14} />
        {/* Luce CHIAVE radente: e' l'inclinazione, non l'intensita', a rendere
            leggibile un bassorilievo. L'azimut e' comandato dalla UI. */}
        <directionalLight
          position={keyPos}
          intensity={clay ? 2.1 : 1.35}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={1}
          shadow-camera-far={4000}
          shadow-bias={-0.00015}
        />
        {/* Riempimento opposto, tenue: apre le ombre senza cancellare il rilievo. */}
        <directionalLight position={[-keyPos[0], keyPos[1] * 0.5, -keyPos[2] * 0.4]} intensity={clay ? 0.28 : 0.65} />
        {!clay && <directionalLight position={[420, 120, 520]} intensity={0.85} />}
        {!clay && <directionalLight position={[-420, 120, 520]} intensity={0.5} />}

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
              position={[0, reliefCenterY, layout.matFrontZ ?? 0]}
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
  geometry={solidGeometry ?? EMPTY_GEOMETRY}
  position={[0, 1, reliefZmm]}   // ✅ incrocio assi griglia + offset profondità
  rotation={PREVIEW_MIRROR_Y_180 ? [0, Math.PI, 0] : [0, 0, 0]}
  castShadow
  receiveShadow
>


            {matcap ? (
              <meshMatcapMaterial matcap={matcap} color={colors.relief} wireframe={wireframe} />
            ) : (
              <meshPhysicalMaterial
                color={colors.relief}
                roughness={reliefMat.roughness}
                metalness={reliefMat.metalness}
                clearcoat={reliefMat.clearcoat}
                envMapIntensity={reliefMat.envMapIntensity}
                wireframe={wireframe}
              />
            )}
          </mesh>

          {frameGeometry && (
            <mesh
              geometry={frameGeometry}
              position={[0, reliefCenterY, layout.frameFrontZ]}
              rotation={[-Math.PI / 2, 0, 0]}
              castShadow
              receiveShadow
            >
              {matcap ? (
                <meshMatcapMaterial matcap={matcap} color={colors.frame} side={THREE.DoubleSide} wireframe={wireframe} />
              ) : (
                <meshPhysicalMaterial
                  color={colors.frame}
                  roughness={frameMat.roughness}
                  metalness={frameMat.metalness}
                  clearcoat={frameMat.clearcoat}
                  clearcoatRoughness={frameMat.clearcoatRoughness}
                  envMapIntensity={frameMat.envMapIntensity}
                  side={THREE.DoubleSide}
                  wireframe={wireframe}
                />
              )}
            </mesh>
          )}

          {ledValanceGeometry && (
            <mesh
              geometry={ledValanceGeometry}
              position={[0, reliefCenterY, layout.frameFrontZ]}
              rotation={[-Math.PI / 2, 0, 0]}
              castShadow
              receiveShadow
            >
              {matcap ? (
                <meshMatcapMaterial matcap={matcap} color={colors.frame} side={THREE.DoubleSide} wireframe={wireframe} />
              ) : (
                <meshPhysicalMaterial
                  color={colors.frame}
                  roughness={frameMat.roughness}
                  metalness={frameMat.metalness}
                  clearcoat={frameMat.clearcoat}
                  clearcoatRoughness={frameMat.clearcoatRoughness}
                  envMapIntensity={frameMat.envMapIntensity}
                  side={THREE.DoubleSide}
                  wireframe={wireframe}
                />
              )}
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
          key={`${solidGeometry?.uuid ?? "no-relief"}-${frameGeometry?.uuid ?? "no-frame"}`}
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
