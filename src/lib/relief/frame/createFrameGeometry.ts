import * as THREE from "three";

export type FrameParams = {
  outerWidth: number;
  outerHeight: number;
  frameThickness: number;
  depth: number;
};

export function createFrameGeometry(params: FrameParams): THREE.BufferGeometry {
  const { outerWidth, outerHeight, frameThickness, depth } = params;

  if (outerWidth <= 0 || outerHeight <= 0 || depth <= 0) {
    throw new Error("Frame: outerWidth/outerHeight/depth devono essere > 0");
  }
  if (frameThickness <= 0) {
    throw new Error("Frame: frameThickness deve essere > 0");
  }
  if (frameThickness * 2 >= outerWidth || frameThickness * 2 >= outerHeight) {
    throw new Error("Frame: frameThickness troppo grande rispetto alle dimensioni esterne");
  }

  const parts: THREE.BufferGeometry[] = [];

  const makeBar = (w: number, h: number, x: number, y: number) => {
    const g = new THREE.BoxGeometry(w, h, depth);
    g.translate(x, y, depth / 2);
    return g;
  };

  parts.push(makeBar(outerWidth, frameThickness, 0, (outerHeight - frameThickness) / 2));
  parts.push(makeBar(outerWidth, frameThickness, 0, -(outerHeight - frameThickness) / 2));
  parts.push(
    makeBar(frameThickness, outerHeight - 2 * frameThickness, -(outerWidth - frameThickness) / 2, 0)
  );
  parts.push(
    makeBar(frameThickness, outerHeight - 2 * frameThickness, (outerWidth - frameThickness) / 2, 0)
  );

  return mergeBufferGeometries(parts);
}

function mergeBufferGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  let vertexOffset = 0;

  for (const g of geoms) {
    const posAttr = g.getAttribute("position") as THREE.BufferAttribute;
    const norAttr = g.getAttribute("normal") as THREE.BufferAttribute;
    const idxAttr = g.getIndex();

    if (!posAttr || !norAttr || !idxAttr) {
      throw new Error("mergeBufferGeometries: geometry senza position/normal/index");
    }

    for (let i = 0; i < posAttr.array.length; i++) positions.push(posAttr.array[i] as number);
    for (let i = 0; i < norAttr.array.length; i++) normals.push(norAttr.array[i] as number);

    for (let i = 0; i < idxAttr.array.length; i++) {
      indices.push((idxAttr.array[i] as number) + vertexOffset);
    }

    vertexOffset += posAttr.count;
  }

  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);

  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  return merged;
}
