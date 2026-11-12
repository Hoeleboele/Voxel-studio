import type { PartId } from '../core/types'
import { colorClusters, colorDist, luminance, maskBounds, rgbOf, saturation } from './analyze'
import type { Bounds2D } from './analyze'
import type { LayerHint, RgbaImage } from './types'

export const PARTS: PartId[] = [
  'head', 'torso', 'armL', 'armR', 'legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR', 'tail', 'weapon', 'accessory', 'wingL', 'wingR',
]
const P = (p: PartId) => PARTS.indexOf(p)

export type SubKind = 0 | 1 | 2 // body, armor, clothing
export type BodyKind = 'auto' | 'biped' | 'quadruped' | 'prop'
export type Facing = 'front' | 'left' | 'right'

export interface Segmentation {
  w: number
  h: number
  part: Int8Array // index into PARTS, -1 = none
  sub: Uint8Array
  kind: Exclude<BodyKind, 'auto'>
  facing: Facing
  bounds: Bounds2D
  midX: number
}

export interface LayerSpec {
  key: string
  name: string
  part?: PartId
  sub: SubKind
}

const SUB_LABEL = ['', 'Armor', 'Clothing']
const PART_LABEL: Record<PartId, string> = {
  head: 'Head', torso: 'Torso', armL: 'Arm L', armR: 'Arm R', legL: 'Leg L', legR: 'Leg R',
  legFL: 'Leg FL', legFR: 'Leg FR', legBL: 'Leg BL', legBR: 'Leg BR', tail: 'Tail',
  weapon: 'Weapon', accessory: 'Accessory', wingL: 'Wing L', wingR: 'Wing R',
}

export function specKey(part: number, sub: number): string { return `${part}:${sub}` }

export function layerSpecs(seg: Segmentation): LayerSpec[] {
  const seen = new Map<string, LayerSpec>()
  for (let i = 0; i < seg.part.length; i++) {
    const p = seg.part[i]
    if (p < 0 && seg.kind !== 'prop') continue
    const key = specKey(p, seg.sub[i])
    if (seen.has(key)) continue
    if (p < 0) { seen.set(key, { key, name: 'Sprite', sub: 0 }); continue }
    const part = PARTS[p]
    const sub = seg.sub[i] as SubKind
    seen.set(key, { key, part, sub, name: sub ? `${SUB_LABEL[sub]} (${PART_LABEL[part]})` : PART_LABEL[part] })
  }
  const order = (s: LayerSpec) => (s.part ? PARTS.indexOf(s.part) * 3 + s.sub : -1)
  return [...seen.values()].sort((a, b) => order(a) - order(b))
}

function rowRuns(mask: Uint8Array, w: number, y: number, x0: number, x1: number): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  for (let x = x0; x <= x1 + 1; x++) {
    const on = x <= x1 && mask[y * w + x] === 1
    if (on && start < 0) start = x
    else if (!on && start >= 0) { out.push([start, x - 1]); start = -1 }
  }
  return out
}

const median = (v: number[]): number => {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function medianX(mask: Uint8Array, w: number, h: number): number {
  const xs: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) xs.push(x)
  return median(xs) + 0.5
}

/** Topmost row such that (nearly) every row below it down to the sprite's feet has `min` or more separate runs. */
function findLegTop(mask: Uint8Array, w: number, b: Bounds2D, min: number): { top: number; gapX: number } | null {
  let top = -1
  let singles = 0
  for (let y = b.y1; y >= b.y0; y--) {
    const runs = rowRuns(mask, w, y, b.x0, b.x1)
    if (runs.length >= min) { top = y; singles = 0 }
    else if (top >= 0 || y < b.y1 - 2) { singles++; if (singles >= 2 && top >= 0) break }
  }
  if (top < 0) return null
  const runs = rowRuns(mask, w, top, b.x0, b.x1)
  const mid = (b.x0 + b.x1 + 1) / 2
  let best = mid
  let bestD = Infinity
  for (let i = 1; i < runs.length; i++) {
    const g = (runs[i - 1][1] + 1 + runs[i][0]) / 2
    if (Math.abs(g - mid) < bestD) { bestD = Math.abs(g - mid); best = g }
  }
  return { top, gapX: best }
}

