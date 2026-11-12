import { useState } from 'react'
import { DEATH_LABEL, DEFAULT_GEN } from '../anim/generate'
import type { DeathVariant, GenKind, HitDir } from '../anim/generate'
import { generateAllForProject, generateOneForProject, projectContext } from '../anim/projectGen'
import { blendAnimations, mirrorAnimation, pingPong, resample, reverse, seamlessLoop, trim } from '../anim/ops'
import { SPECIES_LABEL } from '../anim/species'
import type { Animation, Species } from '../core/types'
import { useUi } from '../store/editorStore'
import { uid, useProject } from '../store/projectStore'
import { Btn, Check, NumberField, Row, Section, Select } from './common'

const SPECIES_OPTIONS: { value: Species | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  ...(Object.keys(SPECIES_LABEL) as Species[]).map((s) => ({ value: s, label: SPECIES_LABEL[s] })),
]

export function GeneratorSection() {
  const project = useProject()
  const [speed, setSpeed] = useState(DEFAULT_GEN.speed)
  const [direction, setDirection] = useState<HitDir>('front')
  const [knockback, setKnockback] = useState(DEFAULT_GEN.knockback)
  const [jumpHeight, setJumpHeight] = useState(DEFAULT_GEN.jumpHeight)
  const [death, setDeath] = useState<DeathVariant | 'auto'>('auto')
  const [variations, setVariations] = useState(false)
  const [message, setMessage] = useState('')

  const override = project.meta.species
  let detected = ''
  let canGenerate = false
  try {
    const ctx = projectContext()
    detected = SPECIES_LABEL[ctx.species]
    canGenerate = ctx.layers.length > 0
  } catch { /* no model yet */ }

  const opts = { speed, direction, knockback, jumpHeight, death }
  const run = (fn: () => number) => {
    try {
      const n = fn()
      setMessage(`Generated ${n} animation${n === 1 ? '' : 's'}`)
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Generation failed') }
  }

  return (
    <Section title="Animation generator">
      <Row label="Species">
        <Select<Species | 'auto'>
          value={override ?? 'auto'}
          onChange={(v) => project.setMeta({ species: v === 'auto' ? undefined : v })}
          options={SPECIES_OPTIONS}
        />
      </Row>
      <p className="text-[11px] text-neutral-500">
        {canGenerate ? `Using ${detected} motion from the tagged body parts, limb sizes and equipment.` : 'Tag layers with body parts (Layers panel) or convert a sprite first.'}
      </p>
      <Btn active disabled={!canGenerate} onClick={() => run(() => generateAllForProject({ ...opts, variations }).length)}>
        Generate Idle, Walk, Jump, Hurt, Death
      </Btn>
      <Check checked={variations} onChange={setVariations} label="Include directional hurts and all death variations" />
      <details className="text-xs text-neutral-300">
        <summary className="cursor-pointer text-neutral-400">Options</summary>
        <div className="mt-1 space-y-1.5">
          <Row label="Walk speed"><NumberField value={speed} min={0.4} max={2} step={0.1} onChange={(n) => setSpeed(Math.max(0.4, Math.min(2, n)))} /></Row>
          <Row label="Jump height"><NumberField value={jumpHeight} min={0.3} max={2} step={0.1} onChange={(n) => setJumpHeight(Math.max(0.3, Math.min(2, n)))} /></Row>
          <Row label="Hit from">
            <Select<HitDir> value={direction} onChange={setDirection} options={[
              { value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' },
            ]} />
          </Row>
          <Row label="Knockback (voxels)"><NumberField value={knockback} min={0} max={12} step={0.5} onChange={(n) => setKnockback(Math.max(0, Math.min(12, n)))} /></Row>
          <Row label="Death">
            <Select<DeathVariant | 'auto'> value={death} onChange={setDeath} options={[
              { value: 'auto', label: 'Auto (by species)' },
              ...(Object.keys(DEATH_LABEL) as DeathVariant[]).map((d) => ({ value: d, label: DEATH_LABEL[d] })),
            ]} />
          </Row>
        </div>
      </details>
      <div className="flex flex-wrap gap-1">
        {(['idle', 'walk', 'jump', 'hurt', 'death'] as GenKind[]).map((k) => (
          <Btn key={k} small disabled={!canGenerate} onClick={() => run(() => { generateOneForProject(k, opts); return 1 })}>
            {k[0].toUpperCase() + k.slice(1)}
          </Btn>
        ))}
      </div>
      {message && <p className="text-[11px] text-indigo-300">{message}</p>}
    </Section>
  )
}

export function EditTools({ anim }: { anim: Animation }) {
  const project = useProject()
  const ui = useUi()
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(anim.length)
  const [length, setLength] = useState(anim.length)
  const add = (a: Animation) => project.addAnimation(a)

  return (
    <Section title="Edit animation">
      <div className="flex flex-wrap gap-1">
        <Btn small onClick={() => project.duplicateAnimation(anim.id)}>Duplicate</Btn>
        <Btn small onClick={() => add(reverse(anim, uid()))}>Reverse copy</Btn>
        <Btn small onClick={() => add(pingPong(anim, uid()))}>Ping-pong loop</Btn>
        <Btn small onClick={() => add(seamlessLoop(anim, 3, uid()))}>Seamless loop</Btn>
        <Btn small onClick={() => add(mirrorAnimation(anim, project.layers, uid()))}>Mirror L/R</Btn>
      </div>
      <Row label="Playback speed">
        <Select value={String(ui.playSpeed)} onChange={(v) => ui.set({ playSpeed: Number(v) })}
          options={[0.25, 0.5, 1, 1.5, 2].map((s) => ({ value: String(s), label: `${s}x` }))} />
      </Row>
      <div className="flex items-center gap-1 text-[11px] text-neutral-400">
        <span>Loop range</span>
        <NumberField className="w-12" value={from} min={1} max={anim.length} onChange={(n) => setFrom(Math.max(1, Math.round(n)))} />
        <span>to</span>
        <NumberField className="w-12" value={to} min={1} max={anim.length} onChange={(n) => setTo(Math.min(anim.length, Math.round(n)))} />
        <Btn small onClick={() => { const t = trim(anim, from - 1, to - 1, uid()); add({ ...t, loop: true }) }}>Make loop</Btn>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-neutral-400">
        <span>Retime to</span>
        <NumberField className="w-12" value={length} min={1} max={120} onChange={(n) => setLength(Math.max(1, Math.min(120, Math.round(n))))} />
        <span>frames</span>
        <Btn small onClick={() => add(resample(anim, length, uid()))}>Create copy</Btn>
      </div>
    </Section>
  )
}

export function BlendSection({ anim }: { anim: Animation }) {
  const project = useProject()
  const others = project.animations.filter((a) => a.id !== anim.id)
  const [otherId, setOtherId] = useState('')
  const [mode, setMode] = useState<'crossfade' | 'mix'>('crossfade')
  const [frames, setFrames] = useState(4)
  const [weight, setWeight] = useState(0.5)
  const other = others.find((a) => a.id === otherId) ?? others[0]
  if (!other) return null
  return (
    <Section title="Blend animations">
      <Row label="With">
        <Select value={other.id} onChange={setOtherId} options={others.map((a) => ({ value: a.id, label: a.name }))} />
      </Row>
      <Row label="Mode">
        <Select<'crossfade' | 'mix'> value={mode} onChange={setMode} options={[
          { value: 'crossfade', label: `Transition ${anim.name} -> ${other.name}` },
          { value: 'mix', label: 'Mix poses together' },
        ]} />
      </Row>
      {mode === 'crossfade'
        ? <Row label="Transition frames"><NumberField value={frames} min={0} max={30} onChange={(n) => setFrames(Math.max(0, Math.min(30, Math.round(n))))} /></Row>
        : <Row label={`Weight of ${other.name}`}><NumberField value={weight} min={0} max={1} step={0.05} onChange={(n) => setWeight(Math.max(0, Math.min(1, n)))} /></Row>}
      <Btn small onClick={() => project.addAnimation(blendAnimations(anim, other, { mode, frames, weight }, uid()))}>Create blended animation</Btn>
    </Section>
  )
}
