from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import math
import datetime
import json
import os

app = Flask(__name__)
CORS(app)

# ------------------------------------------------------------------
# Load trained model
# ------------------------------------------------------------------
model = joblib.load("safety_model.joblib")

# ------------------------------------------------------------------
# JSON persistence setup
# ------------------------------------------------------------------
AUDIT_FILE = "audits_data.json"  # File to store audits

def load_audits():
    """Load existing audits from file if it exists."""
    if os.path.exists(AUDIT_FILE):
        try:
            with open(AUDIT_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_audits():
    """Save audits to file with auto-trim (max 10k entries)."""
    MAX_AUDITS = 10000
    if len(audits_db) > MAX_AUDITS:
        del audits_db[:-MAX_AUDITS]
    with open(AUDIT_FILE, "w") as f:
        json.dump(audits_db, f, indent=4)

# ------------------------------------------------------------------
# Initialize in-memory data from file
# ------------------------------------------------------------------
audits_db = load_audits()

# ------------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------------
def featurize(audit):
    """Convert categorical values to numeric"""
    # defensively handle a None audit
    if not audit:
        audit = {}

    crowd_map = {"low": 0, "medium": 1, "high": 2}
    cctv_map = {"yes": 1, "no": 0}

    # allow numeric lighting/visibility or fallback to 0
    lighting = audit.get("lighting", 0)
    visibility = audit.get("visibility", 0)

    try:
        lighting = float(lighting)
    except Exception:
        lighting = 0

    try:
        visibility = float(visibility)
    except Exception:
        visibility = 0

    crowd = crowd_map.get(str(audit.get("crowd_density", "medium")).lower(), 1)
    cctv = cctv_map.get(str(audit.get("cctv", "yes")).lower(), 1)

    return np.array([[
        lighting,
        visibility,
        crowd,
        cctv
    ]])

def get_time_band(ts):
    """Return time band (morning / afternoon / evening / night / midnight)."""
    hour = datetime.datetime.fromtimestamp(ts).hour
    if 5 <= hour < 12:
        return "morning"
    elif 12 <= hour < 17:
        return "afternoon"
    elif 17 <= hour < 21:
        return "evening"
    elif 21 <= hour < 24:
        return "night"
    else:
        return "midnight"

# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------
@app.route("/")
def home():
    return "✅ Flask Safety Audit API is running! Use /api/submit_audit or /api/heatmap_data"

@app.route("/api/submit_audit", methods=["POST"])
def submit_audit():
    try:
        # Accept only JSON bodies
        audit = request.get_json(silent=True)
        if not isinstance(audit, dict):
            return jsonify({"error": "Expected JSON body (Content-Type: application/json)"}), 400

        # featurize and predict
        X = featurize(audit)
        try:
            safety_score = float(model.predict_proba(X)[0][1])
        except Exception as ex:
            # If model doesn't support predict_proba or prediction fails, surface a clear error
            return jsonify({"error": f"Model prediction failed: {ex}"}), 500

        # Get timestamp (use current time if not given). Allow string timestamps too.
        ts_raw = audit.get("timestamp")
        if ts_raw is None:
            ts = int(datetime.datetime.now().timestamp())
        else:
            try:
                ts = int(float(ts_raw))
            except Exception:
                ts = int(datetime.datetime.now().timestamp())

        time_band = get_time_band(ts)

        # Ensure lat/lng exist as floats when storing heatmap points
        lat = audit.get("lat")
        lng = audit.get("lng")
        try:
            lat = float(lat) if lat is not None else None
        except Exception:
            lat = None
        try:
            lng = float(lng) if lng is not None else None
        except Exception:
            lng = None

        audit_record = {
            **audit,
            "timestamp": ts,
            "safety_score": safety_score,
            "time_band": time_band,
            "lat": lat,
            "lng": lng
        }
        audits_db.append(audit_record)
        save_audits()  # ✅ Persist the data after each POST

        return jsonify({
            "message": "Audit submitted",
            "time_band": time_band,
            "calculated_score": round(safety_score, 3)
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/heatmap_data", methods=["GET"])
def heatmap_data():
    try:
        lambda_decay = 0.001
        band = request.args.get("band")  # e.g. ?band=evening
        heatmap_points = []

        # Filter based on selected band
        filtered = [
            a for a in audits_db
            if (not band or band.lower() == "all" or a["time_band"] == band.lower())
        ]

        for data in filtered:
            age_days = (datetime.datetime.now() -
                        datetime.datetime.fromtimestamp(data["timestamp"])).days
            weight = math.exp(-lambda_decay * age_days)
            weighted_score = data["safety_score"] * weight
            heatmap_points.append([data["lat"], data["lng"], weighted_score])

        return jsonify(heatmap_points)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)
