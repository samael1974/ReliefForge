import * as THREE from "three";

export function toThreeGeometry(vertices: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}