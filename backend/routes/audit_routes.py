from flask import Blueprint, request, jsonify
from services.audit_service import predict_score, audits_db, save_audits
from services.geospatial import get_time_band
from services.geospatial import latlng_to_cell
from models.pipeline_loader import pipeline, legacy_model

audit_bp = Blueprint("audit_bp", __name__, url_prefix="/api")

@audit_bp.route("/submit_audit", methods=["POST"])
def submit_audit():
    try:
        audit = request.get_json(silent=True)
        if not isinstance(audit, dict):
            return jsonify({"error": "Expected JSON body (Content-Type: application/json)"}), 400
        try:
            prob = predict_score(audit)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        ts_raw = audit.get("timestamp")
        if ts_raw is None:
            ts = int(__import__("datetime").datetime.now().timestamp())
        else:
            try:
                ts = int(float(ts_raw))
            except:
                ts = int(__import__("datetime").datetime.now().timestamp())
        time_band = get_time_band(ts)
        lat = audit.get("lat"); lng = audit.get("lng")
        try: lat = float(lat) if lat is not None else None
        except: lat = None
        try: lng = float(lng) if lng is not None else None
        except: lng = None
        try:
            accuracy_m = float(audit.get("accuracy", 0.0))
        except:
            accuracy_m = 0.0
        if lat is not None and lng is not None and accuracy_m and accuracy_m > 200:
            lat = round(lat, 3); lng = round(lng, 3)
        cell_id = latlng_to_cell(lat, lng) if lat is not None and lng is not None else None
        audit_record = { **audit,
            "timestamp": ts, "safety_score": prob, "time_band": time_band,
            "lat": lat, "lng": lng, "cell_id": cell_id
        }
        audits_db.append(audit_record)
        save_audits()
        return jsonify({"message":"Audit submitted","time_band":time_band,"calculated_score": round(prob,3)}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500
