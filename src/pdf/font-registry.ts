export type FontVersion = {
  family: 'Noto Sans KR'
  normalFile: 'NotoSansKR.ttf'
  sha256: '194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252'
  licenseFile: 'OFL.txt'
  license: 'OFL-1.1'
  normalOnly: true
}

export const FONT_REGISTRY = {
  '1.0': {
    family: 'Noto Sans KR',
    normalFile: 'NotoSansKR.ttf',
    sha256: '194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252',
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    normalOnly: true,
  },
  '2.0': {
    family: 'Noto Sans KR',
    normalFile: 'NotoSansKR-subset-2.0.ttf',
    sha256: 'c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60',
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    normalOnly: true,
  },
} as const
