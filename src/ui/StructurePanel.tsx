import { useState } from 'react'
import { layerTree } from '../core/layers'
import type { Vec3 } from '../core/types'
import { mirrorLayerTo } from '../tools/actions'
import { newCharacterProject, regenerateCharacter } from '../tools/projectOps'
import { grid, useProject } from '../store/projectStore'
import {
  DEFAULT_COLORS, DEFAULT_PROPORTIONS, PROPORTION_LABELS, PROPORTION_LIMITS,
} from '../templates/characters'
import type { CharacterKind, ColorScheme, Proportions } from '../templates/characters'
import { Btn, Row, Section, toHex, useDebounced, useGridRevision } from './common'
import { OPPOSITE_PART } from './parts'
import { hexToNum } from '../core/color'
import { layerPivot } from '../io/rig'
import { SpriteDepthSection } from './SpriteDepth'

const KINDS: { value: CharacterKind; label: string }[] = [
  { value: 'humanoid', label: 'Humanoid' },
  { value: 'animal', label: 'Animal' },
  { value: 'monster', label: 'Monster' },
  { value: 'robot', label: 'Robot' },
  { value: 'blank', label: 'Blank canvas' },
]

const COLOR_LABELS: Record<keyof ColorScheme, string> = {
  skin: 'Skin', primary: 'Primary', secondary: 'Secondary', accent: 'Accent', dark: 'Dark', eye: 'Eyes', hair: 'Hair',
}

export function StructurePanel() {
  const { layers, activeLayerId, setActiveLayer, updateLayer, bounds } = useProject()
  const [kind, setKind] = useState<CharacterKind>('humanoid')
  const [prop, setProp] = useState<Proportions>({ ...DEFAULT_PROPORTIONS.humanoid })
  const [colors, setColors] = useState<ColorScheme>({ ...DEFAULT_COLORS.humanoid })
  const revision = useGridRevision()
  const counts = useDebounced(() => {
    const m = new Map<number, number>()
    grid.forEach((_x, _y, _z, _c, l) => m.set(l, (m.get(l) ?? 0) + 1))
    return m
  }, [revision])
  const tree = layerTree(layers)
  const active = layers.find((l) => l.id === activeLayerId)
  const spec = { kind, proportions: prop, colors }
  const opposite = active?.part ? layers.find((l) => l.part === OPPOSITE_PART[active.part!]) : undefined
  const pivot = active && !active.isGroup ? (active.pivot ?? layerPivot(grid, active)) : null

  const pickKind = (k: CharacterKind) => {
    setKind(k)
    setProp({ ...DEFAULT_PROPORTIONS[k] })
    setColors({ ...DEFAULT_COLORS[k] })
  }

  const setPivot = (axis: number, value: number) => {
    if (!active || !pivot) return
    const next: Vec3 = [...pivot]
    next[axis] = value
    updateLayer(active.id, { pivot: next })
  }

  return (
    <div>
      <SpriteDepthSection />
      <Section title="Character template">
        <Row label="Type">
          <select
            className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs"
            value={kind}
            onChange={(e) => pickKind(e.target.value as CharacterKind)}
          >
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Row>
        {kind !== 'blank' && (Object.keys(prop) as (keyof Proportions)[]).map((key) => (
          <Row key={key} label={`${PROPORTION_LABELS[kind][key]} ${prop[key]}`}>
            <input
              type="range" min={PROPORTION_LIMITS[key][0]} max={PROPORTION_LIMITS[key][1]} value={prop[key]}
              onChange={(e) => setProp({ ...prop, [key]: Number(e.target.value) })}
            />
          </Row>
        ))}
        {kind !== 'blank' && (
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(colors) as (keyof ColorScheme)[]).map((key) => (
              <label key={key} className="flex flex-col items-center text-[10px] text-neutral-400">
                <input type="color" className="h-6 w-full" value={toHex(colors[key])}
                  onChange={(e) => setColors({ ...colors, [key]: hexToNum(e.target.value) })} />
                {COLOR_LABELS[key]}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          <Btn small onClick={() => {
            if (window.confirm('Start a new project from this template? Unsaved changes will be lost.')) newCharacterProject(spec, bounds)
          }}>New from template</Btn>
          <Btn small disabled={kind === 'blank'} onClick={() => regenerateCharacter(spec)}>Regenerate (undoable)</Btn>
        </div>
        <p className="text-[11px] text-neutral-500">Regenerate rebuilds all voxels from the sliders, replacing manual edits. Use undo to go back.</p>
      </Section>

      <Section title="Object structure">
        <ul className="space-y-0.5">
          {tree.map(({ layer, depth }) => (
            <li
              key={layer.id}
              onClick={() => setActiveLayer(layer.id)}
              style={{ paddingLeft: 4 + depth * 14 }}
              className={`flex cursor-pointer items-center justify-between rounded px-1 py-0.5 text-xs ${
                layer.id === activeLayerId ? 'bg-indigo-950/60 text-white' : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <span className="truncate">{layer.isGroup ? '[G] ' : ''}{layer.name}</span>
              <span className="ml-2 shrink-0 text-[10px] text-neutral-500">
                {layer.part ?? ''} {layer.isGroup ? '' : counts?.get(layer.id) ?? 0}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {active && !active.isGroup && (
        <Section title="Limb editing">
          <p className="text-[11px] text-neutral-500">
            Select a part, then use Move, Rotate or Mirror in the tools panel to reshape it. With nothing selected, tools act on the whole active layer.
          </p>
          {pivot && (
            <>
              <div className="text-[11px] text-neutral-400">Pivot (rotation centre for animation)</div>
              <div className="flex gap-1">
                {[0, 1, 2].map((a) => (
                  <label key={a} className="flex items-center gap-1 text-[11px] text-neutral-400">
                    {'XYZ'[a]}
                    <input
                      type="number" step={0.5} className="w-14 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs"
                      value={pivot[a]} onChange={(e) => Number.isFinite(Number(e.target.value)) && setPivot(a, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
              <Btn small onClick={() => updateLayer(active.id, { pivot: undefined })} disabled={!active.pivot}>Reset pivot to centre</Btn>
            </>
          )}
          {opposite && (
            <Btn small onClick={() => mirrorLayerTo(active.id, opposite.id)}>
              Copy to {opposite.name} (mirrored)
            </Btn>
          )}
        </Section>
      )}
    </div>
  )
}
