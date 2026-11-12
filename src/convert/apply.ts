import { create } from 'zustand'
import { EditBatch } from '../core/edit'
import type { Animation, Layer, Vec3 } from '../core/types'
import { VoxelGrid } from '../core/voxelGrid'
import { serializeVoxels } from '../core/voxelIO'
import { useEditor } from '../store/editorStore'
import { grid, makeLayer, uid, useProject } from '../store/projectStore'
import { engine } from '../viewport/engine'
import { reconstruct } from './reconstruct'
import type { PlacedVoxel, ReconstructOptions, Reconstruction } from './reconstruct'
import { sliceSheet } from './slice'
import type { LayerHint, RgbaImage, SpriteSource } from './types'

export interface ConvertSession {
  frames: RgbaImage[]
  durations: number[]
  tags: { name: string; from: number; to: number }[]
  hints: LayerHint[]
  opts: ReconstructOptions
  layerIds: Record<string, number> // spec key -> layer id
  animIds: string[]
  /** World coordinate of the model's depth centre, so depth changes grow symmetrically. */
  depthCenter: number
  origin: Vec3
  merged: boolean // converted into an existing project
}

interface ConvertStore {
  session: ConvertSession | null
  set(s: ConvertSession | null): void
}

export const useConvert = create<ConvertStore>((set) => ({ session: null, set: (session) => set({ session }) }))

export const MAX_FRAMES = 120

/** Slices a sheet if needed and returns the frames that will be converted. */
export function prepareFrames(src: SpriteSource, cols = 0, rows = 0): RgbaImage[] {
  let frames = src.needsSlicing ? sliceSheet(src.frames[0], { cols, rows }) : src.frames
  if (frames.length > MAX_FRAMES) frames = frames.slice(0, MAX_FRAMES)
  return frames
}

function originFor(r: Reconstruction, bounds: Vec3, depthCenter: number | null, mid: number): Vec3 {
  const front = r.seg.facing === 'front'
  const ox = front ? Math.floor((bounds[0] - r.size[0]) / 2) : (depthCenter ?? Math.floor(bounds[0] / 2)) - mid
  const oz = front ? (depthCenter ?? Math.floor(bounds[2] / 2)) - mid : Math.floor((bounds[2] - r.size[2]) / 2)
  return [ox, 0, oz]
}

function snapshotOf(frame: PlacedVoxel[], origin: Vec3, layerIds: Record<string, number>, keepOthers: boolean, bounds: Vec3): Uint8Array {
  const g = new VoxelGrid()
  g.bounds = [...bounds]
  if (keepOthers) {
    const mine = new Set(Object.values(layerIds))
    grid.forEach((x, y, z, c, l, m) => { if (!mine.has(l)) g.set(x, y, z, c, l, m) })
  }
  for (const v of frame) g.set(v.x + origin[0], v.y + origin[1], v.z + origin[2], v.color, layerIds[v.key] ?? 0, 0)
  return serializeVoxels(g)
}

function buildAnimations(
  r: Reconstruction, s: Pick<ConvertSession, 'durations' | 'tags' | 'layerIds' | 'origin'>, keepOthers: boolean, bounds: Vec3,
): Animation[] {
  if (r.frames.length < 2) return []
  const snaps = r.frames.map((f) => snapshotOf(f, s.origin, s.layerIds, keepOthers, bounds))
  const mk = (name: string, from: number, to: number): Animation => {
    const durs = s.durations.slice(from, to + 1).filter((d) => d > 0).sort((a, b) => a - b)
    const dur = durs.length ? durs[Math.floor(durs.length / 2)] : 100
    const snapshots: Record<number, Uint8Array> = {}
    for (let i = from; i <= to; i++) snapshots[i - from] = snaps[i]
    return {
      id: uid(), name, fps: Math.max(1, Math.min(60, Math.round(1000 / dur))), length: to - from + 1,
      loop: true, tracks: {}, snapshots, kind: 'custom', variant: 'sprite',
    }
  }
  const tags = s.tags.filter((t) => t.from >= 0 && t.to < r.frames.length && t.to >= t.from)
  return tags.length ? tags.map((t) => mk(t.name || 'Tag', t.from, t.to)) : [mk('Sprite frames', 0, r.frames.length - 1)]
}

export interface ConvertRequest {
  source: SpriteSource
  frames: RgbaImage[]
  opts: ReconstructOptions
  name: string
  mode: 'new' | 'add'
  /** Convert every frame into its own model, laid out in a grid, instead of one model with animation frames. */
  separate?: boolean
}

