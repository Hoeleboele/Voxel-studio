import { useState } from 'react'
import { loadProjectBytes } from '../io/project'
import { exportGltf } from '../io/gltf'
import { exportObjZip, exportStl } from '../io/meshFormats'
import { buildExportMesh } from '../io/meshExport'
import { exportVox } from '../io/vox'
import { canvasToPng, renderGif, renderSpriteSheet, VIEW_LABELS } from '../io/sprites'
import type { SpriteOptions, ViewId } from '../io/sprites'
import { downloadBlob, readFileBytes, safeName } from '../io/download'
import { parsePalette } from '../io/palette'
import { DEFAULT_COLORS, DEFAULT_PROPORTIONS } from '../templates/characters'
import type { CharacterKind } from '../templates/characters'
import { importVoxBytes, newCharacterProject } from '../tools/projectOps'
import { useUi } from '../store/editorStore'
import { grid, useProject } from '../store/projectStore'
import { useView } from '../store/viewStore'
import { Btn, Check, Modal, NumberField, Row, Select } from './common'

function useClose() {
  return () => useUi.getState().setModal(null)
}

const TEMPLATES: { kind: CharacterKind; title: string; text: string }[] = [
  { kind: 'humanoid', title: 'Humanoid', text: 'Two arms, two legs, head and torso.' },
  { kind: 'animal', title: 'Animal', text: 'Four-legged body with head, ears and tail.' },
  { kind: 'monster', title: 'Monster', text: 'Bulky body with horns and claws.' },
  { kind: 'robot', title: 'Robot', text: 'Boxy metal body with visor and antenna.' },
  { kind: 'blank', title: 'Blank canvas', text: 'Empty grid with one layer.' },
]

export function NewModal() {
  const close = useClose()
  const dirty = useProject((s) => s.dirty)
  const [kind, setKind] = useState<CharacterKind>('humanoid')
  const [size, setSize] = useState(64)
  return (
    <Modal title="New project" onClose={close}>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.kind}
            onClick={() => setKind(t.kind)}
            className={`rounded border p-2 text-left ${kind === t.kind ? 'border-indigo-400 bg-indigo-950/50' : 'border-neutral-700 hover:bg-neutral-800'}`}
          >
            <div className="text-sm font-medium text-neutral-100">{t.title}</div>
            <div className="text-[11px] text-neutral-400">{t.text}</div>
          </button>
        ))}
      </div>
      <Row label="Grid size">
        <Select value={String(size)} onChange={(v) => setSize(Number(v))}
          options={[32, 48, 64, 96, 128, 192, 256].map((n) => ({ value: String(n), label: `${n} x ${n} x ${n}` }))} />
      </Row>
      {dirty && <p className="text-xs text-amber-300">The current project has unsaved changes that will be lost.</p>}
      <div className="flex justify-end gap-2">
        <Btn onClick={close}>Cancel</Btn>
        <Btn active onClick={() => {
          newCharacterProject(
            { kind, proportions: { ...DEFAULT_PROPORTIONS[kind] }, colors: { ...DEFAULT_COLORS[kind] } },
            [size, size, size],
          )
          close()
        }}>Create</Btn>
      </div>
    </Modal>
  )
}

export function ImportModal() {
  const close = useClose()
  const [message, setMessage] = useState('')
  const handle = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    try {
      if (ext === 'vcs') {
        if (useProject.getState().dirty && !window.confirm('Replace the current project? Unsaved changes will be lost.')) return
        loadProjectBytes(await readFileBytes(file))
        close()
      } else if (ext === 'vox') {
        const n = importVoxBytes(await readFileBytes(file))
        setMessage(`Imported ${n} voxels into a new layer.`)
      } else if (['json', 'gpl', 'hex', 'txt'].includes(ext ?? '')) {
        const p = parsePalette(await file.text(), file.name)
        useProject.getState().addPalette(p.name, p.colors)
        setMessage(`Imported palette "${p.name}" with ${p.colors.length} colors.`)
      } else {
        setMessage('Unsupported file type.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed')
    }
  }
  return (
    <Modal title="Import" onClose={close}>
      <p className="text-xs text-neutral-300">Project files (.vcs), MagicaVoxel models (.vox) and palettes (.json, .gpl, .hex).</p>
      <label className="flex h-24 cursor-pointer items-center justify-center rounded border border-dashed border-neutral-600 text-sm text-neutral-400 hover:bg-neutral-800">
        Choose a file
        <input type="file" className="hidden" accept=".vcs,.vox,.json,.gpl,.hex,.txt" onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handle(f)
          e.target.value = ''
        }} />
      </label>
      {message && <p className="text-xs text-indigo-300">{message}</p>}
    </Modal>
  )
}

