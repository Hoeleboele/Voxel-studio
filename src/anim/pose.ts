import type { Animation, Keyframe, Layer, PartId, Vec3 } from '../core/types'

export interface Pose { pos: Vec3; rot: Vec3 }

export const ZERO_POSE: Pose = { pos: [0, 0, 0], rot: [0, 0, 0] }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Interpolated pose of one layer at a (possibly fractional) frame. */
export function samplePose(anim: Animation, layerId: number, frame: number): Pose {
  const track = anim.tracks[layerId]
  if (!track || track.length === 0) return ZERO_POSE
  if (track.length === 1) return { pos: track[0].pos, rot: track[0].rot }

  let prev: Keyframe | null = null
  let next: Keyframe | null = null
  for (const k of track) {
    if (k.frame <= frame) prev = k
    else { next = k; break }
  }
  let prevFrame = prev?.frame ?? 0
  let nextFrame = next?.frame ?? 0
  if (anim.loop) {
    if (!prev) { prev = track[track.length - 1]; prevFrame = prev.frame - anim.length }
    if (!next) { next = track[0]; nextFrame = next.frame + anim.length }
  } else {
    if (!prev) return { pos: next!.pos, rot: next!.rot }
    if (!next) return { pos: prev.pos, rot: prev.rot }
  }
  const span = nextFrame - prevFrame
  const t = span === 0 ? 0 : (frame - prevFrame) / span
  return { pos: lerp3(prev!.pos, next!.pos, t), rot: lerp3(prev!.rot, next!.rot, t) }
}

export type AnimTemplate = 'walk' | 'idle' | 'attack'

export const ANIM_TEMPLATES: { id: AnimTemplate; label: string }[] = [
  { id: 'walk', label: 'Walk cycle' },
  { id: 'idle', label: 'Idle' },
  { id: 'attack', label: 'Attack' },
]

const UPPER: PartId[] = ['torso', 'head', 'armL', 'armR', 'tail', 'weapon', 'accessory']
const isLeg = (p: PartId) => p.startsWith('leg')

function walkPose(part: PartId, t: number): Pose | null {
  const th = 2 * Math.PI * t
  const s = Math.sin(th)
  const bob = 0.5 * Math.abs(Math.cos(th))
  const pose = (rx = 0, ry = 0, y = 0): Pose => ({ pos: [0, y, 0], rot: [rx, ry, 0] })
  switch (part) {
    case 'legL': case 'legFL': case 'legBR': return pose(35 * s)
    case 'legR': case 'legFR': case 'legBL': return pose(-35 * s)
    case 'armL': return pose(-30 * s, 0, bob)
    case 'armR': return pose(30 * s, 0, bob)
    case 'tail': return pose(0, 12 * Math.sin(2 * th), bob)
    case 'head': case 'torso': case 'weapon': case 'accessory': return pose(0, 0, bob)
    default: return null
  }
}

function idlePose(part: PartId, t: number): Pose | null {
  const th = 2 * Math.PI * t
  const s = Math.sin(th)
  const y = Math.max(0, s)
  switch (part) {
    case 'armL': return { pos: [0, y, 0], rot: [0, 0, -4 * s] }
    case 'armR': return { pos: [0, y, 0], rot: [0, 0, 4 * s] }
    case 'head': return { pos: [0, y, 0], rot: [2 * Math.sin(th + 0.6), 0, 0] }
    case 'tail': return { pos: [0, y, 0], rot: [0, 10 * s, 0] }
    case 'torso': case 'weapon': case 'accessory': return { pos: [0, y, 0], rot: [0, 0, 0] }
    default: return null
  }
}

const ATTACK_ARM = [0, 35, 55, -30, -100, -110, -60, -10]
const ATTACK_LUNGE = [0, -1, -1, 0, 1, 2, 1, 0]
const ATTACK_HEAD = [0, -8, -15, 10, 30, 25, 10, 0]

function attackPose(part: PartId, frame: number): Pose | null {
  const i = Math.min(frame, 7)
  const z = ATTACK_LUNGE[i]
  switch (part) {
    case 'armR': case 'weapon': return { pos: [0, 0, z], rot: [ATTACK_ARM[i], 0, 0] }
    case 'armL': return { pos: [0, 0, z], rot: [-ATTACK_ARM[i] * 0.3, 0, 0] }
    case 'head': return { pos: [0, 0, z], rot: [ATTACK_HEAD[i], 0, 0] }
    case 'torso': case 'tail': case 'accessory': return { pos: [0, 0, z], rot: [0, 0, 0] }
    default: return null
  }
}

export function makeTemplateAnimation(template: AnimTemplate, layers: Layer[], id: string): Animation {
  const length = 8
  const anim: Animation = {
    id,
    name: ANIM_TEMPLATES.find((t) => t.id === template)!.label,
    fps: template === 'attack' ? 12 : template === 'idle' ? 6 : 8,
    length,
    loop: template !== 'attack',
    tracks: {},
    snapshots: {},
  }
  for (const layer of layers) {
    if (!layer.part || layer.isGroup) continue
    const keys: Keyframe[] = []
    for (let f = 0; f < length; f++) {
      const t = f / length
      const pose = template === 'walk' ? walkPose(layer.part, t)
        : template === 'idle' ? idlePose(layer.part, t)
          : attackPose(layer.part, f)
      if (!pose) break
      const round = (v: Vec3): Vec3 => v.map((n) => Math.round(n * 100) / 100) as Vec3
      keys.push({ frame: f, pos: round(pose.pos), rot: round(pose.rot) })
    }
    if (keys.length > 0) anim.tracks[layer.id] = keys
  }
  return anim
}

export function templateTargets(layers: Layer[]): number {
  return layers.filter((l) => l.part && (UPPER.includes(l.part) || isLeg(l.part))).length
}
