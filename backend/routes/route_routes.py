from flask import Blueprint, request, jsonify
from services.routing_service import evaluate_route, sample_route_points
from services.heatmap_service import compute_aggregates
from services.audit_service import audits_db
import math

route_bp = Blueprint("route_bp", __name__, url_prefix="/api")

@route_bp.route("/safe_route", methods=["POST"])
def safe_route():
    try:
        payload = request.get_json(silent=True) or {}
        start = payload.get("start"); end = payload.get("end")
        if not start or not end:
            return jsonify({"error":"provide start and end coordinates"}), 400
        band = payload.get("band")
        step_m = float(payload.get("step_m",50))
        candidates = payload.get("candidates")
        aggs = compute_aggregates(audits_db, band_filter=band, min_samples=1)
        routes = []
        if candidates and isinstance(candidates, list) and len(candidates) > 0:
            for cand in candidates:
                routes.append(cand)
        else:
            s_lat, s_lng = float(start[0]), float(start[1])
            e_lat, e_lng = float(end[0]), float(end[1])
            straight = [[s_lat, s_lng], [e_lat, e_lng]]
            def offset_point(lat, lng, meters_east=0, meters_north=0):
                dlat = meters_north / 111111.0
                dlon = meters_east / (111111.0 * max(1e-6, math.cos(math.radians(lat))))
                return [lat + dlat, lng + dlon]
            mid_lat = (s_lat + e_lat) / 2.0; mid_lng = (s_lng + e_lng) / 2.0
            detour_m = 200
            left_mid = offset_point(mid_lat, mid_lng, meters_east=-detour_m)
            right_mid = offset_point(mid_lat, mid_lng, meters_east=detour_m)
            left_route = [[s_lat, s_lng], left_mid, [e_lat, e_lng]]
            right_route = [[s_lat, s_lng], right_mid, [e_lat, e_lng]]
            routes = [straight, left_route, right_route]
        evaluations=[]
        for r in routes:
            eval_res = evaluate_route(r, aggs, step_m=step_m)
            evaluations.append({"route": r, "eval": eval_res})
        def score_key(item):
            ev = item["eval"]
            if not ev:
                return -1
            sc = ev["avg_score"] if ev["avg_score"] is not None else 0.0
            return ev["overall_conf"] * sc
        evaluations.sort(key=score_key, reverse=True)
        best = evaluations[0] if evaluations else None
        return jsonify({
            "candidates_evaluated": len(evaluations),
            "best_route": best["route"] if best else None,
            "best_eval": best["eval"] if best else None,
            "all_evaluations": evaluations
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