export interface ConvertResult { voxels: number; layers: number; animations: Animation[] }

const GAP = 2

/** Converts each frame to an independent model (a layer group each) arranged in a grid on the XZ plane. */
function convertSeparate(req: ConvertRequest): ConvertResult {
  const recs: Reconstruction[] = []
  for (const f of req.frames) {
    try { recs.push(reconstruct([f], req.opts, [])) } catch { /* frame without visible pixels */ }
  }
  if (recs.length === 0) throw new Error('The sprites have no visible pixels')

  const cellW = Math.max(...recs.map((r) => r.size[0]))
  const cellH = Math.max(...recs.map((r) => r.size[1]))
  const cellD = Math.max(...recs.map((r) => r.size[2]))
  const maxCols = Math.floor((256 - GAP) / (cellW + GAP))
  const maxRows = Math.floor((256 - GAP) / (cellD + GAP))
  if (maxCols < 1 || maxRows < 1 || maxCols * maxRows < recs.length || cellH + 2 > 256) {
    throw new Error(`${recs.length} sprites do not fit in a 256 voxel grid. Lower the scale or depth, or convert fewer sprites`)
  }
  const cols = Math.min(maxCols, Math.max(Math.ceil(recs.length / maxRows), Math.ceil(Math.sqrt(recs.length))))
  const rows = Math.ceil(recs.length / cols)
  const width = cols * (cellW + GAP) + GAP
  const depth = rows * (cellD + GAP) + GAP

  const project = useProject.getState()
  const merge = req.mode === 'add'
  const baseX = merge ? (grid.bbox()?.max[0] ?? -GAP) + 1 : 0
  const need: Vec3 = merge
    ? [Math.max(project.bounds[0], baseX + width), Math.max(project.bounds[1], cellH + 2), Math.max(project.bounds[2], depth)]
    : [Math.max(16, width), Math.max(16, cellH + 2), Math.max(16, depth)]
  if (need.some((n) => n > 256)) throw new Error('The converted sprites do not fit in a 256 voxel grid')

  useConvert.getState().set(null)
  const layers: Layer[] = []
  const place: { rec: Reconstruction; ids: Record<string, number>; origin: Vec3 }[] = []
  let nextId = 1
  recs.forEach((rec, i) => {
    const origin: Vec3 = [
      baseX + GAP + (i % cols) * (cellW + GAP) + Math.floor((cellW - rec.size[0]) / 2),
      0,
      GAP + Math.floor(i / cols) * (cellD + GAP) + Math.floor((cellD - rec.size[2]) / 2),
    ]
    const ids: Record<string, number> = {}
    if (merge) {
      const gid = project.addLayer({ name: `${req.name} ${i + 1}`, group: true })
      for (const sp of rec.specs) {
        const id = project.addLayer({ name: sp.name })
        project.setLayerParent(id, gid)
        ids[sp.key] = id
      }
    } else {
      const gid = nextId++
      layers.push(makeLayer(gid, `${req.name} ${i + 1}`, { isGroup: true }))
      for (const sp of rec.specs) {
        ids[sp.key] = nextId
        layers.push(makeLayer(nextId++, sp.name, { part: sp.part, parentId: gid }))
      }
    }
    place.push({ rec, ids, origin })
  })

  if (merge) {
    if (need.some((n, i) => n !== project.bounds[i])) project.setBounds(need)
  }
  const setPivots = (update: (id: number, patch: Partial<Layer>) => void) => {
    for (const { rec, ids, origin } of place) {
      for (const sp of rec.specs) {
        const pv = rec.pivots[sp.key]
        update(ids[sp.key], { part: sp.part, ...(pv ? { pivot: [pv[0] + origin[0], pv[1] + origin[1], pv[2] + origin[2]] as Vec3 } : {}) })
      }
    }
  }

  let voxels = 0
  if (merge) {
    setPivots((id, patch) => project.updateLayer(id, patch))
    const batch = new EditBatch(grid)
    for (const { rec, ids, origin } of place) {
      for (const v of rec.frames[0]) {
        const x = v.x + origin[0], y = v.y + origin[1], z = v.z + origin[2]
        if (grid.inBounds(x, y, z) && batch.setVoxel(x, y, z, v.color, ids[v.key] ?? Object.values(ids)[0], 0)) voxels++
      }
    }
    batch.commit('Convert sprites')
  } else {
    setPivots((id, patch) => { Object.assign(layers.find((l) => l.id === id)!, patch) })
    project.resetProject({ bounds: need, layers, meta: { name: req.name } })
    for (const { rec, ids, origin } of place) {
      for (const v of rec.frames[0]) {
        grid.set(v.x + origin[0], v.y + origin[1], v.z + origin[2], v.color, ids[v.key] ?? Object.values(ids)[0], 0)
        voxels++
      }
    }
    grid.touch()
  }
  useEditor.getState().setSelection([])
  engine?.frame()
  return { voxels, layers: recs.length, animations: [] }
}

