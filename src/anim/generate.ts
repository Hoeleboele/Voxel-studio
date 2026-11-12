import * as THREE from 'three'
import type { Animation, AnimKind, Keyframe, Layer, PartId, Species, Vec3 } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { layerPivot } from '../io/rig'
import { detectSpecies, measureCharacter, profileFor } from './species'
import type { Metrics, Profile } from './species'

export type GenKind = 'idle' | 'walk' | 'jump' | 'hurt' | 'death'
export type HitDir = 'front' | 'back' | 'left' | 'right'
export type DeathVariant = 'fallBack' | 'fallForward' | 'topple' | 'collapse' | 'crumble'

export interface GenOptions {
  speed: number // walk speed multiplier
  knockback: number // voxels
  direction: HitDir
  jumpHeight: number // multiplier
  death: DeathVariant | 'auto'
}

export const DEFAULT_GEN: GenOptions = { speed: 1, knockback: 2, direction: 'front', jumpHeight: 1, death: 'auto' }

export const DEATH_LABEL: Record<DeathVariant, string> = {
  fallBack: 'Fall backward', fallForward: 'Fall forward', topple: 'Topple sideways', collapse: 'Kneel and collapse', crumble: 'Crumble apart',
}

export interface GenContext {
  layers: Layer[] // layers tagged with a body part
  pivot: Map<number, Vec3>
  side: Partial<Record<PartId, number>> // +1 on the +X side of the body, -1 on the other
  metrics: Metrics
  species: Species
  profile: Profile
}

export function makeContext(grid: VoxelGrid, layers: Layer[], override?: Species): GenContext {
  const metrics = measureCharacter(grid, layers)
  const species = override ?? detectSpecies(metrics, layers)
  const parted = layers.filter((l) => l.part && !l.isGroup)
  const pivot = new Map<number, Vec3>()
  const side: Partial<Record<PartId, number>> = {}
  for (const l of parted) {
    const p = layerPivot(grid, l) ?? metrics.hips
    pivot.set(l.id, p)
    if (side[l.part!] === undefined) {
      const dx = p[0] - metrics.hips[0]
      side[l.part!] = Math.abs(dx) > 0.5 ? Math.sign(dx) : l.part!.endsWith('L') ? 1 : -1
    }
  }
  return { layers: parted, pivot, side, metrics, species, profile: profileFor(species, metrics) }
}

// ------------------------------------------------------------------ math

const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (a: number, b: number, f: number) => { const t = clamp((f - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const stiffen = (x: number, k: number) => Math.sign(x) * Math.pow(Math.abs(x), 1 - 0.45 * k)
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }

interface LocalPose { pos?: Vec3; rot?: Vec3 }
interface FrameSpec {
  rootPos?: Vec3
  rootRot?: Vec3
  rootAbout?: Vec3
  local: Partial<Record<PartId, LocalPose>>
}

const PARENT: Partial<Record<PartId, PartId[]>> = {
  head: ['torso'], armL: ['torso'], armR: ['torso'], tail: ['torso'], wingL: ['torso'], wingR: ['torso'],
  weapon: ['armR', 'armL', 'torso'], accessory: ['torso'],
}

const deg = THREE.MathUtils.degToRad
const rotMatrix = (r: Vec3) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg(r[0]), deg(r[1]), deg(r[2]), 'XYZ'))
const about = (p: Vec3, pos: Vec3, rot: Vec3) =>
  new THREE.Matrix4().makeTranslation(p[0] + pos[0], p[1] + pos[1], p[2] + pos[2]).multiply(rotMatrix(rot)).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]))

