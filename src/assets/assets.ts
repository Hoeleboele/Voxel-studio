import { create } from 'zustand'
import type { PartId, Vec3 } from '../core/types'
import type { ClipItem } from '../store/editorStore'
import type { CharacterKind, ColorScheme } from '../templates/characters'
import { kvGet, kvSet } from '../io/kv'

export type AssetCategory = 'character' | 'head' | 'arm' | 'leg' | 'weapon' | 'accessory' | 'prop'

export const ASSET_CATEGORIES: AssetCategory[] = ['character', 'head', 'arm', 'leg', 'weapon', 'accessory', 'prop']

export interface Asset {
  id: string
  name: string
  category: AssetCategory
  tags: string[]
  builtin?: boolean
  size: Vec3
  voxels: ClipItem[]
  part?: PartId
  /** Character presets regenerate a whole model instead of inserting voxels. */
  character?: { kind: CharacterKind; colors: Partial<ColorScheme> }
}

class Mini {
  cells = new Map<string, ClipItem>()

  put(x: number, y: number, z: number, color: number, mat = 0): this {
    this.cells.set(`${x},${y},${z}`, { x, y, z, color, mat })
    return this
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, mat = 0): this {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) this.put(x + i, y + j, z + k, color, mat)
    return this
  }

  sphere(cx: number, cy: number, cz: number, r: number, color: number, mat = 0): this {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 <= r * r) this.put(x, y, z, color, mat)
        }
      }
    }
    return this
  }

  build(id: string, name: string, category: AssetCategory, tags: string[], part?: PartId): Asset {
    return makeAsset(id, name, category, tags, [...this.cells.values()], part, true)
  }
}

export function makeAsset(
  id: string, name: string, category: AssetCategory, tags: string[], items: ClipItem[], part?: PartId, builtin = false,
): Asset {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const v of items) {
    min[0] = Math.min(min[0], v.x); min[1] = Math.min(min[1], v.y); min[2] = Math.min(min[2], v.z)
    max[0] = Math.max(max[0], v.x); max[1] = Math.max(max[1], v.y); max[2] = Math.max(max[2], v.z)
  }
  const voxels = items.map((v) => ({ ...v, x: v.x - min[0], y: v.y - min[1], z: v.z - min[2] }))
  const size: Vec3 = items.length ? [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1] : [0, 0, 0]
  return { id, name, category, tags, size, voxels, part, builtin }
}

const SKIN = 0xf2c9a0
const DARK = 0x1a1c2c
const GOLD = 0xffcd75
const STEEL = 0x94b0c2
const BROWN = 0x6b4a31

