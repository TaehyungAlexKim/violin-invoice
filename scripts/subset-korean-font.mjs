import { readFile, writeFile } from 'node:fs/promises'
import subsetFont from 'subset-font'

const latinRanges = [
  [0x20, 0x7e],       // Basic Latin
  [0xa0, 0xff],       // Latin-1 Supplement
  [0x0100, 0x024f],   // Latin Extended-A/B
  [0x2000, 0x206f],   // General punctuation
  [0x20a0, 0x20cf],   // Currency symbols
  [0x3000, 0x303f],   // CJK punctuation
]
const latin = latinRanges
  .map(([start, end]) => Array.from({ length: end - start + 1 }, (_, i) => String.fromCodePoint(start + i)).join(''))
  .join('')
const korean = Array.from({ length: 11172 }, (_, index) => String.fromCodePoint(0xac00 + index)).join('')
const source = await readFile('public/fonts/NotoSansKR.ttf')
const subset = await subsetFont(source, latin + korean, {
  targetFormat: 'sfnt',
  noHinting: true,
  keepFeatures: [],
})
await writeFile('public/fonts/NotoSansKR-subset-2.0.ttf', subset)
