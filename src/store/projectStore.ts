import { create } from 'zustand'
import { CompositeCommand, StateCommand, history } from '../core/history'
import type { Command } from '../core/history'
import { EditBatch } from '../core/edit'
import { LayerInfo, cloneLayers, descendantIds } from '../core/layers'
import type { Animation, Keyframe, Layer, Palette, PartId, ProjectMeta, Vec3 } from '../core/types'
import { VoxelGrid } from '../core/voxelGrid'
import { DEFAULT_PALETTE_ID, PRESET_PALETTES } from '../templates/palettes'

export const grid = new VoxelGrid()

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function newMeta(): ProjectMeta {
  const now = Date.now()
  return { name: 'Untitled', author: '', description: '', created: now, modified: now }
}

export function makeLayer(id: number, name: string, extra: Partial<Layer> = {}): Layer {
  return { id, name, visible: true, locked: false, opacity: 1, parentId: null, isGroup: false, ...extra }
}

interface LayerSnapshot { layers: Layer[]; active: number; nextId: number }

export interface ProjectState {
  meta: ProjectMeta
  bounds: Vec3
  layers: Layer[]
  activeLayerId: number
  nextLayerId: number
  customPalettes: Palette[]
  activePaletteId: string
  animations: Animation[]
  activeAnimId: string | null
  dirty: boolean
  lastSaved: number | null

  markDirty(): void
  markSaved(): void
  setMeta(patch: Partial<ProjectMeta>): void
  setBounds(b: Vec3): boolean
  setActiveLayer(id: number): void
  addLayer(opts?: { name?: string; group?: boolean }): number
  deleteLayer(id: number): void
  updateLayer(id: number, patch: Partial<Layer>): void
  setLayerParent(id: number, parent: number | null): void
  moveLayer(id: number, dir: -1 | 1): void
  setLayerPart(id: number, part: PartId | undefined): void
  resetProject(init: {
    bounds: Vec3; layers: Layer[]; meta?: Partial<ProjectMeta>; animations?: Animation[];
    customPalettes?: Palette[]; activePaletteId?: string
  }): void
  replaceLayers(layers: Layer[], active: number, nextId: number): void
  replaceLayersUndoable(label: string, layers: Layer[], extra: Command[]): void

  setActivePalette(id: string): void
  addPalette(name: string, colors: number[]): string
  updatePalette(id: string, patch: Partial<Palette>): void
  deletePalette(id: string): void

  addAnimation(anim: Animation): void
  updateAnimation(id: string, patch: Partial<Animation>): void
  deleteAnimation(id: string): void
  duplicateAnimation(id: string): string | null
  setActiveAnim(id: string | null): void
  setKeyframe(animId: string, layerId: number, kf: Keyframe): void
  removeKeyframe(animId: string, layerId: number, frame: number): void
}

function layerSnapshot(s: ProjectState): LayerSnapshot {
  return { layers: cloneLayers(s.layers), active: s.activeLayerId, nextId: s.nextLayerId }
}

function applyLayerSnapshot(snap: LayerSnapshot): void {
  useProject.setState({
    layers: cloneLayers(snap.layers),
    activeLayerId: snap.active,
    nextLayerId: snap.nextId,
    dirty: true,
  })
  grid.markAllDirty()
  grid.touch()
}

function layerCommand(label: string, before: LayerSnapshot, after: LayerSnapshot): Command {
  return new StateCommand(label, before, after, applyLayerSnapshot)
}

function commitLayers(
  label: string, mutate: (layers: Layer[], s: ProjectState) => { active?: number; nextId?: number } | void,
  extra: Command[] = [],
): void {
  const s = useProject.getState()
  const before = layerSnapshot(s)
  const layers = cloneLayers(s.layers)
  const r = mutate(layers, s) ?? {}
  const after: LayerSnapshot = {
    layers,
    active: r.active ?? s.activeLayerId,
    nextId: r.nextId ?? s.nextLayerId,
  }
  applyLayerSnapshot(after)
  const cmds = [...extra, layerCommand(label, before, after)]
  history.push(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds))
}

