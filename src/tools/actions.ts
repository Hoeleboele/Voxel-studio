import { EditBatch, transformCells } from '../core/edit'
import { LayerInfo } from '../core/layers'
import { cellsBox, flipMapper, rotationMapper } from '../core/transform'
import { packPos, unpackX, unpackY, unpackZ } from '../core/voxelGrid'
import { useEditor } from '../store/editorStore'
import type { ClipItem } from '../store/editorStore'
import { grid, useProject } from '../store/projectStore'

function info(): LayerInfo {
  return new LayerInfo(useProject.getState().layers)
}

/** Selected voxels, or every voxel of the active layer when nothing is selected. */
export function targetCells(): number[] {
  const e = useEditor.getState()
  if (e.selection.size > 0) return [...e.selection]
  const active = useProject.getState().activeLayerId
  const out: number[] = []
  grid.forEach((x, y, z, _c, l) => { if (l === active) out.push(packPos(x, y, z)) })
  return out
}

export function translateSelection(
  dx: number, dy: number, dz: number, cells?: number[], usesSelection?: boolean,
): void {
  const e = useEditor.getState()
  const src = cells ?? targetCells()
  const useSel = usesSelection ?? e.selection.size > 0
  if (src.length === 0) return
  const batch = new EditBatch(grid)
  const moved = transformCells(batch, info(), src, (x, y, z) => [x + dx, y + dy, z + dz])
  if (!moved) {
    e.say('Move blocked by the grid bounds')
    return
  }
  batch.commit('Move')
  if (useSel) e.setSelection(moved)
}

export function flipTarget(axis: 0 | 1 | 2): void {
  const e = useEditor.getState()
  const cells = targetCells()
  const box = cellsBox(cells)
  if (!box) return
  const batch = new EditBatch(grid)
  const moved = transformCells(batch, info(), cells, flipMapper(box, axis))
  if (!moved) return e.say('Flip blocked by the grid bounds')
  batch.commit('Flip')
  if (e.selection.size > 0) e.setSelection(moved)
}

export function rotateTarget(axis: 0 | 1 | 2, dir: 1 | -1): void {
  const e = useEditor.getState()
  const cells = targetCells()
  const box = cellsBox(cells)
  if (!box) return
  const batch = new EditBatch(grid)
  const moved = transformCells(batch, info(), cells, rotationMapper(box, axis, dir))
  if (!moved) return e.say('Rotation blocked by the grid bounds')
  batch.commit('Rotate')
  if (e.selection.size > 0) e.setSelection(moved)
}

export function selectAll(): void {
  const inf = info()
  const out: number[] = []
  grid.forEach((x, y, z, _c, l) => { if (inf.visible(l)) out.push(packPos(x, y, z)) })
  useEditor.getState().setSelection(out)
  useEditor.getState().say(`${out.length} voxels selected`)
}

export function selectLayer(layerId?: number): void {
  const id = layerId ?? useProject.getState().activeLayerId
  const out: number[] = []
  grid.forEach((x, y, z, _c, l) => { if (l === id) out.push(packPos(x, y, z)) })
  useEditor.getState().setSelection(out)
}

export function selectColor(color: number): void {
  const inf = info()
  const out: number[] = []
  grid.forEach((x, y, z, c, l) => { if (c === color && inf.visible(l)) out.push(packPos(x, y, z)) })
  useEditor.getState().setSelection(out)
  useEditor.getState().say(`${out.length} voxels selected`)
}

export function clearSelection(): void {
  useEditor.getState().setSelection([])
}

export function deleteSelection(): void {
  const e = useEditor.getState()
  if (e.selection.size === 0) return
  const inf = info()
  const batch = new EditBatch(grid)
  for (const p of e.selection) {
    const x = unpackX(p), y = unpackY(p), z = unpackZ(p)
    if (grid.has(x, y, z) && inf.editable(grid.getLayer(x, y, z))) batch.removeVoxel(x, y, z)
  }
  batch.commit('Delete selection')
  e.setSelection([])
}

export function copySelection(): void {
  const e = useEditor.getState()
  const box = cellsBox(e.selection)
  if (!box) return e.say('Nothing selected')
  const items: ClipItem[] = []
  for (const p of e.selection) {
    const x = unpackX(p), y = unpackY(p), z = unpackZ(p)
    if (!grid.has(x, y, z)) continue
    items.push({
      x: x - box.min[0], y: y - box.min[1], z: z - box.min[2],
      color: grid.getColor(x, y, z), mat: grid.getMaterial(x, y, z),
    })
  }
  e.set({ clipboard: items })
  e.say(`Copied ${items.length} voxels`)
}

export function placeVoxels(items: ClipItem[], at: [number, number, number], label: string): boolean {
  const e = useEditor.getState()
  const p = useProject.getState()
  const inf = info()
  const layer = p.layers.find((l) => l.id === p.activeLayerId)
  if (!layer || layer.isGroup || !inf.editable(layer.id)) {
    e.say('Select an unlocked, visible layer first')
    return false
  }
  const batch = new EditBatch(grid)
  const placed: number[] = []
  for (const it of items) {
    const x = at[0] + it.x, y = at[1] + it.y, z = at[2] + it.z
    if (!grid.inBounds(x, y, z)) continue
    if (grid.has(x, y, z) && !inf.editable(grid.getLayer(x, y, z))) continue
    batch.setVoxel(x, y, z, it.color, layer.id, it.mat)
    placed.push(packPos(x, y, z))
  }
  batch.commit(label)
  e.setSelection(placed)
  return true
}

export function pasteClipboard(): void {
  const e = useEditor.getState()
  if (!e.clipboard || e.clipboard.length === 0) return e.say('Clipboard is empty')
  const at = e.hover?.place ?? [Math.floor(grid.bounds[0] / 2), 0, Math.floor(grid.bounds[2] / 2)]
  placeVoxels(e.clipboard, [at[0], at[1], at[2]], 'Paste')
}

export function moveSelectionToActiveLayer(): void {
  const e = useEditor.getState()
  const p = useProject.getState()
  const inf = info()
  if (!inf.editable(p.activeLayerId)) return e.say('Active layer is locked or hidden')
  const batch = new EditBatch(grid)
  for (const cell of e.selection) {
    const x = unpackX(cell), y = unpackY(cell), z = unpackZ(cell)
    if (!grid.has(x, y, z) || !inf.editable(grid.getLayer(x, y, z))) continue
    batch.setVoxel(x, y, z, grid.getColor(x, y, z), p.activeLayerId, grid.getMaterial(x, y, z))
  }
  batch.commit('Move to layer')
}

/** Replaces the contents of `dstId` with a copy of `srcId` mirrored across the grid midline (X). */
export function mirrorLayerTo(srcId: number, dstId: number): void {
  const e = useEditor.getState()
  if (!info().editable(dstId)) return e.say('Target layer is locked or hidden')
  const src: { x: number; y: number; z: number; color: number; mat: number }[] = []
  const stale: [number, number, number][] = []
  grid.forEach((x, y, z, color, l, mat) => {
    if (l === srcId) src.push({ x, y, z, color, mat })
    else if (l === dstId) stale.push([x, y, z])
  })
  const batch = new EditBatch(grid)
  for (const [x, y, z] of stale) batch.removeVoxel(x, y, z)
  for (const v of src) {
    const mx = grid.bounds[0] - 1 - v.x
    if (grid.has(mx, v.y, v.z) && !info().editable(grid.getLayer(mx, v.y, v.z))) continue
    batch.setVoxel(mx, v.y, v.z, v.color, dstId, v.mat)
  }
  batch.commit('Mirror part')
}
