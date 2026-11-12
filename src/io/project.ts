import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Animation, Layer, Palette, ProjectMeta, Vec3 } from '../core/types'
import { deserializeVoxels, serializeVoxels } from '../core/voxelIO'
import { grid, useProject } from '../store/projectStore'
import { downloadBlob, safeName } from './download'

const FORMAT_VERSION = 1

interface ProjectJson {
  format: number
  meta: ProjectMeta
  bounds: Vec3
  layers: Layer[]
  customPalettes: Palette[]
  activePaletteId: string
  animations: (Omit<Animation, 'snapshots'> & { snapshotFrames: number[] })[]
}

export function serializeProject(): Uint8Array {
  const p = useProject.getState()
  const json: ProjectJson = {
    format: FORMAT_VERSION,
    meta: { ...p.meta, modified: Date.now() },
    bounds: p.bounds,
    layers: p.layers,
    customPalettes: p.customPalettes,
    activePaletteId: p.activePaletteId,
    animations: p.animations.map((a) => ({
      id: a.id, name: a.name, fps: a.fps, length: a.length, loop: a.loop, tracks: a.tracks,
      snapshotFrames: Object.keys(a.snapshots).map(Number),
    })),
  }
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(json)),
    'voxels.bin': serializeVoxels(grid),
  }
  for (const a of p.animations) {
    for (const [frame, bytes] of Object.entries(a.snapshots)) files[`frames/${a.id}_${frame}.bin`] = bytes
  }
  return zipSync(files, { level: 3 })
}

export function loadProjectBytes(bytes: Uint8Array): void {
  const files = unzipSync(bytes)
  const raw = files['project.json']
  if (!raw) throw new Error('Not a Voxel Character Studio project')
  const json = JSON.parse(strFromU8(raw)) as ProjectJson
  const animations: Animation[] = json.animations.map((a) => {
    const snapshots: Record<number, Uint8Array> = {}
    for (const f of a.snapshotFrames) {
      const data = files[`frames/${a.id}_${f}.bin`]
      if (data) snapshots[f] = data
    }
    return { id: a.id, name: a.name, fps: a.fps, length: a.length, loop: a.loop, tracks: a.tracks, snapshots }
  })
  useProject.getState().resetProject({
    bounds: json.bounds,
    layers: json.layers,
    meta: json.meta,
    animations,
    customPalettes: json.customPalettes,
    activePaletteId: json.activePaletteId,
  })
  if (files['voxels.bin']) deserializeVoxels(files['voxels.bin'], grid)
  grid.touch()
}

export function saveProjectFile(): void {
  const p = useProject.getState()
  downloadBlob(serializeProject(), `${safeName(p.meta.name)}.vcs`, 'application/zip')
  p.markSaved()
}
