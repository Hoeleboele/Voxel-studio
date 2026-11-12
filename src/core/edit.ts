import type { Command } from './history'
import { history } from './history'
import type { LayerInfo } from './layers'
import type { Symmetry, Vec3 } from './types'
import { RAW_OCC, VoxelGrid, packPos, unpackX, unpackY, unpackZ } from './voxelGrid'
import type { Emit } from './shapes'

const STRIDE = 9

class GrowableU32 {
  data = new Uint32Array(1024)
  length = 0
  push(...vals: number[]): void {
    if (this.length + vals.length > this.data.length) {
      const next = new Uint32Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    for (const v of vals) this.data[this.length++] = v
  }
  finish(): Uint32Array { return this.data.slice(0, this.length) }
}

export class VoxelCommand implements Command {
  constructor(public label: string, private grid: VoxelGrid, private rec: Uint32Array) {}

  undo(): void {
    const r = this.rec
    for (let i = r.length - STRIDE; i >= 0; i -= STRIDE) {
      this.grid.setRaw(r[i], r[i + 1], r[i + 2], r[i + 3], r[i + 4], r[i + 5])
    }
    this.grid.touch()
  }

  redo(): void {
    const r = this.rec
    for (let i = 0; i < r.length; i += STRIDE) {
      this.grid.setRaw(r[i], r[i + 1], r[i + 2], r[i + 6], r[i + 7], r[i + 8])
    }
    this.grid.touch()
  }
}

/** Applies voxel changes immediately while recording them for undo. */
export class EditBatch {
  private rec = new GrowableU32()

  constructor(public grid: VoxelGrid) {}

  get size(): number { return this.rec.length / STRIDE }

  setVoxel(x: number, y: number, z: number, color: number, layer: number, mat: number): boolean {
    const g = this.grid
    const newRaw = (color & 0xffffff) | RAW_OCC
    const oldRaw = g.getRaw(x, y, z)
    const oldLayer = oldRaw ? g.getLayer(x, y, z) : 0
    const oldMat = oldRaw ? g.getMaterial(x, y, z) : 0
    if (oldRaw === newRaw && oldLayer === layer && oldMat === mat) return false
    this.rec.push(x, y, z, oldRaw, oldLayer, oldMat, newRaw, layer, mat)
    g.setRaw(x, y, z, newRaw, layer, mat)
    return true
  }

  removeVoxel(x: number, y: number, z: number): boolean {
    const g = this.grid
    const oldRaw = g.getRaw(x, y, z)
    if (oldRaw === 0) return false
    this.rec.push(x, y, z, oldRaw, g.getLayer(x, y, z), g.getMaterial(x, y, z), 0, 0, 0)
    g.remove(x, y, z)
    return true
  }

  toCommand(label: string): VoxelCommand | null {
    if (this.rec.length === 0) return null
    return new VoxelCommand(label, this.grid, this.rec.finish())
  }