function symmetry(mask: Uint8Array, w: number, h: number, midX: number): number {
  let both = 0
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      total++
      const mx = Math.round(2 * midX - x - 1)
      if (mx >= 0 && mx < w && mask[y * w + mx]) both++
    }
  }
  return total ? both / total : 0
}

function headBounds(part: Int8Array, w: number, h: number): Bounds2D {
  const hb: Bounds2D = { x0: w, y0: h, x1: -1, y1: -1 }
  const headIdx = P('head')
  for (let i = 0; i < part.length; i++) {
    if (part[i] !== headIdx) continue
    const x = i % w, y = Math.floor(i / w)
    hb.x0 = Math.min(hb.x0, x); hb.x1 = Math.max(hb.x1, x); hb.y0 = Math.min(hb.y0, y); hb.y1 = Math.max(hb.y1, y)
  }
  return hb
}

/** Dominant bright colour across the lower-middle of the head, taken as the skin tone. */
function findSkin(img: RgbaImage, part: Int8Array, hb: Bounds2D): [number, number, number] | null {
  if (hb.x1 < 0) return null
  const w = img.w
  const hh = hb.y1 - hb.y0 + 1
  const hw = hb.x1 - hb.x0 + 1
  const hist = new Map<number, { n: number; c: number[] }>()
  for (let y = hb.y0 + Math.round(hh * 0.4); y <= hb.y0 + Math.round(hh * 0.85); y++) {
    for (let x = hb.x0 + Math.round(hw * 0.2); x <= hb.x1 - Math.round(hw * 0.2); x++) {
      const i = y * w + x
      if (part[i] !== P('head') || luminance(img, i) < 0.22) continue
      const c = rgbOf(img, i)
      const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4)
      const e = hist.get(k) ?? { n: 0, c }
      e.n++
      hist.set(k, e)
    }
  }
  const top = [...hist.values()].sort((a, z) => z.n - a.n)[0]
  return top ? (top.c as [number, number, number]) : null
}

function segmentBiped(img: RgbaImage, mask: Uint8Array, b: Bounds2D, part: Int8Array): { midX: number; facing: Facing; trunkHalf: number; bandTop: number; bandBottom: number } {
  const { w, h } = img
  const H = b.y1 - b.y0 + 1
  const midX = medianX(mask, w, h)
  const sym = symmetry(mask, w, h, midX)
  const front = sym >= 0.6

  // Head: rows above the neck (narrowest row in the upper part), falling back to 28% of the height.
  const widthAt = (y: number) => {
    const runs = rowRuns(mask, w, y, b.x0, b.x1)
    return runs.length ? runs[runs.length - 1][1] - runs[0][0] + 1 : 0
  }
  const headRows = Math.max(2, Math.round(H * 0.25))
  let headMax = 0
  for (let y = b.y0; y < b.y0 + headRows; y++) headMax = Math.max(headMax, widthAt(y))
  let headBottom = b.y0 + Math.round(H * 0.28)
  let neckW = Infinity
  for (let y = b.y0 + Math.round(H * 0.14); y <= b.y0 + Math.round(H * 0.4); y++) {
    const ww = widthAt(y)
    if (ww > 0 && ww < neckW && ww <= headMax * 0.8) { neckW = ww; headBottom = y + 1 }
  }

  const leg = findLegTop(mask, w, b, 2)
  let legTop = b.y0 + Math.round(H * 0.58)
  let gapX = midX
  if (leg && leg.top - b.y0 >= H * 0.4 && leg.top - b.y0 <= H * 0.85) { legTop = leg.top; gapX = leg.gapX }
  if (legTop <= headBottom + 1) legTop = Math.min(b.y1, headBottom + 2)

  const bandRows: number[] = []
  for (let y = headBottom; y < legTop; y++) bandRows.push(widthAt(y))
  const bandW = median(bandRows)
  const trunkHalf = Math.max(2, (bandW * 0.62) / 2)

  for (let y = b.y0; y <= b.y1; y++) {
    const runs = rowRuns(mask, w, y, b.x0, b.x1)
    let torsoRun = -1
    if (y >= headBottom && y < legTop && runs.length >= 3) {
      let bd = Infinity
      runs.forEach((r, i) => { const d = Math.abs((r[0] + r[1] + 1) / 2 - midX); if (d < bd) { bd = d; torsoRun = i } })
    }
    runs.forEach(([a, z], ri) => {
      for (let x = a; x <= z; x++) {
        const i = y * w + x
        const cx = x + 0.5
        if (y < headBottom) part[i] = P('head')
        else if (y >= legTop) part[i] = P(cx < gapX ? 'legL' : 'legR')
        else if (front && torsoRun >= 0) part[i] = ri === torsoRun ? P('torso') : P(cx < midX ? 'armL' : 'armR')
        else if (front && Math.abs(cx - midX) > trunkHalf) part[i] = P(cx < midX ? 'armL' : 'armR')
        else part[i] = P('torso')
      }
    })
  }

  // Profile sprites have no left/right symmetry, so the facing direction comes from where the head sits.
  let facing: Facing = 'front'
  if (!front) {
    let hx = 0, hc = 0, tx = 0, tc = 0
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * w + x
        if (part[i] === P('head')) { hx += x; hc++ } else if (part[i] === P('torso')) { tx += x; tc++ }
      }
    }
    facing = hc && tc && hx / hc < tx / tc ? 'left' : 'right'
  }
  return { midX, facing, trunkHalf, bandTop: headBottom, bandBottom: legTop }
}

