import { useState } from 'react'
import { readjustDepth, useConvert } from '../convert/apply'
import type { DepthMode } from '../convert/types'
import { Btn, NumberField, Row, Section, Select } from './common'

/** Depth controls for a model created by the sprite converter. */
export function SpriteDepthSection() {
  const session = useConvert((s) => s.session)
  const [depth, setDepth] = useState(session?.opts.depth ?? 6)
  const [mode, setMode] = useState<DepthMode>(session?.opts.mode ?? 'symmetric')
  const [shading, setShading] = useState(session?.opts.shadingBias ?? 0.35)
  const [smoothing, setSmoothing] = useState(session?.opts.smoothing ?? 1)
  const [message, setMessage] = useState('')
  if (!session) return null

  const apply = () => {
    try {
      readjustDepth({ depth, mode, shadingBias: shading, smoothing })
      setMessage('Depth updated (undoable).')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change depth')
    }
  }

  return (
    <Section title="Sprite depth">
      <Row label="Depth (voxels)"><NumberField value={depth} min={1} max={64} onChange={(n) => setDepth(Math.max(1, Math.min(64, Math.round(n))))} /></Row>
      <Row label="Volume">
        <Select<DepthMode> value={mode} onChange={setMode} options={[
          { value: 'symmetric', label: 'Solid (dark back)' }, { value: 'solid', label: 'Solid' },
          { value: 'shell', label: 'Hollow shell' }, { value: 'relief', label: 'Relief (flat back)' },
        ]} />
      </Row>
      <Row label="Shading to depth"><NumberField value={shading} min={0} max={1} step={0.05} onChange={(n) => setShading(Math.max(0, Math.min(1, n)))} /></Row>
      <Row label="Smoothing"><NumberField value={smoothing} min={0} max={3} onChange={(n) => setSmoothing(Math.max(0, Math.min(3, Math.round(n))))} /></Row>
      <Btn small onClick={apply}>Apply depth</Btn>
      <p className="text-[11px] text-neutral-500">
        Re-shapes the converted layers from the original sprite and replaces manual voxel edits on them. Wrong body part? Change it in the Layers panel.
      </p>
      {message && <p className="text-[11px] text-indigo-300">{message}</p>}
    </Section>
  )
}
