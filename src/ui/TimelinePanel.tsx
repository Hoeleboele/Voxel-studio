import { ANIM_TEMPLATES, makeTemplateAnimation, samplePose } from '../anim/pose'
import type { AnimTemplate } from '../anim/pose'
import { useState } from 'react'
import { EditBatch } from '../core/edit'
import type { Animation, Vec3 } from '../core/types'
import { gridFromBytes, serializeVoxels } from '../core/voxelIO'
import { useUi } from '../store/editorStore'
import { grid, uid, useProject } from '../store/projectStore'
import { Btn, Check, NumberField, Row, Section } from './common'

function blankAnimation(name: string): Animation {
  return { id: uid(), name, fps: 8, length: 8, loop: true, tracks: {}, snapshots: {} }
}

export function TimelinePanel() {
  const project = useProject()
  const ui = useUi()
  const [template, setTemplate] = useState<AnimTemplate>('walk')
  const anim = project.animations.find((a) => a.id === project.activeAnimId) ?? null
  const layer = project.layers.find((l) => l.id === project.activeLayerId)
  const frame = anim ? Math.min(ui.frame, anim.length - 1) : 0
  const track = anim && layer ? (anim.tracks[layer.id] ?? []) : []
  const hasKey = track.some((k) => k.frame === frame)
  const pose = anim && layer && !layer.isGroup ? samplePose(anim, layer.id, frame) : null

  const setFrame = (f: number) => ui.set({ frame: Math.max(0, f) })

  const writeKey = (pos: Vec3, rot: Vec3) => {
    if (!anim || !layer || layer.isGroup) return
    project.setKeyframe(anim.id, layer.id, { frame, pos, rot })
  }

  const captureSnapshot = () => {
    if (!anim) return
    project.updateAnimation(anim.id, { snapshots: { ...anim.snapshots, [frame]: serializeVoxels(grid) } })
  }

  const restoreSnapshot = () => {
    const bytes = anim?.snapshots[frame]
    if (!bytes) return
    const snap = gridFromBytes(bytes, grid.bounds)
    const batch = new EditBatch(grid)
    const old: [number, number, number][] = []
    grid.forEach((x, y, z) => { old.push([x, y, z]) })
    for (const [x, y, z] of old) batch.removeVoxel(x, y, z)
    snap.forEach((x, y, z, c, l, m) => { batch.setVoxel(x, y, z, c, l, m) })
    batch.commit('Restore frame snapshot')
  }

  return (
    <div>
      <Section title="Animation" right={
        <Btn small active={ui.previewOpen} onClick={() => ui.set({ previewOpen: !ui.previewOpen })}>Preview window</Btn>
      }>
        <div className="flex gap-1">
          <select
            className="min-w-0 flex-1 rounded border border-neutral-600 bg-neutral-900 px-1 py-1 text-xs"
            value={anim?.id ?? ''}
            onChange={(e) => project.setActiveAnim(e.target.value || null)}
          >
            {project.animations.length === 0 && <option value="">No animations</option>}
            {project.animations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Btn small onClick={() => project.addAnimation(blankAnimation(`Animation ${project.animations.length + 1}`))}>New</Btn>
          <Btn small disabled={!anim} onClick={() => anim && project.deleteAnimation(anim.id)}>Delete</Btn>
        </div>
        <div className="flex gap-1">
          <select
            className="min-w-0 flex-1 rounded border border-neutral-600 bg-neutral-900 px-1 py-1 text-xs"
            value={template}
            onChange={(e) => setTemplate(e.target.value as AnimTemplate)}
          >
            {ANIM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <Btn small onClick={() => project.addAnimation(makeTemplateAnimation(template, project.layers, uid()))}>Add template</Btn>
        </div>
        <p className="text-[11px] text-neutral-500">Templates animate layers tagged with body parts (arms, legs, head, torso).</p>
      </Section>

      {anim && (
        <>
          <Section title="Settings">
            <Row label="Name">
              <input
                className="w-28 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs"
                value={anim.name} onChange={(e) => project.updateAnimation(anim.id, { name: e.target.value })}
              />
            </Row>
            <Row label="FPS"><NumberField value={anim.fps} min={1} max={60} onChange={(n) => project.updateAnimation(anim.id, { fps: Math.max(1, Math.round(n)) })} /></Row>
            <Row label="Frames"><NumberField value={anim.length} min={1} max={120} onChange={(n) => project.updateAnimation(anim.id, { length: Math.max(1, Math.min(120, Math.round(n))) })} /></Row>
            <Check checked={anim.loop} onChange={(v) => project.updateAnimation(anim.id, { loop: v })} label="Loop" />
          </Section>

          <Section title={`Timeline - frame ${frame + 1} / ${anim.length}`}>
            <div className="flex gap-1">
              <Btn small onClick={() => ui.set({ playing: !ui.playing })} active={ui.playing}>{ui.playing ? 'Pause' : 'Play'}</Btn>
              <Btn small onClick={() => ui.set({ playing: false, frame: 0 })}>Stop</Btn>
              <Btn small onClick={() => setFrame((frame - 1 + anim.length) % anim.length)}>Prev</Btn>
              <Btn small onClick={() => setFrame((frame + 1) % anim.length)}>Next</Btn>
            </div>
            <input type="range" className="w-full" min={0} max={anim.length - 1} value={frame} onChange={(e) => { ui.set({ playing: false }); setFrame(Number(e.target.value)) }} />
            <div className="flex flex-wrap gap-0.5">
              {Array.from({ length: anim.length }, (_v, f) => {
                const key = track.some((k) => k.frame === f)
                const snap = !!anim.snapshots[f]
                return (
                  <button
                    key={f}
                    onClick={() => { ui.set({ playing: false }); setFrame(f) }}
                    className={`relative h-7 w-6 rounded-sm border text-[9px] ${
                      f === frame ? 'border-indigo-400 bg-indigo-700 text-white' : 'border-neutral-700 bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                    }`}
                    title={`Frame ${f + 1}${key ? ' (keyframe)' : ''}${snap ? ' (snapshot)' : ''}`}
                  >
                    {f + 1}
                    {key && <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-amber-300" />}
                    {snap && <span className="absolute right-0 top-0 h-1.5 w-1.5 bg-emerald-400" />}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-neutral-500">Diamond = keyframe on the active layer. Green corner = frame snapshot.</p>
          </Section>

          <Section title={`Pose: ${layer?.name ?? 'none'}`}>
            {pose && layer && !layer.isGroup ? (
              <>
                {(['pos', 'rot'] as const).map((k) => (
                  <div key={k} className="flex items-center gap-1 text-[11px] text-neutral-400">
                    <span className="w-14">{k === 'pos' ? 'Offset' : 'Rotate'}</span>
                    {[0, 1, 2].map((a) => (
                      <NumberField
                        key={a} className="w-14" step={k === 'pos' ? 0.5 : 5} value={Math.round(pose[k][a] * 100) / 100}
                        onChange={(n) => {
                          const pos: Vec3 = [...pose.pos]
                          const rot: Vec3 = [...pose.rot]
                          ;(k === 'pos' ? pos : rot)[a] = n
                          writeKey(pos, rot)
                        }}
                      />
                    ))}
                  </div>
                ))}
                <div className="flex gap-1">
                  <Btn small disabled={hasKey} onClick={() => writeKey(pose.pos, pose.rot)}>Add keyframe</Btn>
                  <Btn small disabled={!hasKey} onClick={() => project.removeKeyframe(anim.id, layer.id, frame)}>Delete keyframe</Btn>
                  <Btn small onClick={() => writeKey([0, 0, 0], [0, 0, 0])}>Reset key</Btn>
                </div>
                <p className="text-[11px] text-neutral-500">Layers rotate rigidly around their pivot. Editing a value creates a keyframe.</p>
              </>
            ) : (
              <p className="text-[11px] text-neutral-500">Select a layer (not a group) to pose it.</p>
            )}
          </Section>

          <Section title="Frame-by-frame">
            <div className="flex flex-wrap gap-1">
              <Btn small onClick={captureSnapshot}>Capture model as frame {frame + 1}</Btn>
              <Btn small disabled={!anim.snapshots[frame]} onClick={restoreSnapshot}>Load into editor</Btn>
              <Btn small disabled={!anim.snapshots[frame]} onClick={() => {
                const rest = { ...anim.snapshots }
                delete rest[frame]
                project.updateAnimation(anim.id, { snapshots: rest })
              }}>Remove</Btn>
            </div>
            <p className="text-[11px] text-neutral-500">A snapshot replaces the posed model for that frame, for hand-drawn animation.</p>
          </Section>
        </>
      )}
    </div>
  )
}
