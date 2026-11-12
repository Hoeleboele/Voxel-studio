declare module 'gifenc' {
  export type GifPalette = number[][]
  export interface GifFrameOptions {
    palette?: GifPalette
    delay?: number
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
  }
  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void
    finish(): void
    bytes(): Uint8Array
  }
  export function GIFEncoder(): GifEncoderInstance
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray, maxColors: number,
    opts?: { format?: string; oneBitAlpha?: boolean | number },
  ): GifPalette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: string): Uint8Array
}
