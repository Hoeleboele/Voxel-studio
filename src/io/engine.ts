import type { Animation, Layer } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { LayerInfo } from '../core/layers'

export type EnginePreset = 'generic' | 'unity' | 'unreal' | 'godot'

interface PresetSpec {
  label: string
  note: string
  /** Character height in the engine's metres; null keeps the manual scale. */
  targetHeight: number | null
  clipName(model: string, clip: string, loop: boolean): string
}

export const ENGINE_PRESETS: Record<EnginePreset, PresetSpec> = {
  generic: { label: 'Generic (manual settings)', note: '', targetHeight: null, clipName: (_m, c) => c },
  unity: {
    label: 'Unity', targetHeight: 1.8, clipName: (_m, c) => c,
    note: 'GLB at 1.8 m tall, Y-up, rigged with all clips. Import with a glTF package (e.g. glTFast); set clip loop flags from the clip names list.',
  },
  unreal: {
    label: 'Unreal Engine', targetHeight: 1.8, clipName: (m, c) => `A_${m}_${c}`,
    note: 'GLB at 1.8 m tall (Interchange converts to centimetres). Clips are named A_<Model>_<Clip>; the skeleton root is called "root".',
  },
  godot: {
    label: 'Godot', targetHeight: 1.8, clipName: (_m, c, loop) => (loop ? `${c}-loop` : c),
    note: 'GLB at 1.8 m tall. Looping clips get the "-loop" suffix, which Godot turns into loop mode automatically on import.',
  },
}

const cleanName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Clip'

/** Copies of the animations with engine-conventional names, dropping clips that only hold voxel frames. */
export function presetAnimations(preset: EnginePreset, model: string, anims: Animation[]): Animation[] {
  const spec = ENGINE_PRESETS[preset]
  const used = new Set<string>()
  return anims
    .filter((a) => Object.values(a.tracks).some((t) => t.length > 0))
    .map((a) => {
      let name = spec.clipName(cleanName(model), preset === 'generic' ? a.name : cleanName(a.name), a.loop)
      for (let i = 2; used.has(name); i++) name = `${name}_${i}`
      used.add(name)
      return { ...a, name }
    })
}

/** Units per voxel that make the model `height` units tall. */
export function scaleForHeight(grid: VoxelGrid, layers: Layer[], height: number): number {
  const info = new LayerInfo(layers)
  const box = grid.bbox((l) => info.visible(l))
  if (!box) return 0.1
  const voxels = box.max[1] - box.min[1] + 1
  return Math.round((height / voxels) * 10000) / 10000
}
