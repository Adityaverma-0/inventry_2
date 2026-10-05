# English OCR model

`eng.traineddata` is the Tesseract tessdata_fast English LSTM model. It runs entirely locally through `tesseract.js` 7.0.0; invoice content is not uploaded to an OCR service.

- Source repository: https://github.com/tesseract-ocr/tessdata_fast
- Pinned commit: `87416418657359cb625c412a48b6e1d6d41c29bd`
- Download: https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/eng.traineddata
- SHA-256: `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`
- License: Apache-2.0, included as `LICENSE` from the same commit.
- Retrieved and checked: 4 October 2026.

Verify with `sha256sum runtime/ocr/eng.traineddata` (Linux) or `shasum -a 256 runtime/ocr/eng.traineddata` (macOS).