  commit(label: string): boolean {
    const cmd = this.toCommand(label)
    this.grid.touch()
    if (!cmd) return false
    history.push(cmd)
    return true
  }
}

export function forEachMirror(
  x: number, y: number, z: number, sym: Symmetry, bounds: Vec3, fn: Emit,
): void {
  const mx = bounds[0] - 1 - x, my = bounds[1] - 1 - y, mz = bounds[2] - 1 - z
  const nx = sym.x && mx !== x ? 1 : 0
  const ny = sym.y && my !== y ? 1 : 0
  const nz = sym.z && mz !== z ? 1 : 0
  for (let a = 0; a <= nx; a++) {
    for (let b = 0; b <= ny; b++) {
      for (let c = 0; c <= nz; c++) {
        fn(a ? mx : x, b ? my : y, c ? mz : z)
      }
    }
  }
}

export interface EditContext {
  grid: VoxelGrid
  info: LayerInfo
  sym: Symmetry
  color: number
  material: number
  layerId: number
}

export type CellSource = (emit: Emit) => void

export function applyAdd(batch: EditBatch, ctx: EditContext, source: CellSource): void {
  const { grid, info, sym } = ctx
  if (!info.editable(ctx.layerId)) return
  source((x0, y0, z0) => {
    forEachMirror(x0, y0, z0, sym, grid.bounds, (x, y, z) => {
      if (!grid.inBounds(x, y, z)) return
      if (grid.has(x, y, z) && !info.editable(grid.getLayer(x, y, z))) return
      batch.setVoxel(x, y, z, ctx.color, ctx.layerId, ctx.material)
    })
  })
}

export function applyErase(batch: EditBatch, ctx: EditContext, source: CellSource): void {
  const { grid, info, sym } = ctx
  source((x0, y0, z0) => {
    forEachMirror(x0, y0, z0, sym, grid.bounds, (x, y, z) => {
      if (!grid.has(x, y, z) || !info.editable(grid.getLayer(x, y, z))) return
      batch.removeVoxel(x, y, z)
    })
  })
}

export function applyPaint(batch: EditBatch, ctx: EditContext, source: CellSource): void {
  const { grid, info, sym } = ctx
  source((x0, y0, z0) => {
    forEachMirror(x0, y0, z0, sym, grid.bounds, (x, y, z) => {
      if (!grid.has(x, y, z)) return
      const layer = grid.getLayer(x, y, z)
      if (!info.editable(layer)) return
      batch.setVoxel(x, y, z, ctx.color, layer, ctx.material)
    })
  })
}

/** Moves editable voxels in `cells` through `map`. Returns the new packed cells, or null if blocked. */
export function transformCells(
  batch: EditBatch, info: LayerInfo, cells: Iterable<number>, map: (x: number, y: number, z: number) => Vec3,
): number[] | null {
  const grid = batch.grid
  const items: { x: number; y: number; z: number; color: number; layer: number; mat: number }[] = []
  for (const p of cells) {
    const x = unpackX(p), y = unpackY(p), z = unpackZ(p)
    if (!grid.has(x, y, z)) continue
    const layer = grid.getLayer(x, y, z)
    if (!info.editable(layer)) continue
    items.push({ x, y, z, color: grid.getColor(x, y, z), layer, mat: grid.getMaterial(x, y, z) })
  }
  const targets = items.map((it) => map(it.x, it.y, it.z))
  for (const t of targets) {
    if (!grid.inBounds(t[0], t[1], t[2])) return null
  }
  for (const it of items) batch.removeVoxel(it.x, it.y, it.z)
  const out: number[] = []
  items.forEach((it, i) => {
    const t = targets[i]
    if (grid.has(t[0], t[1], t[2]) && !info.editable(grid.getLayer(t[0], t[1], t[2]))) return
    batch.setVoxel(t[0], t[1], t[2], it.color, it.layer, it.mat)
    out.push(packPos(t[0], t[1], t[2]))
  })
  return out
}

export function floodFill(
  grid: VoxelGrid, start: Vec3, planeAxis: number | null, emit: Emit,
): void {
  const target = grid.getColor(start[0], start[1], start[2])
  if (target < 0) return
  const targetMat = grid.getMaterial(start[0], start[1], start[2])
  const seen = new Set<number>([packPos(start[0], start[1], start[2])])
  const queue: number[] = [packPos(start[0], start[1], start[2])]
  const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]
    const x = unpackX(p), y = unpackY(p), z = unpackZ(p)
    emit(x, y, z)
    for (let d = 0; d < 6; d++) {
      const dir = dirs[d]
      if (planeAxis !== null && dir[planeAxis] !== 0) continue
      const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2]
      if (nx < 0 || ny < 0 || nz < 0 || nx > 255 || ny > 255 || nz > 255) continue
      const np = packPos(nx, ny, nz)
      if (seen.has(np)) continue
      if (grid.getColor(nx, ny, nz) !== target || grid.getMaterial(nx, ny, nz) !== targetMat) continue
      seen.add(np)
      queue.push(np)
    }
  }
}
