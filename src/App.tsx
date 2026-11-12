import { useEffect } from 'react'
import { discardAutosave, restoreAutosave, startAutosave } from './io/autosave'
import { useEditor, useUi } from './store/editorStore'
import { useProject } from './store/projectStore'
import { newCharacterProject } from './tools/projectOps'
import { DEFAULT_COLORS, DEFAULT_PROPORTIONS } from './templates/characters'
import { Btn, useGridRevision } from './ui/common'
import { useShortcuts, usePlayback } from './ui/hooks'
import { AboutModal, ExportModal, GridModal, ImportModal, NewModal, PrefsModal, ProjectModal } from './ui/Modals'
import { PreviewWindow } from './ui/PreviewWindow'
import { RightPanel } from './ui/RightPanel'
import { Toolbar } from './ui/Toolbar'
import { ToolPanel } from './ui/ToolPanel'
import { Viewport } from './viewport/Viewport'
import { grid } from './store/projectStore'

function StatusBar() {
  const status = useEditor((s) => s.status)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection.size)
  const sym = useEditor((s) => s.sym)
  const layer = useProject((s) => s.layers.find((l) => l.id === s.activeLayerId)?.name)
  const lastSaved = useProject((s) => s.lastSaved)
  useGridRevision()
  const symText = (['x', 'y', 'z'] as const).filter((a) => sym[a]).map((a) => a.toUpperCase()).join('') || 'off'
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400">
      <span className="text-neutral-200">{status}</span>
      <span>Tool: {tool}</span>
      <span>Layer: {layer}</span>
      <span>Symmetry: {symText}</span>
      <span>Selected: {selection}</span>
      <span className="ml-auto">Voxels: {grid.count.toLocaleString()}</span>
      <span>{lastSaved ? `Saved ${new Date(lastSaved).toLocaleTimeString()}` : 'Not saved'}</span>
    </footer>
  )
}

function RestoreBanner() {
  const time = useUi((s) => s.restorePrompt)
  if (time === null) return null
  const close = () => useUi.getState().set({ restorePrompt: null })
  return (
    <div className="flex items-center gap-3 border-b border-amber-700 bg-amber-950/60 px-3 py-1.5 text-xs text-amber-100">
      An auto-saved project from {new Date(time).toLocaleString()} was found.
      <Btn small onClick={async () => { await restoreAutosave(); close() }}>Restore</Btn>
      <Btn small onClick={async () => { await discardAutosave(); close() }}>Discard</Btn>
      <Btn small onClick={close}>Keep for later</Btn>
    </div>
  )
}

export default function App() {
  const modal = useUi((s) => s.modal)
  const previewOpen = useUi((s) => s.previewOpen)
  useShortcuts()
  usePlayback()

  useEffect(() => {
    if (grid.count === 0) {
      newCharacterProject({
        kind: 'humanoid', proportions: { ...DEFAULT_PROPORTIONS.humanoid }, colors: { ...DEFAULT_COLORS.humanoid },
      })
    }
    return startAutosave()
  }, [])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useProject.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <Toolbar />
      <RestoreBanner />
      <div className="flex min-h-0 flex-1">
        <ToolPanel />
        <Viewport />
        <RightPanel />
      </div>
      <StatusBar />
      {previewOpen && <PreviewWindow />}
      {modal === 'new' && <NewModal />}
      {modal === 'export' && <ExportModal />}
      {modal === 'import' && <ImportModal />}
      {modal === 'grid' && <GridModal />}
      {modal === 'prefs' && <PrefsModal />}
      {modal === 'project' && <ProjectModal />}
      {modal === 'about' && <AboutModal />}
    </div>
  )
}
