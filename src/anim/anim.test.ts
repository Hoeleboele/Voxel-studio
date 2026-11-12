import { describe, expect, it } from 'vitest'
import { VoxelGrid } from '../core/voxelGrid'
import type { Animation, Layer } from '../core/types'
import { DEFAULT_COLORS, DEFAULT_PROPORTIONS, generateCharacter, requiredBounds } from '../templates/characters'
import type { CharacterKind } from '../templates/characters'
import { exportGltf } from '../io/gltf'
import { DEFAULT_GEN, generateAllAnimations, generateAnimation, makeContext } from './generate'
import { blendAnimations, mirrorAnimation, pingPong, resample, reverse, seamlessLoop, trim } from './ops'
import { samplePose } from './pose'
import { presetAnimations, scaleForHeight } from '../io/engine'

function build(kind: CharacterKind): { grid: VoxelGrid; layers: Layer[] } {
  const bounds = requiredBounds(kind, DEFAULT_PROPORTIONS[kind], [64, 64, 64])
  const gen = generateCharacter({ kind, proportions: DEFAULT_PROPORTIONS[kind], colors: DEFAULT_COLORS[kind] }, bounds)
  const grid = new VoxelGrid()
  grid.bounds = gen.bounds
  for (const v of gen.voxels) grid.set(v.x, v.y, v.z, v.color, v.layerId, v.material)
  return { grid, layers: gen.layers }
}

let n = 0
const id = () => `a${n++}`
const torsoId = (layers: Layer[]) => layers.find((l) => l.part === 'torso')!.id
const keys = (a: Animation, layerId: number) => a.tracks[layerId]

describe('species detection', () => {
  it('maps the character templates to species', () => {
    expect(makeContext(build('humanoid').grid, build('humanoid').layers).species).toBe('biped')
    const animal = build('animal')
    expect(makeContext(animal.grid, animal.layers).species).toBe('quadruped')
    const robot = build('robot')
    expect(makeContext(robot.grid, robot.layers).species).toBe('robot')
  })

  it('honours a manual override', () => {
    const h = build('humanoid')
    expect(makeContext(h.grid, h.layers, 'winged').species).toBe('winged')
  })
})

describe('animation generator', () => {
  const h = build('humanoid')
  const ctx = makeContext(h.grid, h.layers)

  it('creates idle, walk, jump, hurt and death with finite keys on every part layer', () => {
    const anims = generateAllAnimations(ctx, id)
    expect(anims.map((a) => a.kind)).toEqual(['idle', 'walk', 'jump', 'hurt', 'death'])
    for (const a of anims) {
      expect(a.length).toBeGreaterThan(5)
      for (const l of ctx.layers) {
        expect(keys(a, l.id)).toHaveLength(a.length)
        for (const k of keys(a, l.id)) for (const v of [...k.pos, ...k.rot]) expect(Number.isFinite(v)).toBe(true)
      }
    }
    expect(anims.find((a) => a.kind === 'idle')!.loop).toBe(true)
    expect(anims.find((a) => a.kind === 'walk')!.loop).toBe(true)
    expect(anims.find((a) => a.kind === 'jump')!.loop).toBe(false)
  })

  it('adds directional hurt and every death type when variations are requested', () => {
    const anims = generateAllAnimations(ctx, id, { variations: true })
    expect(anims.filter((a) => a.kind === 'hurt').map((a) => a.variant).sort()).toEqual(['back', 'front', 'left', 'right'])
    expect(anims.filter((a) => a.kind === 'death')).toHaveLength(5)
  })

  it('makes the walk cycle loop without a pop at the wrap point', () => {
    const walk = generateAnimation('walk', ctx, id())
    const legL = h.layers.find((l) => l.part === 'legL')!.id
    const t = keys(walk, legL)
    const step = Math.max(...t.slice(1).map((k, i) => Math.abs(k.rot[0] - t[i].rot[0])))
    const wrap = Math.abs(t[0].rot[0] - t[t.length - 1].rot[0])
    expect(wrap).toBeLessThanOrEqual(step * 1.05)
  })

  it('scales walk fps with the speed option', () => {
    const slow = generateAnimation('walk', ctx, id(), { speed: 0.5 })
    const fast = generateAnimation('walk', ctx, id(), { speed: 1.5 })
    expect(fast.fps).toBeGreaterThan(slow.fps)
  })

  it('leaves the ground during a jump and lands back on it', () => {
    const jump = generateAnimation('jump', ctx, id())
    const legL = h.layers.find((l) => l.part === 'legL')!.id
    const ys = keys(jump, legL).map((k) => k.pos[1])
    expect(Math.max(...ys)).toBeGreaterThan(2)
    expect(Math.abs(ys[ys.length - 1])).toBeLessThan(0.5)
  })

  it('pushes the body away from the hit direction and scales with knockback', () => {
    const t = torsoId(h.layers)
    const peak = (dir: 'front' | 'back' | 'left' | 'right', kb = 2) => {
      const a = generateAnimation('hurt', ctx, id(), { ...DEFAULT_GEN, direction: dir, knockback: kb })
      return keys(a, t).reduce((best, k) => (Math.abs(k.pos[0]) + Math.abs(k.pos[2]) > Math.abs(best.pos[0]) + Math.abs(best.pos[2]) ? k : best))
    }
    expect(peak('front').pos[2]).toBeLessThan(0)
    expect(peak('back').pos[2]).toBeGreaterThan(0)
    expect(peak('left').pos[0]).toBeLessThan(0)
    expect(peak('right').pos[0]).toBeGreaterThan(0)
    expect(Math.abs(peak('front', 5).pos[2])).toBeGreaterThan(Math.abs(peak('front', 1).pos[2]))
  })

  it('ends a fall-back death lying on its back', () => {
    const death = generateAnimation('death', ctx, id(), { death: 'fallBack' })
    const last = keys(death, torsoId(h.layers)).at(-1)!
    expect(last.rot[0]).toBeLessThan(-80)
    expect(last.rot[0]).toBeGreaterThan(-100)
  })

  it('gives different species different gaits', () => {
    const robot = build('robot')
    const rctx = makeContext(robot.grid, robot.layers)
    const amp = (c: typeof ctx, layers: Layer[]) => {
      const w = generateAnimation('walk', c, id())
      const leg = layers.find((l) => l.part === 'legL')!.id
      return Math.max(...keys(w, leg).map((k) => Math.abs(k.rot[0])))
    }
    expect(amp(rctx, robot.layers)).not.toBeCloseTo(amp(ctx, h.layers), 0)
    const animal = build('animal')
    const actx = makeContext(animal.grid, animal.layers)
    const walk = generateAnimation('walk', actx, id())
    const fl = animal.layers.find((l) => l.part === 'legFL')!.id
    const bl = animal.layers.find((l) => l.part === 'legBL')!.id
    expect(keys(walk, fl)[3].rot[0] * keys(walk, bl)[3].rot[0]).toBeLessThan(0)
  })

  it('exports generated animations to GLB', () => {
    const anims = generateAllAnimations(ctx, id)
    const out = exportGltf(h.grid, h.layers, { binary: true, scale: 0.1, center: true, rig: true, animations: anims })
    expect(out.rigged).toBe(true)
  })
})