/** Composes root motion, parent chains and local poses into one independent pose per layer. */
function bake(ctx: GenContext, frames: FrameSpec[]): Record<number, Keyframe[]> {
  const tracks: Record<number, Keyframe[]> = {}
  const partPivot = new Map<PartId, Vec3>()
  for (const l of ctx.layers) if (!partPivot.has(l.part!)) partPivot.set(l.part!, ctx.pivot.get(l.id)!)

  frames.forEach((spec, f) => {
    const root = about(spec.rootAbout ?? ctx.metrics.feet, spec.rootPos ?? [0, 0, 0], spec.rootRot ?? [0, 0, 0])
    const world = new Map<PartId, THREE.Matrix4>()
    const worldOf = (part: PartId): THREE.Matrix4 => {
      const cached = world.get(part)
      if (cached) return cached
      const lp = spec.local[part]
      const piv = partPivot.get(part) ?? ctx.metrics.hips
      const own = about(piv, lp?.pos ?? [0, 0, 0], lp?.rot ?? [0, 0, 0])
      const parent = (PARENT[part] ?? []).find((p) => partPivot.has(p))
      const m = parent ? worldOf(parent).clone().multiply(own) : own
      world.set(part, m)
      return m
    }
    for (const l of ctx.layers) {
      const piv = ctx.pivot.get(l.id)!
      const lp = spec.local[l.part!]
      const own = about(piv, lp?.pos ?? [0, 0, 0], lp?.rot ?? [0, 0, 0])
      const parent = (PARENT[l.part!] ?? []).find((p) => partPivot.has(p))
      const m = root.clone().multiply(parent ? worldOf(parent) : new THREE.Matrix4()).multiply(own)
      const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
      m.decompose(t, q, s)
      const at = new THREE.Vector3(piv[0], piv[1], piv[2]).applyMatrix4(m)
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
      const rot: Vec3 = [e.x, e.y, e.z].map((r) => (r * 180) / Math.PI) as Vec3
      const prev = tracks[l.id]?.[f - 1]
      if (prev) for (let k = 0; k < 3; k++) while (rot[k] - prev.rot[k] > 180) rot[k] -= 360
      if (prev) for (let k = 0; k < 3; k++) while (rot[k] - prev.rot[k] < -180) rot[k] += 360
      const r2 = (v: number) => Math.round(v * 100) / 100
      const kf: Keyframe = {
        frame: f,
        pos: [r2(at.x - piv[0]), r2(at.y - piv[1]), r2(at.z - piv[2])],
        rot: [r2(rot[0]), r2(rot[1]), r2(rot[2])],
      }
      ;(tracks[l.id] ??= []).push(kf)
    }
  })
  return tracks
}

// ------------------------------------------------------------------ gait helpers

const hasLegs = (ctx: GenContext, ...p: PartId[]) => p.some((x) => ctx.metrics.parts.has(x))
const quadruped = (ctx: GenContext) => hasLegs(ctx, 'legFL', 'legFR', 'legBL', 'legBR')

/** Gait phase offset of a leg part; arms swing against the leg on the same side. */
function legPhase(part: PartId): number {
  switch (part) {
    case 'legL': case 'legFL': case 'legBR': return 0
    case 'legR': case 'legFR': case 'legBL': return Math.PI
    default: return 0
  }
}

const LEGS: PartId[] = ['legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR']

function present(ctx: GenContext, parts: PartId[]): PartId[] { return parts.filter((p) => ctx.metrics.parts.has(p)) }

// ------------------------------------------------------------------ idle

function idleFrame(f: number, n: number, ctx: GenContext): FrameSpec {
  const { profile: pf, species, side } = ctx
  const th = (TAU * f) / n
  const b01 = (1 - Math.cos(th)) / 2
  const sh = species === 'robot' ? 0 : 1
  const local: FrameSpec['local'] = {}
  const set = (p: PartId, v: LocalPose) => { if (ctx.metrics.parts.has(p)) local[p] = v }

  set('torso', { pos: [0, pf.breath * b01, 0], rot: [sh * 1.2 * Math.sin(th), 0, 0] })
  if (species === 'robot') {
    const yaw = [0, 0, 0, 0, 0, 6, 6, 6, 6, 0, 0, 0, -6, -6, -6, 0][f % 16] ?? 0
    set('head', { rot: [0, yaw, 0] })
  } else {
    set('head', { rot: [1.6 * Math.sin(th - 0.9), 3 * Math.sin(th - 0.3), 0] })
  }
  for (const a of present(ctx, ['armL', 'armR'])) {
    set(a, { rot: [2 * Math.sin(th + 0.5) * sh, 0, (side[a] ?? 1) * (2 + 2 * b01)] })
  }
  set('tail', { rot: [0, pf.tail * 0.6 * Math.sin(th - 0.7), 0] })
  for (const w of present(ctx, ['wingL', 'wingR'])) set(w, { rot: [0, 0, (side[w] ?? 1) * pf.wing * 0.3 * Math.sin(th)] })
  if (quadruped(ctx)) set('head', { rot: [3 * Math.sin(th - 0.5), 2 * Math.sin(th), 0] })
  return {
    rootPos: [sh * 0.35 * Math.sin(th), 0, 0],
    rootRot: [0, 0, sh * pf.sway * 0.3 * Math.sin(th)],
    local,
  }
}

