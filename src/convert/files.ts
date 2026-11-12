import { decodeAseprite, decodeGif, isAseprite, isGif, isPng, parseAsepriteJson } from './decode'
import type { RgbaImage, SpriteSource } from './types'

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { w: img.width, h: img.height, data: img.data }
}

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

/** Accepts PNG, GIF, .ase/.aseprite, or an Aseprite JSON export together with its PNG sheet. */
export async function loadSpriteFiles(files: File[]): Promise<SpriteSource> {
  const json = files.find((f) => f.name.toLowerCase().endsWith('.json'))
  if (json) {
    const pngFile = files.find((f) => f.name.toLowerCase().endsWith('.png'))
    if (!pngFile) throw new Error('Select the exported PNG sheet together with the Aseprite JSON file')
    return parseAsepriteJson(await json.text(), await decodePng(await bytesOf(pngFile)))
  }
  const file = files[0]
  if (!file) throw new Error('No file selected')
  const bytes = await bytesOf(file)
  if (isAseprite(bytes)) return decodeAseprite(bytes)
  if (isGif(bytes)) return decodeGif(bytes)
  if (isPng(bytes)) {
    const img = await decodePng(bytes)
    return { frames: [img], durations: [100], tags: [], needsSlicing: true }
  }
  throw new Error('Unsupported sprite file. Use PNG, GIF, Aseprite (.ase/.aseprite) or Aseprite JSON + PNG')
}
