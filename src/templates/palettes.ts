import type { Palette } from '../core/types'

const p = (id: string, name: string, hex: string[]): Palette => ({
  id,
  name,
  builtin: true,
  colors: hex.map((h) => parseInt(h, 16)),
})

export const PRESET_PALETTES: Palette[] = [
  p('sweetie16', 'Sweetie 16', [
    '1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179',
    '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57',
  ]),
  p('pico8', 'PICO-8', [
    '000000', '1D2B53', '7E2553', '008751', 'AB5236', '5F574F', 'C2C3C7', 'FFF1E8',
    'FF004D', 'FFA300', 'FFEC27', '00E436', '29ADFF', '83769C', 'FF77A8', 'FFCCAA',
  ]),
  p('gameboy', 'Game Boy', ['0f380f', '306230', '8bac0f', '9bbc0f']),
  p('c64', 'Commodore 64', [
    '000000', 'FFFFFF', '68372B', '70A4B2', '6F3D86', '588D43', '352879', 'B8C76F',
    '6F4F25', '433900', '9A6759', '444444', '6C6C6C', '9AD284', '6C5EB5', '959595',
  ]),
  p('ega', 'EGA 16', [
    '000000', '0000AA', '00AA00', '00AAAA', 'AA0000', 'AA00AA', 'AA5500', 'AAAAAA',
    '555555', '5555FF', '55FF55', '55FFFF', 'FF5555', 'FF55FF', 'FFFF55', 'FFFFFF',
  ]),
  p('cga', 'CGA', ['000000', '55FFFF', 'FF55FF', 'FFFFFF']),
  p('earth', 'Earth tones', [
    '2b1d14', '4a3222', '6b4a31', '8c6a45', 'b08d5b', 'd4b483', 'e8d3a8', 'f5ebd0',
    '3d4a2c', '5f7a3a', '8aa64f', 'b7cf74', '3b4a5c', '5c7a94', '8fb1c9', 'c9dde8',
  ]),
  p('grayscale', 'Grayscale 8', ['000000', '242424', '494949', '6d6d6d', '929292', 'b6b6b6', 'dbdbdb', 'ffffff']),
]

export const DEFAULT_PALETTE_ID = 'sweetie16'