// ------------------------------------------------------------------ walk

function walkFrame(f: number, n: number, ctx: GenContext, o: GenOptions): FrameSpec {
  const { profile: pf, side, metrics } = ctx
  const th = (TAU * f) / n
  const speed = clamp(o.speed, 0.4, 2)
  const stride = Math.min(pf.stride * clamp(0.75 + 0.25 * speed, 0.8, 1.3), 36)
  const wave = (a: number) => (pf.stiff > 0 ? stiffen(Math.sin(a), pf.stiff * 0.7) : Math.sin(a))
  const lift = clamp(metrics.legLength * 0.12, 0.4, 2)
  const local: FrameSpec['local'] = {}
  const set = (p: PartId, v: LocalPose) => { if (metrics.parts.has(p)) local[p] = v }
  const quad = quadruped(ctx)
  const gait = hasLegs(ctx, ...LEGS)

  for (const leg of present(ctx, LEGS)) {
    const ph = legPhase(leg)
    set(leg, { pos: [0, lift * Math.max(0, Math.cos(th + ph)) * (pf.stiff ? 0.6 : 1), 0], rot: [-stride * wave(th + ph), 0, 0] })
  }
  if (!quad) {
    for (const a of present(ctx, ['armL', 'armR'])) {
      const ph = a === 'armL' ? Math.PI : 0
      set(a, { rot: [-pf.armSwing * wave(th + ph), 0, (side[a] ?? 1) * 3], pos: [0, 0, 0] })
    }
  }
  const twist = quad ? 0 : pf.twist
  set('torso', { rot: [quad ? 2 * Math.sin(2 * th) : 0, twist * Math.sin(th), 0] })
  set('head', { rot: [quad ? 4 * Math.sin(2 * th + 0.8) : 0, -twist * 0.8 * Math.sin(th), 0] })
  set('tail', { rot: [0, pf.tail * Math.sin(2 * th + 0.6), 0] })
  for (const w of present(ctx, ['wingL', 'wingR'])) set(w, { rot: [0, 0, (side[w] ?? 1) * pf.wing * 0.12 * Math.sin(2 * th)] })

  const bob = gait ? pf.bob * (0.5 + 0.5 * Math.cos(2 * th)) : pf.bob * 2 * Math.abs(Math.sin(th))
  if (!gait) set('torso', { rot: [4 * Math.sin(th), 0, 0], pos: [0, 0, 0] })
  return {
    rootPos: [0, bob, 0],
    rootRot: [0, 0, pf.sway * Math.sin(th)],
    rootAbout: metrics.feet,
    local: {
      ...local,
      torso: { ...local.torso, rot: [(local.torso?.rot?.[0] ?? 0) + pf.lean * clamp(speed, 0.5, 1.6), local.torso?.rot?.[1] ?? 0, 0] },
    },
  }
}

// ------------------------------------------------------------------ jump

const JUMP_FRAMES = 19

