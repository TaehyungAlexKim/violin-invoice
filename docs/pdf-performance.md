# PDF font and transfer performance

The historical PDF font asset is retained unchanged for snapshot compatibility:

- Version: `1.0`
- File: `NotoSansKR.ttf`
- Size: about 10 MB
- SHA-256: `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252`
- License: SIL OFL 1.1
- Weight contract: normal and bold both resolve to the normal face.
- Korean and Latin text remain supported.

The font is not silently substituted. Snapshot manifests are checked against the deterministic registry and checksum before rendering. Font transfer reports loading progress and supports retryable failures.

## Version 2.0 subset

- Version: `2.0`
- File: `NotoSansKR-subset-2.0.ttf`
- Size: 4,108,588 bytes
- SHA-256: `c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60`
- License: SIL OFL 1.1; source and license: `public/fonts/OFL.txt`
- Generated with maintained `subset-font` 2.9.0 from the OFL historical asset.
- Coverage: full Korean Hangul syllable range plus Basic Latin, Latin-1 Supplement, Latin Extended-A/B, general/CJK punctuation, currency symbols, PDF symbols, en dash, em dash, middle dot, and won/euro signs.
- Reduction: 10,414,588 bytes → 4,108,588 bytes, a 60.5% size reduction.

Version 1.0 remains exactly unchanged and is the compatibility renderer for historical snapshots. Version 2.0 is new production metadata and a migration is included; old snapshots continue to validate and load version 1.0 assets.


## Production invoice download measurement

- Date: 2026-11-23
- Viewport: 375×812
- Environment: Chromium Playwright; CDP 400 ms latency, 400 Kbps down, 100 Kbps up
- Path: authenticated fixture route → finalized invoice detail → `Download PDF` → `downloadInvoice` → actual v2 font request
- Font file: `NotoSansKR-subset-2.0.ttf`
- Font bytes: 4,108,588
- Font transfer bytes observed: 4,108,858
- Font SHA-256: `c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60`
- Downloaded PDF bytes: 6,946
- Observed elapsed: 87,410 ms in the latest run
- PDF header: `%PDF-`

Timing depends on browser/CDP/render performance; record the observed range when repeated runs are available.
