import os, joblib
from config import PIPELINE_PATH, LEGACY_MODEL_PATH

pipeline = None
legacy_model = None

def load_models():
    global pipeline, legacy_model
    pipeline = None
    legacy_model = None

    if os.path.exists(PIPELINE_PATH):
        try:
            pipeline = joblib.load(PIPELINE_PATH)
            print("Loaded pipeline from", PIPELINE_PATH)
        except Exception as e:
            print("Failed to load pipeline:", e)
            pipeline = None

    if pipeline is None and os.path.exists(LEGACY_MODEL_PATH):
        try:
            legacy_model = joblib.load(LEGACY_MODEL_PATH)
            print("Loaded legacy model from", LEGACY_MODEL_PATH)
        except Exception as e:
            print("Failed to load legacy model:", e)
            legacy_model = None
