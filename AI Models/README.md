# ASC AI models (Pi)

**Current:** ASC AI **v2** — PyTorch ResNet18 ensemble (`observatory/models/ASC_AI_v2/`)

Outputs:

- `sky`: `clear` | `cloudy` — Ready cloud gate requires `clear`
- `rain`: detected true/false — same rain gate as before

V2 blends 25% cropped-input and 75% full-frame probabilities. The full-frame member sees the complete camera image resized to 384×216, avoiding the horizontal crop in V1. The 269-frame expanded benchmark reports 96.7% gate accuracy, 96.6% rain F1, 7 false-OK, and 2 false-NO-GO decisions. See `observatory/models/ASC_AI_v2/MANIFEST.json` for member hashes and benchmark details.