export function convertSprite(req: ConvertRequest): ConvertResult {
  if (req.separate && req.frames.length > 1) return convertSeparate(req)
  const r = reconstruct(req.frames, req.opts, req.source.layerHints)
  const project = useProject.getState()
  const depth = Math.max(1, Math.round(req.opts.depth))
  const mid = Math.floor(depth / 2)
  const margin = 4
  const fit = (n: number) => Math.min(256, Math.max(16, n + margin + ((n + margin) % 2)))
  let origin: Vec3
  let layerIds: Record<string, number> = {}
  let depthCenter: number

  if (req.mode === 'new') {
    const bounds: Vec3 = [fit(r.size[0]), fit(r.size[1]), fit(r.size[2])]
    const specLayers: Layer[] = []
    r.specs.forEach((sp, i) => {
      layerIds[sp.key] = i + 1
      specLayers.push(makeLayer(i + 1, sp.name, { part: sp.part }))
    })
    depthCenter = Math.floor((r.seg.facing === 'front' ? bounds[2] : bounds[0]) / 2)
    origin = originFor(r, bounds, depthCenter, mid)
    specLayers.forEach((l, i) => {
      const pv = r.pivots[r.specs[i].key]
      if (pv) l.pivot = [pv[0] + origin[0], pv[1] + origin[1], pv[2] + origin[2]]
    })
    useConvert.getState().set(null)
    project.resetProject({ bounds, layers: specLayers, meta: { name: req.name } })
    for (const v of r.frames[0]) grid.set(v.x + origin[0], v.y + origin[1], v.z + origin[2], v.color, layerIds[v.key] ?? 1, 0)
    grid.touch()
  } else {
    const need: Vec3 = [Math.max(project.bounds[0], r.size[0]), Math.max(project.bounds[1], r.size[1]), Math.max(project.bounds[2], r.size[2])]
    if (need.some((n, i) => n !== project.bounds[i])) project.setBounds(need)
    const created: number[] = []
    r.specs.forEach((sp) => {
      const id = project.addLayer({ name: sp.name })
      layerIds[sp.key] = id
      created.push(id)
    })
    depthCenter = Math.floor((r.seg.facing === 'front' ? grid.bounds[2] : grid.bounds[0]) / 2)
    origin = originFor(r, grid.bounds, depthCenter, mid)
    r.specs.forEach((sp) => {
      const pv = r.pivots[sp.key]
      project.updateLayer(layerIds[sp.key], {
        part: sp.part,
        ...(pv ? { pivot: [pv[0] + origin[0], pv[1] + origin[1], pv[2] + origin[2]] as Vec3 } : {}),
      })
    })
    const batch = new EditBatch(grid)
    for (const v of r.frames[0]) batch.setVoxel(v.x + origin[0], v.y + origin[1], v.z + origin[2], v.color, layerIds[v.key] ?? created[0], 0)
    batch.commit('Convert sprite')
  }

  const session: ConvertSession = {
    frames: req.frames, durations: req.source.durations, tags: req.source.tags, hints: req.source.layerHints ?? [],
    opts: req.opts, layerIds, animIds: [], depthCenter, origin, merged: req.mode === 'add',
  }
  const anims = buildAnimations(r, session, req.mode === 'add', grid.bounds)
  for (const a of anims) project.addAnimation(a)
  session.animIds = anims.map((a) => a.id)
  useConvert.getState().set(session)
  useEditor.getState().setSelection([])
  engine?.frame()
  return { voxels: r.frames[0].length, layers: r.specs.length, animations: anims }
}