function segmentQuadruped(img: RgbaImage, mask: Uint8Array, b: Bounds2D, part: Int8Array): { midX: number; facing: Facing } {
  const { w } = img
  const W = b.x1 - b.x0 + 1
  const H = b.y1 - b.y0 + 1
  const topOf = (x0: number, x1: number) => {
    let t = Infinity
    for (let y = b.y0; y <= b.y1 && t === Infinity; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) { t = y; break }
    return t
  }
  const q = Math.max(2, Math.round(W * 0.25))
  const facing: Facing = topOf(b.x1 - q + 1, b.x1) <= topOf(b.x0, b.x0 + q - 1) ? 'right' : 'left'
  const legInfo = findLegTop(mask, w, b, 3) ?? findLegTop(mask, w, b, 2)
  let legTop = b.y0 + Math.round(H * 0.62)
  if (legInfo && legInfo.top - b.y0 >= H * 0.35 && legInfo.top - b.y0 <= H * 0.85) legTop = legInfo.top
  const midX = (b.x0 + b.x1 + 1) / 2
  const headEdge = Math.round(W * 0.22)
  const tailEdge = Math.round(W * 0.18)

  const legRuns: [number, number][] = []
  const seen: [number, number][] = rowRuns(mask, w, Math.min(b.y1, legTop + Math.max(1, Math.round((b.y1 - legTop) / 2))), b.x0, b.x1)
  legRuns.push(...seen)
  const legPart = (cx: number): number => {
    const idx = legRuns.findIndex((r) => cx >= r[0] && cx <= r[1] + 1)
    const k = idx < 0 ? 0 : idx
    const n = legRuns.length
    const headSide = facing === 'right' ? cx > midX : cx < midX
    if (n <= 2) return P(headSide ? 'legFL' : 'legBL')
    const rank = facing === 'right' ? k : n - 1 - k
    const first = rank >= n / 2 // front half
    const alt = rank % 2 === 0
    return P(first ? (alt ? 'legFL' : 'legFR') : (alt ? 'legBL' : 'legBR'))
  }

  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      const dx = facing === 'right' ? b.x1 - x : x - b.x0
      const back = facing === 'right' ? x - b.x0 : b.x1 - x
      if (y >= legTop) part[i] = legPart(x + 0.5)
      else if (dx < headEdge) part[i] = P('head')
      else if (back < tailEdge && y < legTop - Math.round(H * 0.15)) part[i] = P('tail')
      else part[i] = P('torso')
    }
  }
  return { midX, facing }
}

