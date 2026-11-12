import { create } from 'zustand'
import type { Symmetry, Vec3 } from '../core/types'

export type ToolId =
  | 'draw' | 'erase' | 'paint' | 'pick' | 'fill' | 'line' | 'box' | 'sphere'
  | 'select' | 'move' | 'rotate' | 'mirror'

export interface ClipItem { x: number; y: number; z: number; color: number; mat: number }

export interface Preview {
  cells: number[]
  mode: 'add' | 'erase' | 'move'
}

interface EditorState {
  tool: ToolId
  color: number
  material: number
  brush: number
  sym: Symmetry
  fillPlane: boolean
  shapeOp: 'add' | 'erase'
  filled: boolean
  extrude: number
  selectThrough: boolean
  selection: Set<number>
  selectionRev: number
  clipboard: ClipItem[] | null
  preview: Preview | null
  hover: { cell: Vec3; place: Vec3 | null } | null
  status: string

  setTool(t: ToolId): void
  setColor(c: number): void
  setMaterial(m: number): void
  setBrush(n: number): void
  toggleSym(axis: keyof Symmetry): void
  set(patch: Partial<EditorState>): void
  setSelection(cells: Iterable<number>): void
  setPreview(p: Preview | null): void
  setHover(h: EditorState['hover']): void
  say(msg: string): void
}

export const useEditor = create<EditorState>((set) => ({
  tool: 'draw',
  color: 0xef7d57,
  material: 0,
  brush: 1,
  sym: { x: false, y: false, z: false },
  fillPlane: true,
  shapeOp: 'add',
  filled: true,
  extrude: 1,
  selectThrough: false,
  selection: new Set(),
  selectionRev: 0,
  clipboard: null,
  preview: null,
  hover: null,
  status: 'Ready',

  setTool: (tool) => set({ tool, preview: null }),
  setColor: (color) => set({ color }),
  setMaterial: (material) => set({ material }),
  setBrush: (brush) => set({ brush: Math.max(1, Math.min(16, Math.round(brush))) }),
  toggleSym: (axis) => set((s) => ({ sym: { ...s.sym, [axis]: !s.sym[axis] } })),
  set: (patch) => set(patch),
  setSelection: (cells) => set((s) => ({ selection: new Set(cells), selectionRev: s.selectionRev + 1 })),
  setPreview: (preview) => set({ preview }),
  setHover: (hover) => set({ hover }),
  say: (status) => set({ status }),
}))

export type ModalId = 'new' | 'export' | 'import' | 'grid' | 'prefs' | 'about' | 'project' | null
export type RightTab = 'palette' | 'layers' | 'structure' | 'timeline' | 'assets'

interface UiState {
  modal: ModalId
  rightTab: RightTab
  previewOpen: boolean
  playing: boolean
  frame: number
  restorePrompt: number | null
  setModal(m: ModalId): void
  setRightTab(t: RightTab): void
  set(patch: Partial<UiState>): void
}

export const useUi = create<UiState>((set) => ({
  modal: null,
  rightTab: 'palette',
  previewOpen: false,
  playing: false,
  frame: 0,
  restorePrompt: null,
  setModal: (modal) => set({ modal }),
  setRightTab: (rightTab) => set({ rightTab }),
  set: (patch) => set(patch),
}))