/** Re-runs the depth reconstruction for the converted layers (depth, mode, shading, smoothing). */
export function readjustDepth(patch: Partial<Pick<ReconstructOptions, 'depth' | 'mode' | 'shadingBias' | 'smoothing'>>): void {
  const session = useConvert.getState().session
  if (!session) return
  const opts = { ...session.opts, ...patch }
  const r = reconstruct(session.frames, opts, session.hints)
  const project = useProject.getState()
  const need: Vec3 = [Math.max(project.bounds[0], r.size[0] + 1), Math.max(project.bounds[1], r.size[1] + 1), Math.max(project.bounds[2], r.size[2] + 1)]
  if (need.some((n, i) => n !== project.bounds[i])) {
    if (!project.setBounds(need)) throw new Error('Cannot grow the grid for this depth')
  }
  const mid = Math.floor(Math.max(1, Math.round(opts.depth)) / 2)
  const origin = originFor(r, grid.bounds, session.depthCenter, mid)
  const mine = new Set(Object.values(session.layerIds))

  const batch = new EditBatch(grid)
  const old: [number, number, number][] = []
  grid.forEach((x, y, z, _c, l) => { if (mine.has(l)) old.push([x, y, z]) })
  for (const [x, y, z] of old) batch.removeVoxel(x, y, z)
  const fallback = Object.values(session.layerIds)[0]
  for (const v of r.frames[0]) {
    const x = v.x + origin[0], y = v.y + origin[1], z = v.z + origin[2]
    if (grid.inBounds(x, y, z)) batch.setVoxel(x, y, z, v.color, session.layerIds[v.key] ?? fallback, 0)
  }
  batch.commit('Adjust sprite depth')

  for (const sp of r.specs) {
    const id = session.layerIds[sp.key]
    const pv = r.pivots[sp.key]
    if (id && pv) project.updateLayer(id, { pivot: [pv[0] + origin[0], pv[1] + origin[1], pv[2] + origin[2]] })
  }

  const next: ConvertSession = { ...session, opts, origin }
  const anims = buildAnimations(r, { ...next }, session.merged, grid.bounds)
  const existing = useProject.getState().animations
  const byId = new Map(existing.map((a) => [a.id, a]))
  session.animIds.forEach((id, i) => {
    if (byId.has(id) && anims[i]) project.updateAnimation(id, { snapshots: anims[i].snapshots })
  })
  useConvert.getState().set(next)
  engine?.frame()
}

// ---------------------------------------------------------------- project persistence

interface SessionJson extends Omit<ConvertSession, 'frames' | 'hints'> {
  frameSizes: [number, number][]
  hintNames: string[]
}

/** Extra project-file entries so depth can still be adjusted after reopening. */
export function serializeSession(): Record<string, Uint8Array> | null {
  const s = useConvert.getState().session
  if (!s) return null
  const { frames, hints, ...rest } = s
  const json: SessionJson = { ...rest, frameSizes: frames.map((f) => [f.w, f.h]), hintNames: hints.map((h) => h.name) }
  const pixels = new Uint8Array(frames.reduce((n, f) => n + f.data.length, 0))
  let o = 0
  for (const f of frames) { pixels.set(f.data, o); o += f.data.length }
  const masks = new Uint8Array(hints.reduce((n, h) => n + h.mask.length, 0))
  o = 0
  for (const h of hints) { masks.set(h.mask, o); o += h.mask.length }
  return {
    'convert.json': new TextEncoder().encode(JSON.stringify(json)),
    'convert_frames.bin': pixels,
    'convert_hints.bin': masks,
  }
}

export function restoreSession(files: Record<string, Uint8Array>): void {
  const raw = files['convert.json']
  const pixels = files['convert_frames.bin']
  if (!raw || !pixels) { useConvert.getState().set(null); return }
  const json = JSON.parse(new TextDecoder().decode(raw)) as SessionJson
  const frames: RgbaImage[] = []
  let o = 0
  for (const [w, h] of json.frameSizes) {
    frames.push({ w, h, data: new Uint8ClampedArray(pixels.slice(o, o + w * h * 4)) })
    o += w * h * 4
  }
  const hints: LayerHint[] = []
  const maskBytes = files['convert_hints.bin']
  const size = frames[0] ? frames[0].w * frames[0].h : 0
  o = 0
  for (const name of json.hintNames) {
    if (!maskBytes) break
    hints.push({ name, mask: maskBytes.slice(o, o + size) })
    o += size
  }
  const { frameSizes: _fs, hintNames: _hn, ...rest } = json
  useConvert.getState().set({ ...rest, frames, hints })
}