function builtins(): Asset[] {
  const out: Asset[] = []

  out.push(new Mini().sphere(4, 4, 4, 4, SKIN).put(2, 5, 7, DARK).put(5, 5, 7, DARK).box(3, 3, 7, 2, 1, 1, 0xb13e53)
    .build('b-head-round', 'Round head', 'head', ['head', 'round', 'face'], 'head'))
  out.push(new Mini().box(0, 0, 0, 8, 8, 8, SKIN).box(0, 6, 0, 8, 2, 8, BROWN).put(2, 4, 7, DARK).put(5, 4, 7, DARK)
    .build('b-head-square', 'Square head', 'head', ['head', 'blocky', 'face'], 'head'))
  out.push(new Mini().box(0, 0, 0, 8, 8, 8, STEEL, 1).box(1, 4, 7, 6, 2, 1, 0x73eff7, 3).box(3, 8, 3, 2, 3, 1, 0x566c86, 1).put(3, 11, 3, 0xef7d57, 3).put(4, 11, 3, 0xef7d57, 3)
    .build('b-head-robot', 'Robot head', 'head', ['head', 'robot', 'metal'], 'head'))
  out.push(new Mini().box(0, 0, 0, 8, 7, 7, 0xef7d57).box(0, 7, 1, 2, 2, 2, 0xef7d57).box(6, 7, 1, 2, 2, 2, 0xef7d57).put(2, 4, 6, 0x38b764).put(5, 4, 6, 0x38b764).box(3, 2, 6, 2, 1, 1, DARK)
    .build('b-head-cat', 'Cat head', 'head', ['head', 'cat', 'animal'], 'head'))

  out.push(new Mini().box(0, 2, 0, 3, 8, 3, 0x3b5dc9).box(0, 0, 0, 3, 2, 3, SKIN)
    .build('b-arm-human', 'Human arm', 'arm', ['arm', 'human'], 'armL'))
  out.push(new Mini().box(0, 2, 0, 3, 8, 3, 0x566c86, 1).box(0, 5, 0, 3, 1, 3, DARK, 1).box(0, 0, 0, 3, 2, 3, DARK, 1)
    .build('b-arm-robot', 'Robot arm', 'arm', ['arm', 'robot', 'metal'], 'armL'))
  out.push(new Mini().box(0, 3, 0, 4, 9, 4, 0x38b764).box(0, 0, 0, 4, 3, 4, 0x257179).put(0, 0, 3, 0xf4f4f4).put(2, 0, 3, 0xf4f4f4).put(3, 0, 3, 0xf4f4f4)
    .build('b-arm-claw', 'Claw arm', 'arm', ['arm', 'monster', 'claw'], 'armL'))

  out.push(new Mini().box(0, 2, 0, 3, 9, 3, 0x333c57).box(0, 0, 0, 3, 2, 3, DARK).box(0, 0, 3, 3, 1, 1, DARK)
    .build('b-leg-human', 'Human leg', 'leg', ['leg', 'human'], 'legL'))
  out.push(new Mini().box(0, 4, 0, 3, 6, 3, 0x6b4a31).box(0, 0, 0, 3, 4, 3, 0x333c57).box(0, 0, 3, 3, 2, 1, 0x333c57)
    .build('b-leg-boot', 'Boot leg', 'leg', ['leg', 'boot'], 'legL'))
  out.push(new Mini().box(0, 2, 0, 4, 8, 4, 0x94b0c2, 1).box(0, 5, 0, 4, 1, 4, DARK, 1).box(-1, 0, 0, 5, 2, 6, 0x566c86, 1)
    .build('b-leg-robot', 'Robot leg', 'leg', ['leg', 'robot', 'metal'], 'legL'))

  out.push(new Mini().box(0, 0, 0, 1, 12, 1, STEEL, 1).put(0, 12, 0, STEEL, 1).box(-2, -1, 0, 5, 1, 1, GOLD, 1).box(0, -4, 0, 1, 3, 1, BROWN).put(0, -5, 0, GOLD, 1)
    .build('b-weapon-sword', 'Short sword', 'weapon', ['weapon', 'sword', 'blade'], 'weapon'))
  out.push(new Mini().box(0, 0, 0, 1, 14, 1, BROWN).box(1, 9, 0, 3, 4, 1, STEEL, 1).box(-3, 9, 0, 3, 4, 1, STEEL, 1).put(-4, 10, 0, STEEL, 1).put(-4, 11, 0, STEEL, 1)
    .build('b-weapon-axe', 'Battle axe', 'weapon', ['weapon', 'axe'], 'weapon'))
  out.push(new Mini().box(0, 0, 0, 1, 16, 1, BROWN).sphere(0.5, 18, 0.5, 2, 0x73eff7, 3)
    .build('b-weapon-staff', 'Magic staff', 'weapon', ['weapon', 'staff', 'magic'], 'weapon'))
  out.push(new Mini().sphere(4, 4, 0.5, 4.2, 0x3b5dc9).sphere(4, 4, 1.5, 1.5, GOLD, 1)
    .build('b-weapon-shield', 'Round shield', 'weapon', ['weapon', 'shield'], 'weapon'))

  const hat = new Mini()
  for (let i = 0; i < 6; i++) hat.box(i, 3 + i, i, 11 - 2 * i, 1, 11 - 2 * i, 0x5d275d)
  hat.box(0, 3, 0, 11, 1, 11, 0x5d275d).put(5, 9, 5, GOLD, 3)
  out.push(hat.build('b-acc-hat', 'Wizard hat', 'accessory', ['hat', 'wizard', 'magic'], 'accessory'))
  out.push(new Mini().box(0, 0, 0, 8, 2, 8, GOLD, 1).put(0, 2, 0, GOLD, 1).put(3, 2, 0, GOLD, 1).put(4, 2, 0, GOLD, 1).put(7, 2, 0, GOLD, 1)
    .put(0, 2, 7, GOLD, 1).put(7, 2, 7, GOLD, 1).put(3, 2, 7, GOLD, 1).put(4, 2, 7, GOLD, 1).put(3, 1, 0, 0xb13e53, 3)
    .build('b-acc-crown', 'Crown', 'accessory', ['crown', 'king', 'hat'], 'accessory'))
  out.push(new Mini().box(0, 0, 0, 2, 2, 1, DARK).box(3, 0, 0, 2, 2, 1, DARK).box(2, 1, 0, 1, 1, 1, DARK).box(0, 0, 0, 5, 1, 1, DARK)
    .build('b-acc-glasses', 'Glasses', 'accessory', ['glasses', 'face'], 'accessory'))
  out.push(new Mini().box(0, 0, 0, 8, 10, 3, 0x6b4a31).box(1, 6, 3, 6, 3, 1, 0x4a3222).box(0, 9, 0, 8, 1, 3, 0x4a3222)
    .build('b-acc-backpack', 'Backpack', 'accessory', ['backpack', 'bag'], 'accessory'))

  const tree = new Mini().box(3, 0, 3, 2, 6, 2, BROWN)
  tree.sphere(4, 9, 4, 4, 0x38b764).sphere(4, 11, 4, 2.5, 0xa7f070)
  out.push(tree.build('b-prop-tree', 'Tree', 'prop', ['tree', 'nature', 'environment']))
  out.push(new Mini().box(0, 0, 0, 8, 5, 5, BROWN).box(0, 5, 0, 8, 2, 5, 0x8c6a45).box(0, 3, 0, 8, 1, 5, GOLD, 1).box(3, 3, 5, 2, 2, 1, GOLD, 1)
    .build('b-prop-chest', 'Treasure chest', 'prop', ['chest', 'treasure', 'loot']))
  out.push(new Mini().box(0, 0, 0, 6, 6, 6, 0xb08d5b).box(0, 0, 0, 6, 1, 6, BROWN).box(0, 5, 0, 6, 1, 6, BROWN).box(0, 0, 0, 1, 6, 1, BROWN).box(5, 0, 0, 1, 6, 1, BROWN)
    .box(0, 0, 5, 1, 6, 1, BROWN).box(5, 0, 5, 1, 6, 1, BROWN)
    .build('b-prop-crate', 'Crate', 'prop', ['crate', 'box', 'environment']))
  out.push(new Mini().box(0, 0, 0, 12, 1, 12, 0x73eff7, 2).box(0, 1, 0, 1, 4, 12, 0x566c86).box(11, 1, 0, 1, 4, 12, 0x566c86).box(0, 1, 0, 12, 4, 1, 0x566c86).box(0, 1, 11, 12, 4, 1, 0x566c86)
    .build('b-prop-pool', 'Pool', 'prop', ['pool', 'water', 'building']))
  out.push(new Mini().box(0, 0, 0, 14, 8, 12, 0xb08d5b).box(0, 8, 0, 14, 1, 12, 0x8c6a45).box(5, 0, 11, 4, 6, 1, 0x4a3222).box(2, 4, 11, 2, 2, 1, 0x73eff7, 2).box(10, 4, 11, 2, 2, 1, 0x73eff7, 2)
    .build('b-prop-house', 'Small house', 'prop', ['house', 'building', 'environment']))

  const preset = (id: string, name: string, kind: CharacterKind, colors: Partial<ColorScheme>, tags: string[]): Asset => ({
    id, name, category: 'character', tags: ['character', ...tags], builtin: true, size: [0, 0, 0], voxels: [], character: { kind, colors },
  })
  out.push(preset('b-char-knight', 'Knight', 'humanoid', { primary: 0x94b0c2, secondary: 0x566c86, accent: 0xef7d57, hair: 0x333c57 }, ['humanoid', 'armor']))
  out.push(preset('b-char-mage', 'Mage', 'humanoid', { primary: 0x5d275d, secondary: 0x29366f, accent: 0xffcd75, hair: 0xf4f4f4 }, ['humanoid', 'magic']))
  out.push(preset('b-char-goblin', 'Goblin', 'monster', { primary: 0xa7f070, secondary: 0x38b764, dark: 0x333c57 }, ['monster', 'green']))
  out.push(preset('b-char-cat', 'Orange cat', 'animal', {}, ['animal', 'cat']))
  out.push(preset('b-char-dog', 'Brown dog', 'animal', { primary: 0x8c6a45, secondary: 0xe8d3a8, hair: 0x4a3222, eye: 0x1a1c2c }, ['animal', 'dog']))
  out.push(preset('b-char-golem', 'Stone golem', 'monster', { primary: 0x94b0c2, secondary: 0x566c86, accent: 0x73eff7, eye: 0x73eff7, dark: 0x333c57 }, ['monster', 'stone']))
  out.push(preset('b-char-bot', 'Helper bot', 'robot', {}, ['robot', 'metal']))
  return out
}