describe('engine presets', () => {
  const h = build('humanoid')
  const ctx = makeContext(h.grid, h.layers)
  const anims = generateAllAnimations(ctx, id)
  const withFrames: Animation = { id: 'f', name: 'Frames', fps: 8, length: 2, loop: true, tracks: {}, snapshots: {} }

  it('names clips per engine convention and drops frame-only clips', () => {
    const godot = presetAnimations('godot', 'Hero', [...anims, withFrames]).map((a) => a.name)
    expect(godot).toContain('Idle-loop')
    expect(godot).toContain('Jump')
    expect(godot).not.toContain('Frames')
    expect(presetAnimations('unreal', 'Hero Knight', anims).map((a) => a.name)).toContain('A_Hero_Knight_Idle')
  })

  it('computes a scale that makes the model the requested height', () => {
    const s = scaleForHeight(h.grid, h.layers, 1.8)
    const box = h.grid.bbox()!
    expect(s * (box.max[1] - box.min[1] + 1)).toBeCloseTo(1.8, 1)
  })

  it('writes clip metadata into the exported glTF', () => {
    const out = exportGltf(h.grid, h.layers, { binary: false, scale: 0.1, center: true, rig: true, animations: anims })
    const json = JSON.parse(out.data as string)
    expect(json.animations).toHaveLength(anims.length)
    expect(json.animations[1].extras).toMatchObject({ kind: 'walk', loop: true })
  })
})

describe('animation operations', () => {
  const h = build('humanoid')
  const ctx = makeContext(h.grid, h.layers)
  const walk = generateAnimation('walk', ctx, 'w')
  const idle = generateAnimation('idle', ctx, 'i')
  const legL = h.layers.find((l) => l.part === 'legL')!.id

  it('reverses and ping-pongs', () => {
    const r = reverse(walk, 'r')
    expect(keys(r, legL)[0].rot[0]).toBeCloseTo(keys(walk, legL).at(-1)!.rot[0])
    const pp = pingPong(walk, 'p')
    expect(pp.length).toBe(walk.length * 2 - 2)
  })

  it('trims to a frame range', () => {
    const t = trim(walk, 2, 5, 't')
    expect(t.length).toBe(4)
    expect(keys(t, legL)[0].rot[0]).toBeCloseTo(samplePose(walk, legL, 2).rot[0])
  })

  it('retimes to a new length', () => {
    const r = resample(walk, 24, 'x')
    expect(r.length).toBe(24)
    expect(keys(r, legL)).toHaveLength(24)
  })

  it('makes a loop seamless', () => {
    const jump = generateAnimation('jump', ctx, 'j')
    const s = seamlessLoop(jump, 4, 's')
    const k = keys(s, legL)
    expect(s.loop).toBe(true)
    expect(Math.abs(k[0].pos[1] - k[k.length - 1].pos[1])).toBeLessThan(Math.abs(keys(jump, legL)[0].pos[1] - keys(jump, legL).at(-1)!.pos[1]) + 0.01)
  })

  it('mirrors left and right limbs', () => {
    const m = mirrorAnimation(walk, h.layers, 'm')
    const legR = h.layers.find((l) => l.part === 'legR')!.id
    expect(keys(m, legL)[2].rot[0]).toBeCloseTo(keys(walk, legR)[2].rot[0])
  })

  it('cross-fades from one animation into another', () => {
    const b = blendAnimations(walk, idle, { mode: 'crossfade', frames: 4, weight: 0.5 }, 'b')
    expect(b.length).toBe(walk.length + 4 + idle.length)
    const mix = blendAnimations(walk, idle, { mode: 'mix', frames: 0, weight: 0.5 }, 'mx')
    const a = samplePose(walk, legL, 3).rot[0]
    const c = samplePose(idle, legL, 3).rot[0]
    expect(keys(mix, legL)[3].rot[0]).toBeCloseTo((a + c) / 2, 1)
  })
})
