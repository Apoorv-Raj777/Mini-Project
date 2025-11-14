import json, os, datetime
from config import AUDIT_FILE
from models.pipeline_loader import pipeline, legacy_model
from services.geospatial import latlng_to_cell, get_time_band
import numpy as np

# In-memory DB loaded from file (same semantics)
def load_audits():
    if os.path.exists(AUDIT_FILE):
        try:
            with open(AUDIT_FILE, "r") as f:
                return json.load(f)
        except:
            return []
    return []

audits_db = load_audits()

def save_audits():
    MAX_AUDITS = 50000
    if len(audits_db) > MAX_AUDITS:
        del audits_db[:-MAX_AUDITS]
    with open(AUDIT_FILE, "w") as f:
        json.dump(audits_db, f, indent=4)

# Legacy featurize (kept)
def legacy_featurize(audit):
    crowd_map = {"low": 0, "medium": 1, "high": 2}
    cctv_map = {"yes": 1, "no": 0}
    lighting = audit.get("lighting", 0)
    visibility = audit.get("visibility", 0)
    try:
        lighting = float(lighting)
    except:
        lighting = 0.0
    try:
        visibility = float(visibility)
    except:
        visibility = 0.0
    crowd = crowd_map.get(str(audit.get("crowd_density", "medium")).lower(), 1)
    cctv = cctv_map.get(str(audit.get("cctv", "yes")).lower(), 1)
    crime_rate = audit.get("crime_rate", 0)
    try:
        crime_rate = float(crime_rate)
    except:
        crime_rate = 0.0
    return np.array([[lighting, visibility, crowd, cctv, crime_rate]])

# Build DataFrame for pipeline (keeps exact columns expected)
def build_input_df(audit):
    import pandas as pd
    crowd_map = {"low": 0, "medium": 1, "high": 2}
    cctv_map = {"yes": 1, "no": 0}
    try:
        lighting = float(audit.get("lighting", 0))
    except:
        lighting = 0.0
    try:
        visibility = float(audit.get("visibility", 0))
    except:
        visibility = 0.0
    try:
        crime_rate = float(audit.get("crime_rate", 0))
    except:
        crime_rate = 0.0
    crowd = crowd_map.get(str(audit.get("crowd_density", "medium")).lower(), 1)
    cctv_flag = cctv_map.get(str(audit.get("cctv", "yes")).lower(), 1)
    poi_type = str(audit.get("poi_type", "none") or "none")
    security_present = str(audit.get("security_present", "not_sure") or "not_sure")
    df = pd.DataFrame([{
        "lighting": lighting,
        "visibility": visibility,
        "crime_rate": crime_rate,
        "crowd": int(crowd),
        "cctv_flag": int(cctv_flag),
        "poi_type": poi_type,
        "security_present": security_present
    }])
    return df

# Predict helper: uses pipeline or legacy model as before
def predict_score(audit):
    # pipeline loaded dynamically from models.pipeline_loader
    from models.pipeline_loader import pipeline as pl, legacy_model as lm
    if pl is not None:
        X_df = build_input_df(audit)
        try:
            return float(pl.predict_proba(X_df)[0][1])
        except Exception as e:
            raise RuntimeError(f"Prediction failed (pipeline): {e}")
    elif lm is not None:
        X = legacy_featurize(audit)
        try:
            return float(lm.predict_proba(X)[0][1])
        except Exception as e:
            raise RuntimeError(f"Prediction failed (legacy): {e}")
    else:
        raise RuntimeError("No model available. Run train.py to create safety_pipeline.joblib")