export const BUILTIN_ASSETS = builtins()

interface AssetState {
  user: Asset[]
  loaded: boolean
  load(): Promise<void>
  add(asset: Asset): void
  remove(id: string): void
}

const KEY = 'user-assets'

export const useAssets = create<AssetState>((set, get) => ({
  user: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return
    try {
      const saved = await kvGet<Asset[]>(KEY)
      set({ user: saved ?? [], loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  add: (asset) => {
    const user = [...get().user, asset]
    set({ user })
    kvSet(KEY, user).catch(() => undefined)
  },
  remove: (id) => {
    const user = get().user.filter((a) => a.id !== id)
    set({ user })
    kvSet(KEY, user).catch(() => undefined)
  },
}))

const thumbCache = new Map<string, string>()

/** Front-facing pixel thumbnail as a data URL. */
export function thumbnail(asset: Asset): string {
  const cached = thumbCache.get(asset.id)
  if (cached) return cached
  if (asset.voxels.length === 0) return ''
  const [w, h] = asset.size
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const depth = new Map<number, number>()
  for (const v of asset.voxels) {
    const key = v.x + v.y * 1000
    if ((depth.get(key) ?? -1) < v.z) {
      depth.set(key, v.z)
      ctx.fillStyle = '#' + v.color.toString(16).padStart(6, '0')
      ctx.fillRect(v.x, h - 1 - v.y, 1, 1)
    }
  }
  const url = canvas.toDataURL()
  thumbCache.set(asset.id, url)
  return url
}