function jumpFrame(f: number, ctx: GenContext, o: GenOptions): FrameSpec {
  const { profile: pf, metrics, side } = ctx
  const crouch = clamp(metrics.legLength * 0.18 * Math.sqrt(pf.weight), 0.6, 3)
  const Hj = clamp((metrics.height * 0.55 * o.jumpHeight) / Math.sqrt(pf.weight), 2, metrics.height * 1.2)
  const quad = quadruped(ctx)
  const an = smooth(0, 3, f)
  const launch = smooth(3, 5, f)
  const inAir = f >= 5 && f < 13
  const ua = clamp((f - 5) / 8, 0, 1)
  const lw = f >= 13 ? clamp((f - 13) / 5, 0, 1) : 0
  const landCurve = Math.sin(Math.PI * lw)

  let y = -crouch * an * (1 - launch)
  if (inAir) y = Hj * 4 * ua * (1 - ua)
  if (f >= 13) y = -crouch * 1.4 * landCurve

  const armX = f < 3 ? lerp(0, 40, an) : f < 5 ? lerp(40, -140, launch) : inAir ? lerp(-140, -105, ua) : lerp(-105, 0, smooth(13, 18, f))
  const torsoX = f < 3 ? 14 * an : f < 5 ? lerp(14, -4, launch) : inAir ? 0 : 18 * landCurve
  const lean = inAir ? lerp(5, -6, ua) : 0
  const tuck = inAir ? Math.sin(Math.PI * ua) : 0
  const flap = inAir ? Math.sin(Math.PI * 2 * ua * 1.5) : 0

  const local: FrameSpec['local'] = {}
  const set = (p: PartId, v: LocalPose) => { if (metrics.parts.has(p)) local[p] = v }
  set('torso', { rot: [torsoX, 0, 0] })
  set('head', { rot: [f < 3 ? 8 * an : f >= 13 ? 8 * landCurve : -6 * launch * (inAir ? 1 : 0), 0, 0] })
  if (!quad) for (const a of present(ctx, ['armL', 'armR'])) set(a, { rot: [armX, 0, (side[a] ?? 1) * (inAir ? 18 * tuck : 6)] })
  for (const leg of present(ctx, LEGS)) {
    const front = leg.startsWith('legF') || leg === 'legL'
    const sgn = leg.endsWith('R') ? -1 : 1
    const rot = inAir ? -22 * tuck + sgn * 8 * (front ? 1 : -1) * tuck : f >= 3 && f < 5 ? sgn * 10 * launch : 0
    set(leg, { rot: [rot, 0, 0] })
  }
  set('tail', { rot: [inAir ? -18 * (1 - ua) : 0, 0, 0] })
  for (const w of present(ctx, ['wingL', 'wingR'])) {
    set(w, { rot: [0, 0, (side[w] ?? 1) * pf.wing * (inAir ? 0.4 + 0.9 * (0.5 + 0.5 * flap) : 0.15)] })
  }
  return { rootPos: [0, y, 0], rootRot: [lean, 0, 0], rootAbout: metrics.hips, local }
}

// ------------------------------------------------------------------ hurt

function hurtFrame(f: number, n: number, ctx: GenContext, o: GenOptions): FrameSpec {
  const { profile: pf, metrics, side } = ctx
  const kb = o.knockback / Math.sqrt(pf.weight)
  const env = (t: number) => (t <= 2 ? t / 2 : Math.exp(-(t - 2) / (2.8 + kb * 0.25))) * clamp((n - 1 - t) / 2, 0, 1)
  let e = env(f)
  if (pf.stiff > 0) e = Math.ceil(e * 3) / 3
  const e2 = env(f - 1 < 0 ? 0 : f - 1)
  const amp = 0.6 + 0.4 * Math.min(1.5, 1 + kb / 3)
  const dir: Record<HitDir, { push: Vec3; tilt: Vec3 }> = {
    front: { push: [0, 0, -1], tilt: [-1, 0, 0] },
    back: { push: [0, 0, 1], tilt: [1, 0, 0] },
    left: { push: [-1, 0, 0], tilt: [0, 0, 1] },
    right: { push: [1, 0, 0], tilt: [0, 0, -1] },
  }
  const d = dir[o.direction]
  const frontBack = o.direction === 'front' || o.direction === 'back'
  const lift = kb > 3 ? 0.12 * kb * Math.sin(Math.PI * clamp(f / 6, 0, 1)) : 0

  const local: FrameSpec['local'] = {}
  const set = (p: PartId, v: LocalPose) => { if (metrics.parts.has(p)) local[p] = v }
  set('head', {
    rot: [d.tilt[0] * 28 * e2 * amp, pf.stiff > 0 ? 10 * (f % 2 ? 1 : -1) * e : 0, d.tilt[2] * 24 * e2 * amp],
  })
  set('torso', { rot: [d.tilt[0] * 6 * e, 0, d.tilt[2] * 5 * e] })
  for (const a of present(ctx, ['armL', 'armR'])) {
    const s = side[a] ?? 1
    set(a, { rot: [frontBack ? d.tilt[0] * 35 * e : 12 * e, 0, s * (frontBack ? 30 : 25) * e] })
  }
  for (const leg of present(ctx, LEGS)) {
    const k = leg.endsWith('R') ? -1 : 1
    set(leg, { rot: [frontBack ? -d.tilt[0] * 14 * e * k : 0, 0, frontBack ? 0 : -d.tilt[2] * 8 * e * k] })
  }
  set('tail', { rot: [0, pf.tail * 1.5 * Math.sin(f * 0.9) * e, 0] })
  for (const w of present(ctx, ['wingL', 'wingR'])) set(w, { rot: [0, 0, (side[w] ?? 1) * pf.wing * 1.1 * e] })
  return {
    rootPos: [d.push[0] * kb * e * amp, lift - 0.5 * e * (f < 4 ? 1 : 0), d.push[2] * kb * e * amp],
    rootRot: [d.tilt[0] * 20 * e * amp, 0, d.tilt[2] * 18 * e * amp],
    rootAbout: metrics.hips,
    local,
  }
}

