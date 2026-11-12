import * as THREE from 'three'
import type { Chunk, VoxelGrid } from '../core/voxelGrid'
import { localIndex } from '../core/voxelGrid'
import type { LayerInfo } from '../core/layers'
import { rgb, srgbToLinear } from '../core/color'

export const FACE_DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
]

// Four corners per face, counter-clockwise when seen from outside.
export const FACE_VERTS: number[][] = [
  [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0],
]

export interface FaceContext {
  info: LayerInfo
  /** 'layer' ignores neighbours from other layers so layers can move independently. */
  scope: 'all' | 'layer'
}

export function materialAlpha(info: LayerInfo, layer: number, mat: number): number {
  const op = info.opacity(layer)
  return mat === 2 ? Math.min(op, 0.5) : op
}

/** Linear-space vertex color including the material tint. */
export function vertexColor(color: number, mat: number): [number, number, number] {
  const [r, g, b] = rgb(color)
  let lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b)
  if (mat === 1) {
    const gray = (lr + lg + lb) / 3
    lr = (lr * 0.8 + gray * 0.2) * 0.85
    lg = (lg * 0.8 + gray * 0.2) * 0.85
    lb = (lb * 0.8 + gray * 0.2) * 0.85
  } else if (mat === 3) {
    lr *= 1.5
    lg *= 1.5
    lb *= 1.5
  }
  return [lr, lg, lb]
}

function faceVisible(
  ctx: FaceContext, alpha: number, layer: number, nraw: number, nlayer: number, nmat: number,
): boolean {
  if (nraw === 0) return true
  if (!ctx.info.visible(nlayer)) return true
  if (ctx.scope === 'layer' && nlayer !== layer) return true
  const na = materialAlpha(ctx.info, nlayer, nmat)
  if (alpha >= 1) return na < 1
  if (na >= 1) return false
  return !(nlayer === layer && na === alpha)
}

export type FaceCallback = (
  x: number, y: number, z: number, face: number, color: number, layer: number, mat: number, alpha: number,
) => void

function visitChunk(grid: VoxelGrid, chunk: Chunk, ctx: FaceContext, cb: FaceCallback): void {
  const ox = chunk.cx << 4, oy = chunk.cy << 4, oz = chunk.cz << 4
  const { colors, layers, mats } = chunk
  for (let i = 0; i < colors.length; i++) {
    const raw = colors[i]
    if (raw === 0) continue
    const layer = layers[i]
    if (!ctx.info.visible(layer)) continue
    const mat = mats[i]
    const alpha = materialAlpha(ctx.info, layer, mat)
    if (alpha <= 0) continue
    const x = ox + (i & 15), y = oy + ((i >> 4) & 15), z = oz + (i >> 8)
    for (let f = 0; f < 6; f++) {
      const d = FACE_DIRS[f]
      const nx = x + d[0], ny = y + d[1], nz = z + d[2]
      let nraw = 0, nlayer = 0, nmat = 0
      const same = (nx >> 4) === chunk.cx && (ny >> 4) === chunk.cy && (nz >> 4) === chunk.cz
      const nc = same ? chunk : grid.chunkAt(nx, ny, nz)
      if (nc) {
        const ni = localIndex(nx, ny, nz)
        nraw = nc.colors[ni]
        nlayer = nc.layers[ni]
        nmat = nc.mats[ni]
      }
      if (faceVisible(ctx, alpha, layer, nraw, nlayer, nmat)) {
        cb(x, y, z, f, raw & 0xffffff, layer, mat, alpha)
      }
    }
  }
}

export function visitFaces(grid: VoxelGrid, chunk: Chunk | null, ctx: FaceContext, cb: FaceCallback): void {
  if (chunk) {
    visitChunk(grid, chunk, ctx, cb)
    return
  }
  for (const c of grid.chunks.values()) visitChunk(grid, c, ctx, cb)
}

export class GeoBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  idx: number[] = []
  private verts = 0

  constructor(private withAlpha: boolean) {}

  get empty(): boolean { return this.verts === 0 }

  addFace(x: number, y: number, z: number, face: number, color: number, mat: number, alpha: number): void {
    const v = FACE_VERTS[face]
    const n = FACE_DIRS[face]
    const [r, g, b] = vertexColor(color, mat)
    for (let k = 0; k < 4; k++) {
      this.pos.push(x + v[k * 3], y + v[k * 3 + 1], z + v[k * 3 + 2])
      this.nor.push(n[0], n[1], n[2])
      if (this.withAlpha) this.col.push(r, g, b, alpha)
      else this.col.push(r, g, b)
    }
    const o = this.verts
    this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3)
    this.verts += 4
  }

  toGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), this.withAlpha ? 4 : 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1))
    geo.computeBoundingSphere()
    return geo
  }
}

export interface ChunkGeometry {
  opaque: THREE.BufferGeometry | null
  trans: THREE.BufferGeometry | null
}

export function buildChunkGeometry(grid: VoxelGrid, chunk: Chunk, info: LayerInfo): ChunkGeometry {
  const opaque = new GeoBuilder(false)
  const trans = new GeoBuilder(true)
  visitFaces(grid, chunk, { info, scope: 'all' }, (x, y, z, f, color, _l, mat, alpha) => {
    if (alpha >= 1) opaque.addFace(x, y, z, f, color, mat, 1)
    else trans.addFace(x, y, z, f, color, mat, alpha)
  })
  return {
    opaque: opaque.empty ? null : opaque.toGeometry(),
    trans: trans.empty ? null : trans.toGeometry(),
  }
}