type Fmt = 'vox' | 'obj' | 'glb' | 'gltf' | 'stl' | 'png' | 'gif' | 'fbx'

const FORMATS: { value: Fmt; label: string }[] = [
  { value: 'vox', label: 'VOX (MagicaVoxel)' },
  { value: 'obj', label: 'OBJ + MTL (zip)' },
  { value: 'glb', label: 'GLB (binary glTF)' },
  { value: 'gltf', label: 'GLTF (JSON, embedded)' },
  { value: 'stl', label: 'STL' },
  { value: 'png', label: 'PNG sprite sheet' },
  { value: 'gif', label: 'GIF animation' },
  { value: 'fbx', label: 'FBX (not supported)' },
]

const VIEW_GROUPS: { label: string; ids: ViewId[] }[] = [
  { label: 'Front', ids: ['front'] },
  { label: 'Side', ids: ['side'] },
  { label: 'Back', ids: ['back'] },
  { label: 'Isometric (4 directions)', ids: ['iso1', 'iso2', 'iso3', 'iso4'] },
]

export function ExportModal() {
  const close = useClose()
  const project = useProject()
  const [fmt, setFmt] = useState<Fmt>('glb')
  const [scale, setScale] = useState(0.1)
  const [center, setCenter] = useState(true)
  const [rig, setRig] = useState(false)
  const [withAnims, setWithAnims] = useState(true)
  const [groups, setGroups] = useState<Set<string>>(new Set(['Front', 'Side', 'Back']))
  const [pixelScale, setPixelScale] = useState(4)
  const [shaded, setShaded] = useState(true)
  const [padding, setPadding] = useState(1)
  const [transparent, setTransparent] = useState(true)
  const [bg, setBg] = useState('#20232b')
  const [animId, setAnimId] = useState(project.activeAnimId ?? '')
  const [gifView, setGifView] = useState<ViewId>('front')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)

  const base = safeName(project.meta.name)
  const anim = project.animations.find((a) => a.id === animId) ?? null

  const spriteOpts = (): SpriteOptions => ({
    views: VIEW_GROUPS.filter((g) => groups.has(g.label)).flatMap((g) => g.ids),
    scale: pixelScale,
    shaded,
    padding,
    animation: anim,
    background: transparent ? null : bg,
  })

  const run = async (previewOnly = false) => {
    setBusy(true)
    setMessage('')
    // Let the UI paint "Working..." before the synchronous export starts.
    await new Promise((r) => setTimeout(r, 30))
    try {
      const layers = project.layers
      if (fmt === 'vox') {
        downloadBlob(exportVox(grid, layers), `${base}.vox`)
      } else if (fmt === 'obj') {
        downloadBlob(exportObjZip(buildExportMesh(grid, layers, { scope: 'all', scale, center }), base), `${base}_obj.zip`, 'application/zip')
      } else if (fmt === 'stl') {
        downloadBlob(exportStl(buildExportMesh(grid, layers, { scope: 'all', scale, center })), `${base}.stl`)
      } else if (fmt === 'glb' || fmt === 'gltf') {
        const out = exportGltf(grid, layers, {
          binary: fmt === 'glb', scale, center, rig, animations: rig && withAnims ? project.animations : [],
        })
        downloadBlob(out.data, `${base}.${out.ext}`, out.ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json')
        if (rig && !out.rigged) {
          setMessage('Exported without a rig: tag at least two layers with body parts (Layers tab) or use a template.')
          return
        }
      } else if (fmt === 'png') {
        const canvas = renderSpriteSheet(grid, layers, spriteOpts())
        if (previewOnly) setPreview(canvas.toDataURL())
        else downloadBlob(await canvasToPng(canvas), `${base}_sprites.png`, 'image/png')
      } else if (fmt === 'gif') {
        downloadBlob(renderGif(grid, layers, { ...spriteOpts(), view: gifView }), `${base}.gif`, 'image/gif')
      }
      setMessage(previewOnly ? 'Preview updated' : 'Export complete')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const isMesh = fmt === 'obj' || fmt === 'stl' || fmt === 'glb' || fmt === 'gltf'
  const isSprite = fmt === 'png' || fmt === 'gif'

  return (
    <Modal title="Export" onClose={close} width="max-w-xl">
      <Row label="Format"><Select value={fmt} onChange={setFmt} options={FORMATS} className="w-56" /></Row>

      {fmt === 'fbx' && (
        <p className="rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-200">
          FBX is a closed format with no reliable browser exporter. Export GLB or GLTF instead; Blender, Unity, Unreal and Godot import both,
          including the auto-rig and animations.
        </p>
      )}

      {isMesh && (
        <>
          <Row label="Units per voxel"><NumberField value={scale} step={0.05} min={0.001} onChange={(n) => n > 0 && setScale(n)} /></Row>
          <Check checked={center} onChange={setCenter} label="Center on X/Z and rest on the ground" />
          <p className="text-[11px] text-neutral-500">Hidden layers are skipped. Faces between voxels are removed.</p>
        </>
      )}

      {(fmt === 'glb' || fmt === 'gltf') && (
        <>
          <Check checked={rig} onChange={setRig} label="Auto-rig: build a skeleton from body-part layers" />
          {rig && <Check checked={withAnims} onChange={setWithAnims} label={`Include animations (${project.animations.length})`} />}
          {rig && <p className="text-[11px] text-neutral-500">Tag layers with body parts (Layers tab) or start from a template. Each layer is bound rigidly to its bone.</p>}
        </>
      )}

      {fmt === 'vox' && <p className="text-[11px] text-neutral-500">Colors are reduced to 255. Axes are converted to MagicaVoxel's Z-up.</p>}

      {isSprite && (
        <>
          {fmt === 'png' && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {VIEW_GROUPS.map((g) => (
                <Check key={g.label} label={g.label} checked={groups.has(g.label)} onChange={(v) => {
                  const next = new Set(groups)
                  if (v) next.add(g.label)
                  else next.delete(g.label)
                  setGroups(next)
                }} />
              ))}
            </div>
          )}
          {fmt === 'gif' && (
            <Row label="View"><Select value={gifView} onChange={setGifView} options={(Object.keys(VIEW_LABELS) as ViewId[]).map((v) => ({ value: v, label: VIEW_LABELS[v] }))} /></Row>
          )}
          <Row label="Animation">
            <select className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs" value={animId} onChange={(e) => setAnimId(e.target.value)}>
              {fmt === 'png' && <option value="">Static (one row)</option>}
              {project.animations.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.length} frames)</option>)}
            </select>
          </Row>
          <Row label="Pixels per voxel"><NumberField value={pixelScale} min={1} max={32} onChange={(n) => setPixelScale(Math.max(1, Math.round(n)))} /></Row>
          <Row label="Padding (voxels)"><NumberField value={padding} min={0} max={32} onChange={(n) => setPadding(Math.max(0, Math.round(n)))} /></Row>
          <Check checked={shaded} onChange={setShaded} label="Shaded (off = flat colors)" />
          <div className="flex items-center gap-3">
            <Check checked={transparent} onChange={setTransparent} label="Transparent background" />
            {!transparent && <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />}
          </div>
          <p className="text-[11px] text-neutral-500">Sprites are rendered orthographically at integer scale. Rows are animation frames, columns are views.</p>
          {preview && fmt === 'png' && (
            <div className="max-h-64 overflow-auto rounded border border-neutral-700 bg-[repeating-conic-gradient(#333_0%_25%,#222_0%_50%)] [background-size:16px_16px]">
              <img src={preview} alt="Sprite sheet preview" style={{ imageRendering: 'pixelated' }} />
            </div>
          )}
        </>
      )}

      {message && <p className="text-xs text-indigo-300">{message}</p>}
      <div className="flex justify-end gap-2">
        {fmt === 'png' && <Btn disabled={busy} onClick={() => run(true)}>Preview</Btn>}
        <Btn onClick={close}>Close</Btn>
        <Btn active disabled={busy || fmt === 'fbx'} onClick={() => run(false)}>{busy ? 'Working...' : 'Export'}</Btn>
      </div>
    </Modal>
  )
}