function nameToPart(name: string, cx: number, midX: number): { part: PartId; sub: SubKind } | null {
  const n = name.toLowerCase()
  if (/weapon|sword|staff|bow|axe|spear|gun|shield|wand|dagger|mace/.test(n)) return { part: 'weapon', sub: 0 }
  if (/wing/.test(n)) return { part: cx < midX ? 'wingL' : 'wingR', sub: 0 }
  if (/tail/.test(n)) return { part: 'tail', sub: 0 }
  if (/accessor|belt|necklace|bag|jewel|glasses|ring|quiver|cape/.test(n)) return { part: 'accessory', sub: 0 }
  return null
}

export interface SegmentOptions {
  detectLayers: boolean
  body: BodyKind
  hints?: LayerHint[]
}

export function segmentSprite(img: RgbaImage, mask: Uint8Array, opts: SegmentOptions): Segmentation | null {
  const { w, h } = img
  const b = maskBounds(mask, w, h)
  if (!b) return null
  const part = new Int8Array(w * h).fill(-1)
  const sub = new Uint8Array(w * h)
  const W = b.x1 - b.x0 + 1
  const H = b.y1 - b.y0 + 1

  let kind: Exclude<BodyKind, 'auto'> = opts.body === 'auto' ? 'biped' : opts.body
  if (!opts.detectLayers) kind = 'prop'
  if (opts.body === 'auto' && kind !== 'prop' && W / H >= 1.35 && findLegTop(mask, w, b, 3)) kind = 'quadruped'
  if (kind === 'prop') return { w, h, part, sub, kind, facing: 'front', bounds: b, midX: (b.x0 + b.x1 + 1) / 2 }

  let midX: number
  let facing: Facing
  let trunkHalf = 0
  let bandTop = b.y0
  let bandBottom = b.y1
  if (kind === 'quadruped') {
    ({ midX, facing } = segmentQuadruped(img, mask, b, part))
  } else {
    ({ midX, facing, trunkHalf, bandTop, bandBottom } = segmentBiped(img, mask, b, part))
  }

  const { clusters } = colorClusters(img, mask)

  // Colour clusters keep a consistent label so torso/arm boundaries follow the artwork.
  if (kind === 'biped' && facing === 'front') {
    const arm = [P('armL'), P('armR'), P('torso')]
    for (const c of clusters) {
      if (c.size < 4) continue
      const votes = new Map<number, number>()
      let bx0 = Infinity, bx1 = -Infinity
      for (const p of c.pixels) {
        const y = Math.floor(p / w)
        if (y < bandTop || y >= bandBottom || !arm.includes(part[p])) continue
        votes.set(part[p], (votes.get(part[p]) ?? 0) + 1)
        bx0 = Math.min(bx0, p % w); bx1 = Math.max(bx1, p % w)
      }
      if (votes.size < 2 || bx1 - bx0 + 1 > W * 0.7) continue
      const winner = [...votes.entries()].sort((a, z) => z[1] - a[1])[0][0]
      for (const p of c.pixels) {
        const y = Math.floor(p / w)
        if (y >= bandTop && y < bandBottom && arm.includes(part[p])) part[p] = winner
      }
    }
  }

  // Weapon: elongated clusters that start low on the arm or stick out beyond it.
  if (kind === 'biped' && facing === 'front') {
    const bandH = Math.max(1, bandBottom - bandTop)
    let armOuter = trunkHalf
    for (let i = 0; i < part.length; i++) {
      if (part[i] === P('armL') || part[i] === P('armR')) armOuter = Math.max(armOuter, Math.abs((i % w) + 0.5 - midX))
    }
    const skinGuess = findSkin(img, part, headBounds(part, w, h))
    for (const side of [-1, 1]) {
      let total = 0
      const picked: number[][] = []
      for (const c of clusters) {
        if (c.size < 5) continue
        let outside = 0, minY = Infinity, minX = Infinity, maxX = -Infinity, maxY = -Infinity, inBand = 0
        for (const p of c.pixels) {
          const x = p % w
          const y = Math.floor(p / w)
          if ((x + 0.5 - midX) * side > trunkHalf + 0.5) outside++
          if (y >= bandTop && y < bandBottom + Math.round(H * 0.1)) inBand++
          minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        }
        if (outside < c.size * 0.7 || inBand < c.size * 0.6) continue
        if (colorDist(c.color, skinGuess ?? [-999, -999, -999]) < 30) continue
        const bw = maxX - minX + 1
        const bh = maxY - minY + 1
        const elongated = Math.max(bw, bh) / Math.min(bw, bh) >= 3
        const startsLow = minY > bandTop + bandH * 0.35
        const sticksOut = (side > 0 ? maxX + 1 - midX : midX - minX) > armOuter + 1.5
        if ((elongated && (startsLow || sticksOut)) || (startsLow && sticksOut)) { picked.push(c.pixels); total += c.size }
      }
      if (total >= 6) {
        for (const px of picked) for (const p of px) part[p] = P('weapon')
        break
      }
    }
  }

  // Equipment layers: clusters that differ from the skin colour found on the face.
  const headIdx = P('head')
  const hb = headBounds(part, w, h)
  const skin = findSkin(img, part, hb)

  if (skin && opts.detectLayers) {
    const headLimit = hb.y0 + Math.round((hb.y1 - hb.y0 + 1) * 0.45)
    for (let i = 0; i < part.length; i++) {
      const p = part[i]
      if (p < 0 || p === P('weapon')) continue
      if (p === headIdx && Math.floor(i / w) >= headLimit) continue
      if (luminance(img, i) < 0.22) continue
      const c = rgbOf(img, i)
      if (colorDist(c, skin) <= 70) continue
      sub[i] = saturation(c) < 0.22 && luminance(img, i) > 0.4 ? 1 : 2
    }
    // Tiny equipment patches fold back into the body layer.
    const counts = new Map<string, number>()
    const totals = new Map<number, number>()
    for (let i = 0; i < part.length; i++) {
      if (part[i] < 0) continue
      totals.set(part[i], (totals.get(part[i]) ?? 0) + 1)
      if (sub[i]) counts.set(specKey(part[i], sub[i]), (counts.get(specKey(part[i], sub[i])) ?? 0) + 1)
    }
    for (let i = 0; i < part.length; i++) {
      if (!sub[i]) continue
      const n = counts.get(specKey(part[i], sub[i])) ?? 0
      if (n < Math.max(6, (totals.get(part[i]) ?? 0) * 0.05)) sub[i] = 0
    }
  }

  // Source layer names (Aseprite) take priority over the heuristics.
  for (const hint of opts.hints ?? []) {
    const armor = /armor|armour|plate|helm|mail|gauntlet|boot/i.test(hint.name)
    const cloth = /cloth|shirt|robe|pants|hat|hair|scarf|tunic|dress/i.test(hint.name)
    for (let i = 0; i < hint.mask.length && i < part.length; i++) {
      if (!hint.mask[i] || !mask[i]) continue
      const named = nameToPart(hint.name, (i % w) + 0.5, midX)
      if (named) { part[i] = P(named.part); sub[i] = 0 }
      else if ((armor || cloth) && part[i] >= 0) sub[i] = armor ? 1 : 2
    }
  }

  // Labelling can leave stray unlabelled pixels (e.g. from hints); give them to the torso.
  for (let i = 0; i < part.length; i++) if (mask[i] && part[i] < 0) part[i] = P('torso')
  return { w, h, part, sub, kind, facing, bounds: b, midX }
}

/** Gives every pixel of a later frame the label of the nearest labelled pixel in the base frame. */
export function propagateLabels(base: Segmentation, mask: Uint8Array): { part: Int8Array; sub: Uint8Array } {
  const { w, h } = base
  const part = new Int8Array(w * h).fill(-1)
  const sub = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let found = -1
      for (let r = 0; r <= 8 && found < 0; r++) {
        let bd = Infinity
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
            const xx = x + dx, yy = y + dy
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
            const j = yy * w + xx
            if (base.part[j] < 0 && base.kind !== 'prop') continue
            const d = dx * dx + dy * dy
            if (d < bd) { bd = d; found = j }
          }
        }
      }
      if (found >= 0) { part[i] = base.part[found]; sub[i] = base.sub[found] }
      else part[i] = base.kind === 'prop' ? -1 : P('torso')
    }
  }
  return { part, sub }
}
