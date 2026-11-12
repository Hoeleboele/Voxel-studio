import { EditBatch, applyAdd, applyErase, applyPaint, floodFill, forEachMirror } from '../core/edit'
import type { CellSource, EditContext } from '../core/edit'
import { boxCells, brushCells, lineCells, sphereCells } from '../core/shapes'
import type { Vec3 } from '../core/types'
import { packPos, unpackX, unpackY, unpackZ } from '../core/voxelGrid'
import { useEditor } from '../store/editorStore'
import { getLayerInfo, grid, useProject } from '../store/projectStore'
import { pickVoxel, planeCell } from '../viewport/picking'
import type { Ray } from '../viewport/picking'
import { targetCells, translateSelection } from './actions'

export interface Mods { shift: boolean; ctrl: boolean; alt: boolean }

type Drag =
  | { kind: 'stroke'; tool: 'draw' | 'erase' | 'paint'; axis: number; value: number; last: Vec3; batch: EditBatch; ctx: EditContext }
  | { kind: 'shape'; tool: 'line' | 'box' | 'sphere'; op: 'add' | 'erase'; axis: number; value: number; sign: number; start: Vec3; cur: Vec3 }
  | { kind: 'select'; axis: number; value: number; start: Vec3; cur: Vec3; additive: boolean }
  | { kind: 'move'; axis: number; value: number; start: Vec3; cur: Vec3; cells: number[]; usesSelection: boolean }

let drag: Drag | null = null

function editContext(): EditContext {
  const p = useProject.getState()
  const e = useEditor.getState()
  return { grid, info: getLayerInfo(), sym: e.sym, color: e.color, material: e.material, layerId: p.activeLayerId }
}

/** Returns an error message when the active layer cannot receive edits. */
export function activeLayerProblem(): string | null {
  const p = useProject.getState()
  const layer = p.layers.find((l) => l.id === p.activeLayerId)
  if (!layer) return 'No active layer'
  if (layer.isGroup) return 'Select a layer, not a group'
  const info = getLayerInfo()
  if (!info.visible(layer.id)) return 'Active layer is hidden'
  if (info.locked(layer.id)) return 'Active layer is locked'
  return null
}

function pick(ray: Ray) {
  const info = getLayerInfo()
  return pickVoxel(grid, ray, (l) => info.visible(l))
}

function axisOf(n: Vec3): number {
  return n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2
}

