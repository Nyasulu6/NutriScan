"""Export the fitted sklearn logistic pipeline for equivalent server-side JS inference."""
import json
from pathlib import Path
import joblib

root = Path(__file__).resolve().parent.parent
saved = joblib.load(root / 'model.joblib')
pipeline = saved['model']
scaler = pipeline.named_steps['standardscaler']
model = pipeline.named_steps['logisticregression']
assert len(model.classes_) > 2, 'Only multiclass logistic regression is supported'
data = {
    'classes': model.classes_.tolist(),
    'mean': scaler.mean_.tolist(),
    'scale': scaler.scale_.tolist(),
    'coefficients': model.coef_.tolist(),
    'intercepts': model.intercept_.tolist(),
    'info': saved['info'],
}
(root / 'lib' / 'model.json').write_text(json.dumps(data, indent=2))
