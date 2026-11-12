import { history } from '../core/history'
import { saveProjectFile } from '../io/project'
import { useUi } from '../store/editorStore'
import { useProject } from '../store/projectStore'
import { useView } from '../store/viewStore'
import { Btn, useHistoryVersion } from './common'

export function Toolbar() {
  const setModal = useUi((s) => s.setModal)
  const name = useProject((s) => s.meta.name)
  const dirty = useProject((s) => s.dirty)
  const cameraMode = useView((s) => s.cameraMode)
  useHistoryVersion()

  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-neutral-800 bg-neutral-900 px-3">
      <span className="mr-2 text-sm font-semibold tracking-tight text-indigo-300">Voxel Character Studio</span>
      <Btn onClick={() => setModal('new')}>New</Btn>
      <Btn onClick={saveProjectFile} title="Save project (Ctrl+S)">Save</Btn>
      <Btn onClick={() => setModal('import')}>Import</Btn>
      <Btn onClick={() => setModal('export')}>Export</Btn>
      <span className="mx-1 h-5 w-px bg-neutral-700" />
      <Btn disabled={!history.canUndo} onClick={() => history.undo()} title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Undo'}>Undo</Btn>
      <Btn disabled={!history.canRedo} onClick={() => history.redo()} title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Y)` : 'Redo'}>Redo</Btn>
      <span className="mx-1 h-5 w-px bg-neutral-700" />
      <Btn onClick={() => setModal('grid')}>Grid Settings</Btn>
      <Btn onClick={() => useView.getState().set({ cameraMode: cameraMode === 'perspective' ? 'orthographic' : 'perspective' })}>
        {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}
      </Btn>
      <Btn onClick={() => setModal('prefs')}>Preferences</Btn>
      <div className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
        <button className="rounded px-1 hover:bg-neutral-800 hover:text-white" onClick={() => setModal('project')} title="Project details">
          {name}{dirty ? ' *' : ''}
        </button>
        <Btn small onClick={() => setModal('about')}>?</Btn>
      </div>
    </header>
  )
}
