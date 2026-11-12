import type { Vec3 } from './types'
import { unpackX, unpackY, unpackZ } from './voxelGrid'

export interface Box { min: Vec3; max: Vec3 }

export function cellsBox(cells: Iterable<number>): Box | null {
  let any = false
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of cells) {
    any = true
    const x = unpackX(p), y = unpackY(p), z = unpackZ(p)
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
  }
  return any ? { min, max } : null
}

export type Mapper = (x: number, y: number, z: number) => Vec3

/** Rotates by 90 degrees around the box centre. dir is +1 or -1 (right-handed). */
export function rotationMapper(box: Box, axis: 0 | 1 | 2, dir: 1 | -1): Mapper {
  const dx = box.max[0] - box.min[0] + 1
  const dy = box.max[1] - box.min[1] + 1
  const dz = box.max[2] - box.min[2] + 1
  const dims: Vec3 = [dx, dy, dz]
  const newDims: Vec3 = [...dims]
  const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1]
  newDims[a] = dims[b]
  newDims[b] = dims[a]
  const center: Vec3 = [box.min[0] + dx / 2, box.min[1] + dy / 2, box.min[2] + dz / 2]
  const newMin: Vec3 = [
    Math.round(center[0] - newDims[0] / 2),
    Math.round(center[1] - newDims[1] / 2),
    Math.round(center[2] - newDims[2] / 2),
  ]
  return (x, y, z) => {
    const rel: Vec3 = [x - box.min[0], y - box.min[1], z - box.min[2]]
    const out: Vec3 = [...rel]
    // Rotating (a, b) by +90 degrees gives a' = -b, b' = a for the cyclic axis order.
    if (dir === 1) {
      out[a] = dims[b] - 1 - rel[b]
      out[b] = rel[a]
    } else {
      out[a] = rel[b]
      out[b] = dims[a] - 1 - rel[a]
    }
    return [newMin[0] + out[0], newMin[1] + out[1], newMin[2] + out[2]]
  }
}

export function flipMapper(box: Box, axis: 0 | 1 | 2): Mapper {
  const sum = box.min[axis] + box.max[axis]
  return (x, y, z) => {
    const p: Vec3 = [x, y, z]
    p[axis] = sum - p[axis]
    return p
  }
}