function equal(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

function shapeSource(
  tool: 'line' | 'box' | 'sphere', start: Vec3, cur: Vec3, axis: number, sign: number,
): CellSource {
  const e = useEditor.getState()
  if (tool === 'line') {
    return (emit) => lineCells(start, cur, (x, y, z) => brushCells([x, y, z], e.brush, emit))
  }
  if (tool === 'box') {
    const end: Vec3 = [...cur]
    end[axis] = start[axis] + sign * (e.extrude - 1)
    return (emit) => boxCells(start, end, e.filled, emit)
  }
  const r = Math.round(Math.hypot(cur[0] - start[0], cur[1] - start[1], cur[2] - start[2]))
  return (emit) => sphereCells(start, r, e.filled, emit)
}

function previewCells(source: CellSource): number[] {
  const e = useEditor.getState()
  const out = new Set<number>()
  source((x0, y0, z0) => {
    forEachMirror(x0, y0, z0, e.sym, grid.bounds, (x, y, z) => {
      if (grid.inBounds(x, y, z)) out.add(packPos(x, y, z))
    })
  })
  return [...out]
}

export function onHover(ray: Ray): void {
  const e = useEditor.getState()
  const hit = pick(ray)
  if (!hit) {
    if (e.hover) e.setHover(null)
    return
  }
  e.setHover({ cell: hit.cell, place: hit.place })
}

export function clearHover(): void {
  useEditor.getState().setHover(null)
}

export function onPointerDown(ray: Ray, mods: Mods): void {
  const e = useEditor.getState()
  const tool = e.tool
  if (tool === 'rotate' || tool === 'mirror') return
  const hit = pick(ray)

  if (tool === 'pick') {
    if (hit?.kind === 'voxel') {
      const [x, y, z] = hit.cell
      e.set({ color: grid.getColor(x, y, z), material: grid.getMaterial(x, y, z) })
    }
    return
  }

  if (tool === 'select') {
    if (!hit || hit.kind !== 'voxel') {
      if (!mods.shift) e.setSelection([])
      return
    }
    const axis = axisOf(hit.normal)
    drag = { kind: 'select', axis, value: hit.cell[axis], start: hit.cell, cur: hit.cell, additive: mods.shift }
    return
  }

  if (tool === 'move') {
    if (!hit) return
    const usesSelection = e.selection.size > 0
    const cells = targetCells()
    if (cells.length === 0) {
      e.say('Nothing to move: select voxels or add some to the active layer')
      return
    }
    const axis = axisOf(hit.normal)
    drag = { kind: 'move', axis, value: hit.place[axis], start: hit.place, cur: hit.place, cells, usesSelection }
    return
  }

  if (tool === 'fill') {
    if (hit?.kind !== 'voxel') return
    if (!getLayerInfo().editable(grid.getLayer(hit.cell[0], hit.cell[1], hit.cell[2]))) {
      e.say('Layer is locked')
      return
    }
    const batch = new EditBatch(grid)
    const axis = e.fillPlane ? axisOf(hit.normal) : null
    applyPaint(batch, editContext(), (emit) => floodFill(grid, hit.cell, axis, emit))
    batch.commit('Fill')
    return
  }

  if (tool === 'draw' || tool === 'erase' || tool === 'paint') {
    if (tool === 'draw') {
      const problem = activeLayerProblem()
      if (problem) { e.say(problem); return }
    }
    const target = tool === 'draw' ? hit?.place : hit?.kind === 'voxel' ? hit.cell : undefined
    if (!hit || !target || !grid.inBounds(target[0], target[1], target[2])) return
    const axis = axisOf(hit.normal)
    const d: Extract<Drag, { kind: 'stroke' }> = {
      kind: 'stroke', tool, axis, value: target[axis], last: target, batch: new EditBatch(grid), ctx: editContext(),
    }
    drag = d
    stamp(d, target)
    return
  }

  if (tool === 'line' || tool === 'box' || tool === 'sphere') {
    if (e.shapeOp === 'add') {
      const problem = activeLayerProblem()
      if (problem) { e.say(problem); return }
    }
    const base = e.shapeOp === 'add' ? hit?.place : hit?.kind === 'voxel' ? hit.cell : undefined
    if (!hit || !base || !grid.inBounds(base[0], base[1], base[2])) return
    const axis = axisOf(hit.normal)
    const sign = e.shapeOp === 'add' ? hit.normal[axis] : -hit.normal[axis]
    drag = { kind: 'shape', tool, op: e.shapeOp, axis, value: base[axis], sign, start: base, cur: base }
    e.setPreview({ cells: previewCells(shapeSource(tool, base, base, axis, sign)), mode: e.shapeOp })
  }
}

function stamp(d: Extract<Drag, { kind: 'stroke' }>, cell: Vec3): void {
  const e = useEditor.getState()
  const source: CellSource = (emit) => brushCells(cell, e.brush, emit)
  if (d.tool === 'draw') applyAdd(d.batch, d.ctx, source)
  else if (d.tool === 'erase') applyErase(d.batch, d.ctx, source)
  else applyPaint(d.batch, d.ctx, source)
}

export function onPointerMove(ray: Ray, mods: Mods): void {
  if (!drag) {
    onHover(ray)
    return
  }
  const e = useEditor.getState()
  const d = drag
  const cell = planeCell(grid, ray, d.axis, d.value)
  if (!cell) return

  if (d.kind === 'stroke') {
    if (equal(cell, d.last)) return
    lineCells(d.last, cell, (x, y, z) => stamp(d, [x, y, z]))
    d.last = cell
    return
  }

  if (equal(cell, d.cur)) return
  d.cur = cell

  if (d.kind === 'shape') {
    e.setPreview({ cells: previewCells(shapeSource(d.tool, d.start, cell, d.axis, d.sign)), mode: d.op })
  } else if (d.kind === 'select') {
    e.setPreview({ cells: selectionRect(d), mode: 'move' })
    d.additive = d.additive || mods.shift
  } else if (d.kind === 'move') {
    const delta: Vec3 = [cell[0] - d.start[0], cell[1] - d.start[1], cell[2] - d.start[2]]
    const shifted: number[] = []
    for (const p of d.cells) {
      const x = unpackX(p) + delta[0], y = unpackY(p) + delta[1], z = unpackZ(p) + delta[2]
      if (grid.inBounds(x, y, z)) shifted.push(packPos(x, y, z))
    }
    e.setPreview({ cells: shifted, mode: 'move' })
  }
}

function selectionRect(d: Extract<Drag, { kind: 'select' }>): number[] {
  const lo: Vec3 = [Math.min(d.start[0], d.cur[0]), Math.min(d.start[1], d.cur[1]), Math.min(d.start[2], d.cur[2])]
  const hi: Vec3 = [Math.max(d.start[0], d.cur[0]), Math.max(d.start[1], d.cur[1]), Math.max(d.start[2], d.cur[2])]
  if (useEditor.getState().selectThrough) {
    lo[d.axis] = 0
    hi[d.axis] = grid.bounds[d.axis] - 1
  }
  const info = getLayerInfo()
  const out: number[] = []
  boxCells(lo, hi, true, (x, y, z) => {
    if (grid.has(x, y, z) && info.visible(grid.getLayer(x, y, z))) out.push(packPos(x, y, z))
  })
  return out
}

export function onPointerUp(): void {
  const d = drag
  drag = null
  if (!d) return
  const e = useEditor.getState()
  e.setPreview(null)

  if (d.kind === 'stroke') {
    const label = d.tool === 'draw' ? 'Draw' : d.tool === 'erase' ? 'Erase' : 'Paint'
    d.batch.commit(label)
    return
  }

  if (d.kind === 'shape') {
    const batch = new EditBatch(grid)
    const ctx = editContext()
    const source = shapeSource(d.tool, d.start, d.cur, d.axis, d.sign)
    if (d.op === 'add') applyAdd(batch, ctx, source)
    else applyErase(batch, ctx, source)
    batch.commit(d.tool === 'line' ? 'Line' : d.tool === 'box' ? 'Box' : 'Sphere')
    return
  }

  if (d.kind === 'select') {
    const click = equal(d.start, d.cur) && !e.selectThrough
    const picked = click ? [packPos(d.start[0], d.start[1], d.start[2])] : selectionRect(d)
    const next = new Set(d.additive ? e.selection : [])
    if (click && next.has(picked[0])) next.delete(picked[0])
    else for (const p of picked) next.add(p)
    e.setSelection(next)
    e.say(`${next.size} voxels selected`)
    return
  }

  const delta: Vec3 = [d.cur[0] - d.start[0], d.cur[1] - d.start[1], d.cur[2] - d.start[2]]
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return
  translateSelection(delta[0], delta[1], delta[2], d.cells, d.usesSelection)
}

export function cancelDrag(): void {
  if (!drag) return
  const d = drag
  drag = null
  useEditor.getState().setPreview(null)
  if (d.kind === 'stroke') d.batch.commit('Stroke')
}