export const useProject = create<ProjectState>((set, get) => ({
  meta: newMeta(),
  bounds: [64, 64, 64],
  layers: [makeLayer(1, 'Layer 1')],
  activeLayerId: 1,
  nextLayerId: 2,
  customPalettes: [],
  activePaletteId: DEFAULT_PALETTE_ID,
  animations: [],
  activeAnimId: null,
  dirty: false,
  lastSaved: null,

  markDirty: () => set({ dirty: true }),
  markSaved: () => set({ dirty: false, lastSaved: Date.now() }),
  setMeta: (patch) => set((s) => ({ meta: { ...s.meta, ...patch }, dirty: true })),

  setBounds: (b) => {
    const box = grid.bbox()
    const next: Vec3 = [
      Math.max(8, Math.min(256, Math.round(b[0]))),
      Math.max(8, Math.min(256, Math.round(b[1]))),
      Math.max(8, Math.min(256, Math.round(b[2]))),
    ]
    if (box && (box.max[0] >= next[0] || box.max[1] >= next[1] || box.max[2] >= next[2])) return false
    grid.bounds = next
    set({ bounds: next, dirty: true })
    grid.touch()
    return true
  },

  setActiveLayer: (id) => set({ activeLayerId: id }),

  addLayer: (opts = {}) => {
    const s = get()
    const id = s.nextLayerId
    const active = s.layers.find((l) => l.id === s.activeLayerId)
    const parentId = active ? (active.isGroup ? active.id : active.parentId) : null
    const group = !!opts.group
    const layer = makeLayer(id, opts.name ?? (group ? `Group ${id}` : `Layer ${id}`), { parentId, isGroup: group })
    commitLayers(group ? 'Add group' : 'Add layer', (layers) => {
      const at = active ? layers.findIndex((l) => l.id === active.id) + 1 : layers.length
      layers.splice(at, 0, layer)
      return { active: id, nextId: id + 1 }
    })
    return id
  },

  deleteLayer: (id) => {
    const s = get()
    const ids = new Set([id, ...descendantIds(s.layers, id)])
    const batch = new EditBatch(grid)
    const doomed: [number, number, number][] = []
    grid.forEach((x, y, z, _c, l) => { if (ids.has(l)) doomed.push([x, y, z]) })
    for (const [x, y, z] of doomed) batch.removeVoxel(x, y, z)
    const voxelCmd = batch.toCommand('Delete layer')
    commitLayers('Delete layer', (layers, st) => {
      const kept = layers.filter((l) => !ids.has(l.id))
      let nextId = st.nextLayerId
      if (!kept.some((l) => !l.isGroup)) {
        kept.push(makeLayer(nextId, `Layer ${nextId}`))
        nextId++
      }
      layers.length = 0
      layers.push(...kept)
      const firstLeaf = kept.find((l) => !l.isGroup)!
      return { active: ids.has(st.activeLayerId) ? firstLeaf.id : st.activeLayerId, nextId }
    }, voxelCmd ? [voxelCmd] : [])
    grid.touch()
  },

  updateLayer: (id, patch) => {
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)), dirty: true }))
    if ('visible' in patch || 'opacity' in patch || 'locked' in patch) grid.markAllDirty()
    grid.touch()
  },

  setLayerParent: (id, parent) => {
    const s = get()
    if (parent === id || (parent !== null && descendantIds(s.layers, id).includes(parent))) return
    commitLayers('Change layer parent', (layers) => {
      const l = layers.find((x) => x.id === id)
      if (l) l.parentId = parent
    })
  },

  moveLayer: (id, dir) => {
    commitLayers('Reorder layer', (layers) => {
      const i = layers.findIndex((l) => l.id === id)
      const sibling = (from: number, step: number) => {
        for (let j = from + step; j >= 0 && j < layers.length; j += step) {
          if (layers[j].parentId === layers[i].parentId) return j
        }
        return -1
      }
      const j = sibling(i, dir)
      if (j < 0) return
      const [item] = layers.splice(i, 1)
      layers.splice(j, 0, item)
    })
  },

  setLayerPart: (id, part) => {
    commitLayers('Set part', (layers) => {
      const l = layers.find((x) => x.id === id)
      if (l) l.part = part
    })
  },

  resetProject: (init) => {
    grid.clear()
    grid.bounds = [...init.bounds]
    history.clear()
    const first = init.layers.find((l) => l.part === 'torso') ?? init.layers.find((l) => !l.isGroup) ?? init.layers[0]
    set({
      meta: { ...newMeta(), ...init.meta },
      bounds: [...init.bounds],
      layers: init.layers,
      activeLayerId: first.id,
      nextLayerId: Math.max(...init.layers.map((l) => l.id)) + 1,
      customPalettes: init.customPalettes ?? [],
      activePaletteId: init.activePaletteId ?? DEFAULT_PALETTE_ID,
      animations: init.animations ?? [],
      activeAnimId: init.animations?.[0]?.id ?? null,
      dirty: false,
    })
    grid.touch()
  },

  replaceLayers: (layers, active, nextId) => {
    set({ layers, activeLayerId: active, nextLayerId: nextId, dirty: true })
    grid.markAllDirty()
    grid.touch()
  },

  replaceLayersUndoable: (label, layers, extra) => {
    commitLayers(label, (ls) => {
      ls.length = 0
      ls.push(...layers)
      const first = layers.find((l) => !l.isGroup) ?? layers[0]
      return { active: first.id, nextId: Math.max(...layers.map((l) => l.id)) + 1 }
    }, extra)
  },

  setActivePalette: (id) => set({ activePaletteId: id }),

  addPalette: (name, colors) => {
    const id = uid()
    set((s) => ({ customPalettes: [...s.customPalettes, { id, name, colors }], activePaletteId: id, dirty: true }))
    return id
  },

  updatePalette: (id, patch) =>
    set((s) => ({
      customPalettes: s.customPalettes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      dirty: true,
    })),

  deletePalette: (id) =>
    set((s) => ({
      customPalettes: s.customPalettes.filter((p) => p.id !== id),
      activePaletteId: s.activePaletteId === id ? DEFAULT_PALETTE_ID : s.activePaletteId,
      dirty: true,
    })),

  addAnimation: (anim) => set((s) => ({ animations: [...s.animations, anim], activeAnimId: anim.id, dirty: true })),

  updateAnimation: (id, patch) =>
    set((s) => ({ animations: s.animations.map((a) => (a.id === id ? { ...a, ...patch } : a)), dirty: true })),

  deleteAnimation: (id) =>
    set((s) => {
      const animations = s.animations.filter((a) => a.id !== id)
      return {
        animations,
        activeAnimId: s.activeAnimId === id ? (animations[0]?.id ?? null) : s.activeAnimId,
        dirty: true,
      }
    }),

  setActiveAnim: (id) => set({ activeAnimId: id }),

  duplicateAnimation: (id) => {
    const src = get().animations.find((a) => a.id === id)
    if (!src) return null
    const copy: Animation = {
      ...src,
      id: uid(),
      name: `${src.name} copy`,
      tracks: Object.fromEntries(Object.entries(src.tracks).map(([k, v]) => [k, v.map((kf) => ({ ...kf, pos: [...kf.pos] as Vec3, rot: [...kf.rot] as Vec3 }))])),
      snapshots: { ...src.snapshots },
    }
    set((s) => ({ animations: [...s.animations, copy], activeAnimId: copy.id, dirty: true }))
    return copy.id
  },

  setKeyframe: (animId, layerId, kf) =>
    set((s) => ({
      animations: s.animations.map((a) => {
        if (a.id !== animId) return a
        const track = (a.tracks[layerId] ?? []).filter((k) => k.frame !== kf.frame)
        track.push(kf)
        track.sort((p, q) => p.frame - q.frame)
        return { ...a, tracks: { ...a.tracks, [layerId]: track } }
      }),
      dirty: true,
    })),

  removeKeyframe: (animId, layerId, frame) =>
    set((s) => ({
      animations: s.animations.map((a) => {
        if (a.id !== animId) return a
        const track = (a.tracks[layerId] ?? []).filter((k) => k.frame !== frame)
        return { ...a, tracks: { ...a.tracks, [layerId]: track } }
      }),
      dirty: true,
    })),
}))

let infoCache: { layers: Layer[]; info: LayerInfo } | null = null

export function getLayerInfo(): LayerInfo {
  const layers = useProject.getState().layers
  if (!infoCache || infoCache.layers !== layers) infoCache = { layers, info: new LayerInfo(layers) }
  return infoCache.info
}

export function allPalettes(custom: Palette[]): Palette[] {
  return [...PRESET_PALETTES, ...custom]
}

history.subscribe(() => useProject.getState().markDirty())