// ------------------------------------------------------------------ death

function deathFrame(f: number, n: number, ctx: GenContext, variant: DeathVariant): FrameSpec {
  const { profile: pf, metrics, side } = ctx
  const local: FrameSpec['local'] = {}
  const set = (p: PartId, v: LocalPose) => { if (metrics.parts.has(p)) local[p] = v }
  const legs = present(ctx, LEGS)
  const arms = present(ctx, ['armL', 'armR'])
  const wings = present(ctx, ['wingL', 'wingR'])
  const wobble = clamp(1 - smooth(n - 5, n - 1, f), 0, 1)

  if (variant === 'fallBack' || variant === 'fallForward' || variant === 'topple') {
    const stagger = Math.sin(Math.PI * smooth(0, 4, f)) * (1 - smooth(3, 5, f))
    const g = Math.pow(smooth(3, n - 5, f), 1.6)
    const settle = f >= n - 5 ? Math.sin((f - (n - 5)) * 1.6) * Math.exp(-(f - (n - 5)) * 0.7) * 3 : 0
    const angle = 90 * g + settle * (g > 0.95 ? 1 : 0)
    const lift = (variant === 'topple' ? metrics.width : metrics.depth) / 2
    const sgn = variant === 'fallBack' ? -1 : 1
    const rootRot: Vec3 = variant === 'topple' ? [0, 0, angle] : [sgn * (angle + stagger * 6 * (variant === 'fallBack' ? 1 : 0)), 0, 0]
    set('head', { rot: [sgn * -15 * g * (variant === 'topple' ? 0 : 1), 0, variant === 'topple' ? 12 * g : 0] })
    for (const a of arms) set(a, { rot: [sgn * -40 * g * (variant === 'topple' ? 0 : 1), 0, (side[a] ?? 1) * (30 + 20 * stagger) * g] })
    for (const leg of legs) set(leg, { rot: [(leg.endsWith('R') ? 1 : -1) * 12 * g, 0, 0] })
    set('tail', { rot: [0, pf.tail * Math.sin(f * 0.8) * (1 - g), 0] })
    for (const w of wings) set(w, { rot: [0, 0, (side[w] ?? 1) * pf.wing * (0.2 + 1.2 * g * wobble + 0.5 * g)] })
    return { rootPos: [0, lift * Math.min(1, angle / 90), 0], rootRot, rootAbout: metrics.feet, local }
  }

  if (variant === 'collapse') {
    const kneel = smooth(2, 8, f)
    const slump = smooth(8, n - 2, f)
    const hit = Math.sin(Math.PI * smooth(0, 4, f)) * (1 - smooth(3, 5, f))
    for (const leg of legs) set(leg, { rot: [(leg.endsWith('R') ? 1 : 0.6) * 55 * kneel, 0, 0] })
    set('torso', { rot: [20 * slump, 0, 0] })
    set('head', { rot: [-18 * hit + 25 * slump, 0, 0] })
    for (const a of arms) set(a, { rot: [-20 * kneel + 55 * slump, 0, (side[a] ?? 1) * 12 * kneel] })
    set('tail', { rot: [0, pf.tail * Math.sin(f * 0.7) * (1 - kneel), 0] })
    for (const w of wings) set(w, { rot: [0, 0, (side[w] ?? 1) * pf.wing * 0.3 * (1 - slump)] })
    return {
      rootPos: [0, -metrics.legLength * 0.42 * kneel + (metrics.depth / 2) * slump * 0.5, -hit * 1.2],
      rootRot: [-8 * hit + 62 * slump, 0, 0],
      rootAbout: metrics.feet,
      local,
    }
  }

  // crumble: parts drop and sprawl one after another
  const hipsDrop = (metrics.hips[1] - metrics.feet[1]) * 0.85
  const s = (delay: number) => smooth(delay, delay + 7, f)
  const jitter = (seed: number) => (hash(seed) - 0.5) * 2
  for (const leg of legs) {
    const k = s(0 + (leg.endsWith('R') ? 1 : 0))
    set(leg, { pos: [0, -hipsDrop * k, 0], rot: [jitter(leg.length) * 20 * k, 0, (side[leg] ?? 1) * 80 * k] })
  }
  set('torso', { pos: [0, -hipsDrop * s(2), 0], rot: [jitter(7) * 10 * s(2), 0, jitter(8) * 8 * s(2)] })
  set('head', { pos: [0, -metrics.headSize * 0.3 * s(4), 0], rot: [30 * s(4), 0, jitter(1) * 25 * s(4)] })
  for (const a of arms) set(a, { pos: [0, -metrics.armLength * 0.2 * s(3), 0], rot: [jitter(a.length + 3) * 25 * s(3), 0, (side[a] ?? 1) * 65 * s(3)] })
  set('weapon', { rot: [0, 0, 40 * s(5)] })
  set('accessory', { rot: [0, 0, jitter(5) * 20 * s(5)] })
  set('tail', { rot: [jitter(9) * 10 * s(4), pf.tail * Math.sin(f * 0.6) * (1 - s(4)), 0] })
  for (const w of wings) set(w, { rot: [0, 0, (side[w] ?? 1) * 80 * s(3)] })
  return { rootAbout: metrics.feet, local }
}

