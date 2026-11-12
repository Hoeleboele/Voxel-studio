import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ViewState {
  cameraMode: 'perspective' | 'orthographic'
  background: string
  ambient: number
  lightIntensity: number
  lightAzimuth: number
  lightElevation: number
  lightFollowsCamera: boolean
  showGrid: boolean
  gridMajor: number
  showBounds: boolean
  showSymmetryPlanes: boolean
  gridColor: string
  autosave: boolean
  autosaveSeconds: number
  set(patch: Partial<ViewState>): void
}

export const useView = create<ViewState>()(
  persist(
    (set) => ({
      cameraMode: 'perspective',
      background: '#20232b',
      ambient: 0.65,
      lightIntensity: 1.1,
      lightAzimuth: 35,
      lightElevation: 50,
      lightFollowsCamera: true,
      showGrid: true,
      gridMajor: 8,
      showBounds: true,
      showSymmetryPlanes: true,
      gridColor: '#4a5163',
      autosave: true,
      autosaveSeconds: 30,
      set: (patch) => set(patch),
    }),
    { name: 'vcs-view-settings' },
  ),
)
