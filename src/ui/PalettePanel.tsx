import { useState } from 'react'
import { hexToNum } from '../core/color'
import { downloadBlob, safeName } from '../io/download'
import { paletteToGpl, paletteToHex, paletteToJson, parsePalette } from '../io/palette'
import { selectColor } from '../tools/actions'
import { colorHistogram, optimizeColors, replaceColor } from '../tools/projectOps'
import { useEditor } from '../store/editorStore'
import { allPalettes, useProject } from '../store/projectStore'
import { Btn, NumberField, Row, Section, toHex, useDebounced, useGridRevision } from './common'

function Swatch({ color, selected, onClick, onContext, title }: {
  color: number; selected?: boolean; onClick?: () => void; onContext?: () => void; title?: string
}) {
  return (
    <button
      title={title ?? toHex(color)}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onContext?.() }}
      className={`swatch h-6 w-6 rounded-sm border ${selected ? 'border-white ring-1 ring-indigo-400' : 'border-neutral-700'}`}
      style={{ background: toHex(color) }}
    />
  )
}

export function PalettePanel() {
  const project = useProject()
  const editor = useEditor()
  const palettes = allPalettes(project.customPalettes)
  const palette = palettes.find((p) => p.id === project.activePaletteId) ?? palettes[0]
  const [sel, setSel] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [maxColors, setMaxColors] = useState(16)
  const [replaceFrom, setReplaceFrom] = useState<number | null>(null)
  const revision = useGridRevision()
  const used = useDebounced(() => [...colorHistogram().entries()].sort((a, b) => b[1] - a[1]), [revision])

  // Editing a built-in palette first copies it into the project.
  const editable = (): string => {
    if (!palette.builtin) return palette.id
    return project.addPalette(`${palette.name} (custom)`, [...palette.colors])
  }

  const addColor = () => {
    const id = editable()
    const base = palettes.find((p) => p.id === id)?.colors ?? palette.colors
    if (!base.includes(editor.color)) project.updatePalette(id, { colors: [...base, editor.color] })
  }

  const updateSwatch = () => {
    if (sel === null) return
    const id = editable()
    const base = palettes.find((p) => p.id === id)?.colors ?? palette.colors
    project.updatePalette(id, { colors: base.map((c, i) => (i === sel ? editor.color : c)) })
  }

  const removeSwatch = (index: number | null) => {
    if (index === null) return
    const id = editable()
    const base = palettes.find((p) => p.id === id)?.colors ?? palette.colors
    project.updatePalette(id, { colors: base.filter((_c, i) => i !== index) })
    setSel(null)
  }

  const importFile = async (file: File) => {
    try {
      const p = parsePalette(await file.text(), file.name)
      project.addPalette(p.name, p.colors)
      setMessage(`Imported ${p.colors.length} colors`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div>
      <Section title="Palette">
        <div className="flex gap-1">
          <select
            className="min-w-0 flex-1 rounded border border-neutral-600 bg-neutral-900 px-1 py-1 text-xs"
            value={palette.id}
            onChange={(e) => { project.setActivePalette(e.target.value); setSel(null) }}
          >
            <optgroup label="Retro presets">
              {palettes.filter((p) => p.builtin).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}
            </optgroup>
            {project.customPalettes.length > 0 && (
              <optgroup label="Custom">
                {project.customPalettes.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex flex-wrap gap-1">
          <Btn small onClick={() => project.addPalette('New palette', [editor.color])}>New</Btn>
          <Btn small onClick={() => project.addPalette(`${palette.name} copy`, [...palette.colors])}>Duplicate</Btn>
          <Btn small disabled={!!palette.builtin} onClick={() => {
            const name = window.prompt('Palette name', palette.name)
            if (name) project.updatePalette(palette.id, { name })
          }}>Rename</Btn>
          <Btn small disabled={!!palette.builtin} onClick={() => project.deletePalette(palette.id)}>Delete</Btn>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded border border-neutral-800 bg-neutral-950 p-1.5">
          {palette.colors.map((c, i) => (
            <Swatch
              key={`${i}-${c}`}
              color={c}
              selected={sel === i}
              onClick={() => { setSel(i); editor.setColor(c) }}
              onContext={() => removeSwatch(i)}
            />
          ))}
          {palette.colors.length === 0 && <span className="text-xs text-neutral-500">Empty palette</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          <Btn small onClick={addColor}>Add current</Btn>
          <Btn small disabled={sel === null} onClick={updateSwatch}>Update swatch</Btn>
          <Btn small disabled={sel === null} onClick={() => removeSwatch(sel)}>Remove</Btn>
        </div>
        <p className="text-[11px] text-neutral-500">Right-click a swatch to remove it. Editing a preset makes a custom copy.</p>
      </Section>

      <Section title="Import / export">
        <div className="flex flex-wrap gap-1">
          <label className="cursor-pointer rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 text-[11px] hover:bg-neutral-700">
            Import
            <input type="file" accept=".json,.gpl,.hex,.txt" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importFile(f)
              e.target.value = ''
            }} />
          </label>
          <Btn small onClick={() => downloadBlob(paletteToJson(palette), `${safeName(palette.name)}.json`, 'application/json')}>JSON</Btn>
          <Btn small onClick={() => downloadBlob(paletteToGpl(palette), `${safeName(palette.name)}.gpl`, 'text/plain')}>GPL</Btn>
          <Btn small onClick={() => downloadBlob(paletteToHex(palette), `${safeName(palette.name)}.hex`, 'text/plain')}>HEX</Btn>
        </div>
        {message && <p className="text-[11px] text-indigo-300">{message}</p>}
      </Section>

      <Section title={`Colors in model${used ? ` (${used.length})` : ''}`}>
        <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-1.5">
          {(used ?? []).slice(0, 400).map(([c, n]) => (
            <Swatch key={c} color={c} selected={replaceFrom === c} title={`${toHex(c)} - ${n} voxels`} onClick={() => setReplaceFrom(c)} />
          ))}
          {used?.length === 0 && <span className="text-xs text-neutral-500">No voxels yet</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Btn small disabled={replaceFrom === null} onClick={() => {
            if (replaceFrom === null) return
            const n = replaceColor(replaceFrom, editor.color)
            setMessage(`Replaced ${n} voxels`)
            setReplaceFrom(editor.color)
          }}>Replace with current color</Btn>
          <Btn small disabled={replaceFrom === null} onClick={() => replaceFrom !== null && selectColor(replaceFrom)}>Select</Btn>
          <Btn small disabled={!used?.length} onClick={() => {
            if (!used) return
            project.addPalette('From model', used.map(([c]) => c))
          }}>Extract palette</Btn>
        </div>
        <Row label="Reduce to">
          <NumberField value={maxColors} min={2} max={256} onChange={(n) => setMaxColors(Math.max(2, Math.round(n)))} />
          <Btn small onClick={() => {
            const r = optimizeColors(maxColors)
            setMessage(`Reduced ${r.before} to ${r.after} colors`)
            project.addPalette(`Optimized ${r.after}`, r.palette)
          }}>Optimize</Btn>
        </Row>
        <p className="text-[11px] text-neutral-500">Locked or hidden layers are left untouched.</p>
      </Section>

      <Section title="Pick a color">
        <div className="flex items-center gap-2">
          <input type="color" className="h-8 w-12" value={toHex(editor.color)} onChange={(e) => editor.setColor(hexToNum(e.target.value))} />
          <span className="font-mono text-xs text-neutral-400">{toHex(editor.color)}</span>
        </div>
      </Section>
    </div>
  )
}