// ------------------------------------------------------------------ public API

export function autoDeath(species: Species): DeathVariant {
  return species === 'robot' || species === 'blob' ? 'crumble' : species === 'quadruped' || species === 'winged' ? 'topple' : 'fallBack'
}

function finish(
  name: string, kind: AnimKind, variant: string | undefined, fps: number, loop: boolean, ctx: GenContext, frames: FrameSpec[], id: string,
): Animation {
  return { id, name, kind, variant, fps: clamp(Math.round(fps), 1, 60), length: frames.length, loop, tracks: bake(ctx, frames), snapshots: {} }
}

const range = (n: number) => Array.from({ length: n }, (_v, i) => i)

export function generateAnimation(kind: GenKind, ctx: GenContext, id: string, opts: Partial<GenOptions> = {}): Animation {
  const o = { ...DEFAULT_GEN, ...opts }
  switch (kind) {
    case 'idle':
      return finish('Idle', 'idle', undefined, ctx.profile.idleFps, true, ctx, range(16).map((f) => idleFrame(f, 16, ctx)), id)
    case 'walk':
      return finish('Walk', 'walk', undefined, ctx.profile.walkFps * clamp(o.speed, 0.4, 2), true, ctx, range(12).map((f) => walkFrame(f, 12, ctx, o)), id)
    case 'jump':
      return finish('Jump', 'jump', undefined, 12, false, ctx, range(JUMP_FRAMES).map((f) => jumpFrame(f, ctx, o)), id)
    case 'hurt': {
      const n = o.knockback > 3 ? 14 : 10
      return finish(`Hurt (${o.direction})`, 'hurt', o.direction, 12, false, ctx, range(n).map((f) => hurtFrame(f, n, ctx, o)), id)
    }
    case 'death': {
      const variant = o.death === 'auto' ? autoDeath(ctx.species) : o.death
      const n = variant === 'crumble' ? 16 : 20
      return finish(`Death (${DEATH_LABEL[variant].toLowerCase()})`, 'death', variant, 12, false, ctx, range(n).map((f) => deathFrame(f, n, ctx, variant)), id)
    }
  }
}

export interface GenerateAllOptions extends GenOptions {
  variations: boolean // directional hurts and every death type
}

/** Idle, Walk, Jump, Hurt and Death in one call. */
export function generateAllAnimations(ctx: GenContext, newId: () => string, opts: Partial<GenerateAllOptions> = {}): Animation[] {
  const o = { ...DEFAULT_GEN, variations: false, ...opts }
  const out: Animation[] = [
    generateAnimation('idle', ctx, newId(), o),
    generateAnimation('walk', ctx, newId(), o),
    generateAnimation('jump', ctx, newId(), o),
    generateAnimation('hurt', ctx, newId(), { ...o, direction: 'front' }),
  ]
  if (o.variations) for (const direction of ['back', 'left', 'right'] as HitDir[]) out.push(generateAnimation('hurt', ctx, newId(), { ...o, direction }))
  const first = o.death === 'auto' ? autoDeath(ctx.species) : o.death
  out.push(generateAnimation('death', ctx, newId(), { ...o, death: first }))
  if (o.variations) {
    const all: DeathVariant[] = ['fallBack', 'fallForward', 'topple', 'collapse', 'crumble']
    for (const death of all) if (death !== first) out.push(generateAnimation('death', ctx, newId(), { ...o, death }))
  }
  return out
}
