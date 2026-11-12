import { strToU8, zipSync } from 'fflate'
import type { Animation, Layer } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { canvasToPng, renderGif, renderSpriteSheet } from './sprites'
import type { SpriteOptions, ViewId } from './sprites'

const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'anim'

export interface PackOptions extends Omit<SpriteOptions, 'animation'> {
  gifView: ViewId
  includeGif: boolean
}

/** One sprite sheet, GIF and atlas entry per animation, zipped together. */
export async function exportAnimationPack(grid: VoxelGrid, layers: Layer[], anims: Animation[], opts: PackOptions): Promise<Uint8Array> {
  if (anims.length === 0) throw new Error('There are no animations to export')
  const files: Record<string, Uint8Array> = {}
  const atlas: object[] = []
  const used = new Set<string>()
  for (const anim of anims) {
    let stem = clean(anim.name)
    for (let i = 2; used.has(stem); i++) stem = `${clean(anim.name)}_${i}`
    used.add(stem)
    const canvas = renderSpriteSheet(grid, layers, { ...opts, animation: anim })
    const png = new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer())
    files[`${stem}.png`] = png
    if (opts.includeGif) files[`${stem}.gif`] = renderGif(grid, layers, { ...opts, animation: anim, view: opts.gifView })
    atlas.push({
      name: anim.name, kind: anim.kind ?? 'custom', variant: anim.variant ?? null, fps: anim.fps, loop: anim.loop,
      frames: anim.length, views: opts.views, sheet: `${stem}.png`, gif: opts.includeGif ? `${stem}.gif` : null,
      cellWidth: Math.round(canvas.width / opts.views.length), cellHeight: Math.round(canvas.height / anim.length),
      layout: 'rows are frames, columns are views',
    })
  }
  files['atlas.json'] = strToU8(JSON.stringify({ animations: atlas }, null, 2))
  return zipSync(files, { level: 3 })
}