export function GridModal() {
  const close = useClose()
  const bounds = useProject((s) => s.bounds)
  const view = useView()
  const [size, setSize] = useState<[number, number, number]>([...bounds])
  const [error, setError] = useState('')
  return (
    <Modal title="Grid settings" onClose={close}>
      <Row label="Size X / Y / Z">
        {[0, 1, 2].map((a) => (
          <NumberField key={a} value={size[a]} min={8} max={256} onChange={(n) => {
            const next: [number, number, number] = [...size]
            next[a] = n
            setSize(next)
          }} />
        ))}
        <Btn small onClick={() => {
          if (!useProject.getState().setBounds(size)) setError('The grid cannot be smaller than the model.')
          else setError('')
        }}>Apply</Btn>
      </Row>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <Check checked={view.showGrid} onChange={(v) => view.set({ showGrid: v })} label="Show floor grid" />
      <Check checked={view.showBounds} onChange={(v) => view.set({ showBounds: v })} label="Show bounding box" />
      <Check checked={view.showSymmetryPlanes} onChange={(v) => view.set({ showSymmetryPlanes: v })} label="Show symmetry planes" />
      <Row label="Major line every"><NumberField value={view.gridMajor} min={1} max={64} onChange={(n) => view.set({ gridMajor: Math.max(1, Math.round(n)) })} /></Row>
      <Row label="Grid color"><input type="color" value={view.gridColor} onChange={(e) => view.set({ gridColor: e.target.value })} /></Row>
      <Row label="Camera">
        <Select value={view.cameraMode} onChange={(v) => view.set({ cameraMode: v })} options={[
          { value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' },
        ]} />
      </Row>
      <p className="text-[11px] text-neutral-500">The grid is the editable area, up to 256 voxels per axis. Symmetry mirrors across its centre.</p>
    </Modal>
  )
}

export function PrefsModal() {
  const close = useClose()
  const view = useView()
  return (
    <Modal title="Preferences" onClose={close}>
      <Row label="Background"><input type="color" value={view.background} onChange={(e) => view.set({ background: e.target.value })} /></Row>
      <Row label={`Ambient light ${view.ambient.toFixed(2)}`}>
        <input type="range" min={0} max={2} step={0.05} value={view.ambient} onChange={(e) => view.set({ ambient: Number(e.target.value) })} />
      </Row>
      <Row label={`Light intensity ${view.lightIntensity.toFixed(2)}`}>
        <input type="range" min={0} max={3} step={0.05} value={view.lightIntensity} onChange={(e) => view.set({ lightIntensity: Number(e.target.value) })} />
      </Row>
      <Row label={`Light direction ${view.lightAzimuth} deg`}>
        <input type="range" min={-180} max={180} value={view.lightAzimuth} onChange={(e) => view.set({ lightAzimuth: Number(e.target.value) })} />
      </Row>
      <Row label={`Light height ${view.lightElevation} deg`}>
        <input type="range" min={5} max={90} value={view.lightElevation} onChange={(e) => view.set({ lightElevation: Number(e.target.value) })} />
      </Row>
      <Check checked={view.lightFollowsCamera} onChange={(v) => view.set({ lightFollowsCamera: v })} label="Light follows the camera" />
      <hr className="border-neutral-800" />
      <Check checked={view.autosave} onChange={(v) => view.set({ autosave: v })} label="Auto-save to this browser" />
      <Row label="Auto-save every (s)">
        <NumberField value={view.autosaveSeconds} min={5} max={600} onChange={(n) => view.set({ autosaveSeconds: Math.max(5, Math.round(n)) })} />
      </Row>
    </Modal>
  )
}

export function ProjectModal() {
  const close = useClose()
  const meta = useProject((s) => s.meta)
  const setMeta = useProject((s) => s.setMeta)
  return (
    <Modal title="Project details" onClose={close}>
      <Row label="Name"><input className="w-56 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs" value={meta.name} onChange={(e) => setMeta({ name: e.target.value })} /></Row>
      <Row label="Author"><input className="w-56 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs" value={meta.author} onChange={(e) => setMeta({ author: e.target.value })} /></Row>
      <textarea className="h-24 w-full rounded border border-neutral-600 bg-neutral-900 p-1 text-xs" placeholder="Description" value={meta.description} onChange={(e) => setMeta({ description: e.target.value })} />
      <p className="text-[11px] text-neutral-500">Created {new Date(meta.created).toLocaleString()}</p>
    </Modal>
  )
}

export function AboutModal() {
  const close = useClose()
  return (
    <Modal title="Voxel Character Studio" onClose={close} width="max-w-xl">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-300">
        <h4 className="col-span-2 font-semibold text-neutral-100">Navigation</h4>
        <span>Orbit</span><span>Right mouse, or Alt + left mouse</span>
        <span>Pan</span><span>Middle mouse, or Shift + right mouse</span>
        <span>Zoom</span><span>Mouse wheel</span>
        <span>Frame model</span><span>Home</span>
        <h4 className="col-span-2 mt-2 font-semibold text-neutral-100">Shortcuts</h4>
        <span>Tools</span><span>D E P I F L B O S M R T</span>
        <span>Symmetry</span><span>Shift + X / Y / Z</span>
        <span>Brush size</span><span>[ and ]</span>
        <span>Undo / Redo</span><span>Ctrl+Z / Ctrl+Y</span>
        <span>Copy / Paste</span><span>Ctrl+C / Ctrl+V</span>
        <span>Select all / none</span><span>Ctrl+A / Esc</span>
        <span>Nudge selection</span><span>Arrow keys, PageUp / PageDown</span>
        <span>Save</span><span>Ctrl+S</span>
      </div>
      <p className="text-[11px] text-neutral-500">
        Drawing happens on the face under the cursor and stays on that plane while you drag. Orbit to change planes.
      </p>
    </Modal>
  )
}
