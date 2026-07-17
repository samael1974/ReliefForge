// src/lib/relief/cutout.ts
import * as THREE from "three";

/**
 * MVP SAFE (NO-OP)
 * Per ora NON facciamo CSG: la dipendenza "three-bvh-csg" non è disponibile.
 * Questa funzione lascia invariata la geometria così la build torna verde.
 */
export function applyCutoutToFlatGeometry(
  geom: THREE.BufferGeometry,
  _args?: unknown
): THREE.BufferGeometry {
  return geom;
}