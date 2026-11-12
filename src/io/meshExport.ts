import { LayerInfo } from '../core/layers'
import type { Layer, Vec3 } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { rgb } from '../core/color'
import { FACE_DIRS, FACE_VERTS, visitFaces } from '../viewport/mesher'

export interface ExportMesh {
  quadCount: number
  /** 12 floats per quad. */
  positions: Float32Array
  /** One face index (0-5) per quad. */
  faces: Uint8Array
  /** rgb + alpha (0-255), sRGB, one per quad. */
  colors: Uint8Array
  layers: Uint16Array
  /** Position that was subtracted from every vertex (before scaling). */
  origin: Vec3
  scale: number
  hasAlpha: boolean
}

export interface MeshOptions {
  scope: 'all' | 'layer'
  scale: number
  /** Centre on X/Z and sit on Y=0. */
  center: boolean
}

export function modelOrigin(grid: VoxelGrid, layers: Layer[], center: boolean): Vec3 {
  if (!center) return [0, 0, 0]
  const info = new LayerInfo(layers)
  const box = grid.bbox((l) => info.visible(l))
  if (!box) return [0, 0, 0]
  return [(box.min[0] + box.max[0] + 1) / 2, box.min[1], (box.min[2] + box.max[2] + 1) / 2]
}

export function buildExportMesh(grid: VoxelGrid, layers: Layer[], opts: MeshOptions): ExportMesh {
  const info = new LayerInfo(layers)
  const origin = modelOrigin(grid, layers, opts.center)
  const pos: number[] = []
  const faces: number[] = []
  const colors: number[] = []
  const layerIds: number[] = []
  let hasAlpha = false

  visitFaces(grid, null, { info, scope: opts.scope }, (x, y, z, f, color, layer, _mat, alpha) => {
    const v = FACE_VERTS[f]
    for (let k = 0; k < 4; k++) {
      pos.push(
        (x + v[k * 3] - origin[0]) * opts.scale,
        (y + v[k * 3 + 1] - origin[1]) * opts.scale,
        (z + v[k * 3 + 2] - origin[2]) * opts.scale,
      )
    }
    faces.push(f)
    const [r, g, b] = rgb(color)
    if (alpha < 1) hasAlpha = true
    colors.push(r, g, b, Math.round(alpha * 255))
    layerIds.push(layer)
  })

  return {
    quadCount: faces.length,
    positions: new Float32Array(pos),
    faces: new Uint8Array(faces),
    colors: new Uint8Array(colors),
    layers: new Uint16Array(layerIds),
    origin,
    scale: opts.scale,
    hasAlpha,
  }
}

export { FACE_DIRS }
