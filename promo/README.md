# Wander promotional video

The finished video is rendered from real Wander UI captures plus brand-matched motion graphics.

Run from the repository root:

```powershell
node promo/capture-stills.mjs
node promo/record-video.mjs
node promo/render-frames.mjs
powershell -ExecutionPolicy Bypass -File promo/encode-video.ps1
node promo/verify-video.mjs
```

The final output is `artifacts/wander-promo/wander-promo.mp4` (1280×720, about 90 seconds). `wander-promo.webm` is an intermediate ambient-audio master. The renderer uses a quiet original ambient bed and on-screen copy, so it works without narration. `voiceover.txt` is an optional narration script for a future recorded voice track.
