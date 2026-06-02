#!/bin/bash
# Run on the Pi inside the camera venv site-packages after: pip install tensorflowjs==4.22.0 --no-deps
set -euo pipefail
SITE="${1:?usage: patch_tensorflowjs_pi.sh /path/to/site-packages}"

TFJS_CONV="$SITE/tensorflowjs/converters"
sed -i 's/^import tensorflow_decision_forests$/# optional: tensorflow_decision_forests/' \
  "$TFJS_CONV/tf_saved_model_conversion_v2.py"

cat > "$TFJS_CONV/__init__.py" <<'EOF'
# Patched for ASC inference: keras loader only.
from tensorflowjs.converters.keras_tfjs_loader import deserialize_keras_model, load_keras_model
EOF

echo "Patched tensorflowjs under $SITE"
