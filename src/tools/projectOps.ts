import { EditBatch } from '../core/edit'
import { quantizeColors } from '../core/color'
import { useEditor } from '../store/editorStore'
import { getLayerInfo, grid, useProject } from '../store/projectStore'
import { generateCharacter, requiredBounds } from '../templates/characters'
import type { CharacterSpec } from '../templates/characters'
import { engine } from '../viewport/engine'
import { importVox } from '../io/vox'

const KIND_NAMES = { humanoid: 'Humanoid', animal: 'Animal', monster: 'Monster', robot: 'Robot', blank: 'Blank' }

export function newCharacterProject(spec: CharacterSpec, bounds: [number, number, number] = [64, 64, 64]): void {
  const b = requiredBounds(spec.kind, spec.proportions, bounds)
  const gen = generateCharacter(spec, b)
  useProject.getState().resetProject({ bounds: gen.bounds, layers: gen.layers, meta: { name: `${KIND_NAMES[spec.kind]} character` } })
  for (const v of gen.voxels) grid.set(v.x, v.y, v.z, v.color, v.layerId, v.material)
  grid.touch()
  useEditor.getState().setSelection([])
  engine?.frame()
}

/** Rebuilds the model from a template as one undoable step. */
export function regenerateCharacter(spec: CharacterSpec): void {
  const p = useProject.getState()
  const needed = requiredBounds(spec.kind, spec.proportions, p.bounds)
  if (needed.some((n, i) => n !== p.bounds[i])) p.setBounds(needed)
  const gen = generateCharacter(spec, grid.bounds)
  const batch = new EditBatch(grid)
  const old: [number, number, number][] = []
  grid.forEach((x, y, z) => { old.push([x, y, z]) })
  for (const [x, y, z] of old) batch.removeVoxel(x, y, z)
  for (const v of gen.voxels) batch.setVoxel(v.x, v.y, v.z, v.color, v.layerId, v.material)
  const cmd = batch.toCommand('Regenerate character')
  p.replaceLayersUndoable('Regenerate character', gen.layers, cmd ? [cmd] : [])
  useEditor.getState().setSelection([])
}

export function importVoxBytes(bytes: Uint8Array): number {
  const vox = importVox(bytes)
  const p = useProject.getState()
  const need: [number, number, number] = [
    Math.max(p.bounds[0], vox.size[0]), Math.max(p.bounds[1], vox.size[1]), Math.max(p.bounds[2], vox.size[2]),
  ]
  if (need.some((n, i) => n !== p.bounds[i])) p.setBounds(need)
  const id = p.addLayer({ name: 'Imported VOX' })
  const ox = Math.floor((grid.bounds[0] - vox.size[0]) / 2)
  const oz = Math.floor((grid.bounds[2] - vox.size[2]) / 2)
  const batch = new EditBatch(grid)
  for (const v of vox.voxels) batch.setVoxel(v.x + ox, v.y, v.z + oz, v.color, id, 0)
  batch.commit('Import VOX')
  engine?.frame()
  return vox.voxels.length
}

export function colorHistogram(): Map<number, number> {
  const hist = new Map<number, number>()
  grid.forEach((_x, _y, _z, c) => hist.set(c, (hist.get(c) ?? 0) + 1))
  return hist
}

export function replaceColor(from: number, to: number): number {
  if (from === to) return 0
  const info = getLayerInfo()
  const targets: [number, number, number, number, number][] = []
  grid.forEach((x, y, z, c, l, m) => { if (c === from && info.editable(l)) targets.push([x, y, z, l, m]) })
  const batch = new EditBatch(grid)
  for (const [x, y, z, l, m] of targets) batch.setVoxel(x, y, z, to, l, m)
  batch.commit('Replace color')
  return targets.length
}

export function optimizeColors(maxColors: number): { before: number; after: number; palette: number[] } {
  const hist = colorHistogram()
  const map = quantizeColors(hist, maxColors)
  const info = getLayerInfo()
  const targets: [number, number, number, number, number, number][] = []
  grid.forEach((x, y, z, c, l, m) => {
    const to = map.get(c)
    if (to !== undefined && to !== c && info.editable(l)) targets.push([x, y, z, l, m, to])
  })
  const batch = new EditBatch(grid)
  for (const [x, y, z, l, m, to] of targets) batch.setVoxel(x, y, z, to, l, m)
  batch.commit('Optimize colors')
  const palette = [...new Set(map.values())]
  return { before: hist.size, after: palette.length, palette }
}
