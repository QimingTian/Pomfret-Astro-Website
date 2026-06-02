# ASC AI Models

**Current release: [ASC AI Model Version 1](ASC_AI_MODEL_VERSION.json)** (`v1`)

Teachable Machine exports used for all-sky **cloud cover %** and **rain** inference on the Pi (`observatory/asc_cloud_ai.py`).

| Bundle | Role |
|--------|------|
| `Day_Cloud_Model` | Cloud % during nautical dawn → nautical dusk |
| `Night_Cloud_Model` | Cloud % during nautical dusk → nautical dawn |
| `Day_Rain_Model` | Rain detection, day phase |
| `Night_Rain_Model` | Rain detection, night phase |

Runtime copies live in `observatory/models/` (deployed to the Pi with `camera_service`).

## Versioning

- **v1** — initial production set (see `ASC_AI_MODEL_VERSION.json`).
- **v2+** — future stronger models: update weights under each `*_Model/` folder, bump `version` / `label` in `ASC_AI_MODEL_VERSION.json` (both here and `observatory/models/`), and tag the repo (e.g. `asc-ai-v2`).
