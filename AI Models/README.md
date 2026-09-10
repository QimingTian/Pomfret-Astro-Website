# ASC AI models (Pi)

**Current:** ASC AI **v1** — single PyTorch ResNet18 dual-head (`observatory/models/ASC_AI_v1/best.pt`)

Outputs:

- `sky`: `clear` | `cloudy` — Ready cloud gate requires `clear`
- `rain`: detected true/false — same rain gate as before

Replaces the Teachable Machine black-box stack (four separate day/night cloud + rain models) and the interim ASC AI v0.6 checkpoint. Those artifacts are removed from this repository.
