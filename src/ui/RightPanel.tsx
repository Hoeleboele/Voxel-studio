import { useUi } from '../store/editorStore'
import type { RightTab } from '../store/editorStore'
import { AssetsPanel } from './AssetsPanel'
import { LayersPanel } from './LayersPanel'
import { PalettePanel } from './PalettePanel'
import { StructurePanel } from './StructurePanel'
import { TimelinePanel } from './TimelinePanel'

const TABS: { id: RightTab; label: string }[] = [
  { id: 'palette', label: 'Palette' },
  { id: 'layers', label: 'Layers' },
  { id: 'structure', label: 'Object' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'assets', label: 'Assets' },
]

export function RightPanel() {
  const tab = useUi((s) => s.rightTab)
  const setTab = useUi((s) => s.setRightTab)
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900">
      <nav className="flex border-b border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-1 py-2 text-[11px] font-medium transition-colors ${
              tab === t.id ? 'border-b-2 border-indigo-500 bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-800/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        {tab === 'palette' && <PalettePanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'structure' && <StructurePanel />}
        {tab === 'timeline' && <TimelinePanel />}
        {tab === 'assets' && <AssetsPanel />}
      </div>
    </aside>
  )
}
