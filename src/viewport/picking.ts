import type { VoxelGrid } from '../core/voxelGrid'
import type { Vec3 } from '../core/types'

export interface Hit {
  kind: 'voxel' | 'floor'
  /** Existing voxel for voxel hits, floor cell otherwise. */
  cell: Vec3
  /** Cell where a new voxel would be added. */
  place: Vec3
  normal: Vec3
}

export interface Ray { origin: Vec3; dir: Vec3 }

export function pickVoxel(grid: VoxelGrid, ray: Ray, pickable: (layer: number) => boolean): Hit | null {
  const o = ray.origin
  const d = ray.dir
  const b = grid.bounds

  // Clip the ray against the grid box (slab method).
  let tmin = 0
  let tmax = Infinity
  let entryAxis = -1
  let entrySign = 0
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < 0 || o[a] > b[a]) return floorHit(grid, ray)
      continue
    }
    let t0 = (0 - o[a]) / d[a]
    let t1 = (b[a] - o[a]) / d[a]
    const sign = d[a] > 0 ? -1 : 1
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t }
    if (t0 > tmin) { tmin = t0; entryAxis = a; entrySign = sign }
    if (t1 < tmax) tmax = t1
    if (tmin > tmax) return floorHit(grid, ray)
  }
  if (tmax < 0) return floorHit(grid, ray)

  const eps = 1e-5
  const px = o[0] + d[0] * (tmin + eps)
  const py = o[1] + d[1] * (tmin + eps)
  const pz = o[2] + d[2] * (tmin + eps)
  const c: Vec3 = [
    Math.min(b[0] - 1, Math.max(0, Math.floor(px))),
    Math.min(b[1] - 1, Math.max(0, Math.floor(py))),
    Math.min(b[2] - 1, Math.max(0, Math.floor(pz))),
  ]
  const step: Vec3 = [d[0] > 0 ? 1 : -1, d[1] > 0 ? 1 : -1, d[2] > 0 ? 1 : -1]
  const tDelta: Vec3 = [
    Math.abs(d[0]) < 1e-9 ? Infinity : Math.abs(1 / d[0]),
    Math.abs(d[1]) < 1e-9 ? Infinity : Math.abs(1 / d[1]),
    Math.abs(d[2]) < 1e-9 ? Infinity : Math.abs(1 / d[2]),
  ]
  const tMax: Vec3 = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    tMax[a] = Math.abs(d[a]) < 1e-9 ? Infinity : ((step[a] > 0 ? c[a] + 1 : c[a]) - o[a]) / d[a]
  }

  let normal: Vec3 = [0, 0, 0]
  if (entryAxis >= 0) normal[entryAxis] = entrySign
  else {
    let m = 0
    for (let a = 1; a < 3; a++) if (Math.abs(d[a]) > Math.abs(d[m])) m = a
    normal[m] = -step[m]
  }

  const maxSteps = b[0] + b[1] + b[2] + 3
  for (let i = 0; i < maxSteps; i++) {
    if (grid.has(c[0], c[1], c[2]) && pickable(grid.getLayer(c[0], c[1], c[2]))) {
      return {
        kind: 'voxel',
        cell: [c[0], c[1], c[2]],
        place: [c[0] + normal[0], c[1] + normal[1], c[2] + normal[2]],
        normal,
      }
    }
    let a = 0
    if (tMax[1] < tMax[a]) a = 1
    if (tMax[2] < tMax[a]) a = 2
    c[a] += step[a]
    if (c[a] < 0 || c[a] >= b[a]) break
    tMax[a] += tDelta[a]
    normal = [0, 0, 0]
    normal[a] = -step[a]
  }
  return floorHit(grid, ray)
}

function floorHit(grid: VoxelGrid, ray: Ray): Hit | null {
  const { origin: o, dir: d } = ray
  if (o[1] <= 0 || d[1] >= -1e-9) return null
  const t = -o[1] / d[1]
  const x = Math.floor(o[0] + d[0] * t)
  const z = Math.floor(o[2] + d[2] * t)
  if (x < 0 || z < 0 || x >= grid.bounds[0] || z >= grid.bounds[2]) return null
  return { kind: 'floor', cell: [x, 0, z], place: [x, 0, z], normal: [0, 1, 0] }
}

/** Intersects the ray with the mid-plane of slab `value` on `axis` and returns the containing cell. */
export function planeCell(grid: VoxelGrid, ray: Ray, axis: number, value: number): Vec3 | null {
  const { origin: o, dir: d } = ray
  if (Math.abs(d[axis]) < 1e-9) return null
  const t = (value + 0.5 - o[axis]) / d[axis]
  if (t < 0) return null
  const cell: Vec3 = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    const v = a === axis ? value : Math.floor(o[a] + d[a] * t)
    cell[a] = Math.max(0, Math.min(grid.bounds[a] - 1, v))
  }
  return cell
}
