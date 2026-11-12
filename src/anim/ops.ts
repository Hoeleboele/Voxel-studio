import type { Animation, Keyframe, Layer, Vec3 } from '../core/types'
import { OPPOSITE_PART } from '../ui/parts'
import { samplePose } from './pose'
import type { Pose } from './pose'

const r2 = (v: number) => Math.round(v * 100) / 100
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const round3 = (v: Vec3): Vec3 => [r2(v[0]), r2(v[1]), r2(v[2])]

function dense(
  base: Animation, id: string, name: string, length: number, layerIds: number[],
  sampler: (layerId: number, f: number) => Pose, extra: Partial<Animation> = {},
): Animation {
  const tracks: Record<number, Keyframe[]> = {}
  for (const l of layerIds) {
    const keys: Keyframe[] = []
    for (let f = 0; f < length; f++) {
      const p = sampler(l, f)
      keys.push({ frame: f, pos: round3(p.pos), rot: round3(p.rot) })
    }
    tracks[l] = keys
  }
  return { ...base, id, name, length, tracks, snapshots: {}, ...extra }
}

const trackIds = (a: Animation) => Object.keys(a.tracks).map(Number).filter((k) => a.tracks[k].length > 0)

export function reverse(a: Animation, id: string): Animation {
  const last = a.length - 1
  return dense(a, id, `${a.name} reversed`, a.length, trackIds(a), (l, f) => samplePose({ ...a, loop: false }, l, last - f), {
    snapshots: Object.fromEntries(Object.entries(a.snapshots).map(([f, s]) => [last - Number(f), s])),
  })
}

export function pingPong(a: Animation, id: string): Animation {
  const n = Math.max(1, a.length * 2 - 2)
  const frameAt = (f: number) => (f < a.length ? f : 2 * (a.length - 1) - f)
  const snapshots: Record<number, Uint8Array> = {}
  for (let f = 0; f < n; f++) if (a.snapshots[frameAt(f)]) snapshots[f] = a.snapshots[frameAt(f)]
  return dense(a, id, `${a.name} ping-pong`, n, trackIds(a), (l, f) => samplePose({ ...a, loop: false }, l, frameAt(f)), { loop: true, snapshots })
}

export function trim(a: Animation, from: number, to: number, id: string): Animation {
  const lo = Math.max(0, Math.min(from, to))
  const hi = Math.min(a.length - 1, Math.max(from, to))
  const snapshots: Record<number, Uint8Array> = {}
  for (let f = lo; f <= hi; f++) if (a.snapshots[f]) snapshots[f - lo] = a.snapshots[f]
  return dense(a, id, `${a.name} ${lo}-${hi}`, hi - lo + 1, trackIds(a), (l, f) => samplePose({ ...a, loop: false }, l, lo + f), { snapshots })
}

export function resample(a: Animation, length: number, id: string): Animation {
  const n = Math.max(1, Math.min(120, Math.round(length)))
  const scale = a.loop || n === 1 ? a.length / n : (a.length - 1) / (n - 1)
  const snapshots: Record<number, Uint8Array> = {}
  for (let f = 0; f < n; f++) {
    const s = a.snapshots[Math.min(a.length - 1, Math.round(f * scale))]
    if (s) snapshots[f] = s
  }
  return dense(a, id, `${a.name} x${(n / a.length).toFixed(2)}`, n, trackIds(a), (l, f) => samplePose(a, l, f * scale), { snapshots })
}

/** Cross-fades the last frames into the first so the animation can loop without a pop. */
export function seamlessLoop(a: Animation, blendFrames: number, id: string): Animation {
  const k = Math.max(1, Math.min(Math.floor(a.length / 2), Math.round(blendFrames)))
  const first = (l: number) => samplePose(a, l, 0)
  return dense(a, id, `${a.name} loop`, a.length, trackIds(a), (l, f) => {
    const p = samplePose({ ...a, loop: false }, l, f)
    const i = f - (a.length - k)
    if (i < 0) return p
    const w = (i + 1) / (k + 1)
    const s = first(l)
    return { pos: lerp3(p.pos, s.pos, w), rot: lerp3(p.rot, s.rot, w) }
  }, { loop: true })
}

/** Swaps left/right limb tracks and mirrors motion across the body's X axis. */
export function mirrorAnimation(a: Animation, layers: Layer[], id: string): Animation {
  const byPart = new Map<string, Layer>()
  for (const l of layers) if (l.part && !l.isGroup && !byPart.has(l.part)) byPart.set(l.part, l)
  const source = (l: Layer): number => {
    const opp = l.part ? OPPOSITE_PART[l.part] : undefined
    return opp && byPart.has(opp) ? byPart.get(opp)!.id : l.id
  }
  const ids = layers.filter((l) => l.part && !l.isGroup && (a.tracks[source(l)]?.length ?? 0) > 0).map((l) => l.id)
  const src = new Map(layers.map((l) => [l.id, source(l)]))
  return dense(a, id, `${a.name} mirrored`, a.length, ids, (l, f) => {
    const p = samplePose(a, src.get(l) ?? l, f)
    return { pos: [-p.pos[0], p.pos[1], p.pos[2]], rot: [p.rot[0], -p.rot[1], -p.rot[2]] }
  }, { snapshots: {} })
}

export interface BlendOptions {
  mode: 'crossfade' | 'mix'
  frames: number // transition length for cross-fades
  weight: number // share of the second animation for mixes
}

export function blendAnimations(a: Animation, b: Animation, o: BlendOptions, id: string): Animation {
  const ids = [...new Set([...trackIds(a), ...trackIds(b)])]
  if (o.mode === 'mix') {
    const w = Math.max(0, Math.min(1, o.weight))
    const n = Math.max(a.length, b.length)
    return dense(a, id, `${a.name} + ${b.name}`, n, ids, (l, f) => {
      const p = samplePose(a, l, f)
      const q = samplePose(b, l, f)
      return { pos: lerp3(p.pos, q.pos, w), rot: lerp3(p.rot, q.rot, w) }
    }, { loop: a.loop && b.loop })
  }
  const k = Math.max(0, Math.min(60, Math.round(o.frames)))
  const n = Math.min(120, a.length + k + b.length)
  return dense(a, id, `${a.name} to ${b.name}`, n, ids, (l, f) => {
    if (f < a.length) return samplePose({ ...a, loop: false }, l, f)
    if (f < a.length + k) {
      const t = (f - a.length + 1) / (k + 1)
      const p = samplePose({ ...a, loop: false }, l, a.length - 1)
      const q = samplePose({ ...b, loop: false }, l, 0)
      return { pos: lerp3(p.pos, q.pos, t), rot: lerp3(p.rot, q.rot, t) }
    }
    return samplePose(b, l, f - a.length - k)
  }, { fps: a.fps, loop: b.loop, kind: 'custom', variant: 'blend' })
}

export function duplicateAs(a: Animation, id: string): Animation {
  return {
    ...a, id, name: `${a.name} copy`,
    tracks: Object.fromEntries(Object.entries(a.tracks).map(([k, v]) => [k, v.map((kf) => ({ ...kf, pos: [...kf.pos] as Vec3, rot: [...kf.rot] as Vec3 }))])),
    snapshots: { ...a.snapshots },
  }
}
