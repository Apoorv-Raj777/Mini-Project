# route_routes.py
from flask import Blueprint, request, jsonify
from services.routing_service import evaluate_route, sample_route_points
from services.heatmap_service import compute_aggregates
from services.audit_service import audits_db
import math
import logging

route_bp = Blueprint("route_bp", __name__, url_prefix="/api")

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# --- Helpers: haversine, spatial index, nearest lookup --------------------
def haversine_m(lat1, lon1, lat2, lon2):
    """Return haversine distance in meters between two lat/lon pairs."""
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2.0) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def build_spatial_index_from_aggs(aggs):
    """
    Build a simple list index and map for aggs.
    Returns: (index_list, cell_map)
      index_list: [(lat, lng, cell_id, bands_dict), ...]
      cell_map: { cell_id: bands_dict, ... }
    """
    pts = []
    cell_map = {}
    for cell_id, bands in aggs.items():
        # bands: dict of band -> agg_entry
        # take a representative lat/lng from any band
        any_band = None
        for b in bands.values():
            any_band = b
            break
        if not any_band:
            continue
        lat = any_band.get("lat")
        lng = any_band.get("lng")
        if lat is None or lng is None:
            continue
        try:
            lat = float(lat); lng = float(lng)
        except Exception:
            continue
        pts.append((lat, lng, cell_id, bands))
        cell_map[cell_id] = bands
    return pts, cell_map

def find_nearest_agg_cell(lat, lng, aggs_index, max_dist_m=300):
    """
    Find nearest aggs entry within max_dist_m.
    aggs_index: list returned by build_spatial_index_from_aggs
    Returns: (cell_id, bands_dict, distance_m) or (None, None, None)
    """
    best_cell = None
    best_bands = None
    best_d = None
    for a_lat, a_lng, cell_id, bands in aggs_index:
        d = haversine_m(lat, lng, a_lat, a_lng)
        if d <= max_dist_m and (best_d is None or d < best_d):
            best_cell = cell_id
            best_bands = bands
            best_d = d
    return best_cell, best_bands, best_d

# -------------------------------------------------------------------------

@route_bp.route("/safe_route", methods=["POST"])
def safe_route():
    try:
        payload = request.get_json(silent=True) or {}
        start = payload.get("start"); end = payload.get("end")
        if not start or not end:
            return jsonify({"error":"provide start and end coordinates"}), 400
        band = payload.get("band")  # optional band filter (e.g. 'night', 'evening')
        step_m = float(payload.get("step_m",50))
        candidates = payload.get("candidates")
        # radius within which we will consider a nearby agg cell (meters)
        max_nearest_m = float(payload.get("max_nearest_m", 300))

        # load aggregates
        aggs = compute_aggregates(audits_db, band_filter=band, min_samples=1)
        aggs_index, aggs_map = build_spatial_index_from_aggs(aggs)

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
            eval_res = None
            try:
                eval_res = evaluate_route(r, aggs, step_m=step_m)
            except Exception as ex:
                logger.exception("evaluate_route raised exception for route %s", r)
                eval_res = {"error": str(ex)}

            # If evaluate_route returned a full structure with 'per_point', attempt nearest-cell filling
            if eval_res and isinstance(eval_res, dict) and "per_point" in eval_res:
                per_point = eval_res.get("per_point") or []
                # Fill missing scores using nearest aggregate cell when possible
                filled_any = False
                for p in per_point:
                    try:
                        score = p.get("score")
                        samples = p.get("samples", 0) or 0
                        conf = p.get("conf", 0.0) or 0.0
                        # if this point has no known samples / score, attempt nearest
                        if samples == 0 or score is None:
                            lat = p.get("lat"); lng = p.get("lng")
                            if lat is None or lng is None:
                                continue
                            # exact lookup by cell id first
                            cell_id = p.get("cell")
                            agg_bands = None
                            if cell_id and cell_id in aggs_map:
                                agg_bands = aggs_map[cell_id]
                            else:
                                found_cell, found_bands, dist = find_nearest_agg_cell(lat, lng, aggs_index, max_dist_m=max_nearest_m)
                                if found_cell:
                                    agg_bands = found_bands
                                    logger.debug("Nearest agg for point (%s,%s) -> %s @ %dm", lat, lng, found_cell, int(dist))
                            if agg_bands:
                                # choose preferred band if available, else best available band
                                selected_band_entry = None
                                if band and band in agg_bands:
                                    selected_band_entry = agg_bands[band]
                                else:
                                    # pick band with highest confidence or largest N
                                    try:
                                        selected_band_entry = max(agg_bands.values(), key=lambda b: (b.get("confidence", 0.0), b.get("N", 0)))
                                    except Exception:
                                        # fallback: pick any
                                        selected_band_entry = next(iter(agg_bands.values()))
                                if selected_band_entry:
                                    p["score"] = selected_band_entry.get("score")
                                    p["conf"] = selected_band_entry.get("confidence", 0.0)
                                    p["samples"] = selected_band_entry.get("N", 0)
                                    p["_matched_cell"] = selected_band_entry.get("cell_id") or p.get("cell")
                                    filled_any = True
                    except Exception:
                        logger.exception("Error while trying to fill per_point %r", p)

                # recompute aggregate stats if we filled anything (or always recompute to be safe)
                try:
                    scores = [pt.get("score") for pt in per_point if pt.get("score") is not None]
                    confs = [float(pt.get("conf") or 0.0) for pt in per_point if pt.get("conf") is not None]
                    known_points = sum(1 for pt in per_point if (pt.get("samples") or 0) > 0)
                    sampled_points = int(eval_res.get("sampled_points", len(per_point)))
                    avg_score = (sum(scores)/len(scores)) if scores else None
                    avg_conf = (sum(confs)/len(confs)) if confs else 0.0
                    coverage = (known_points / sampled_points) if sampled_points > 0 else 0.0
                    overall_conf = avg_conf * coverage
                    # write back
                    eval_res["known_points"] = known_points
                    eval_res["avg_score"] = avg_score
                    eval_res["avg_conf"] = avg_conf
                    eval_res["coverage"] = coverage
                    eval_res["overall_conf"] = overall_conf
                except Exception:
                    logger.exception("Error recomputing eval summary for route %s", r)

            evaluations.append({"route": r, "eval": eval_res})

        # scoring key (same approach you had)
        def score_key(item):
            ev = item["eval"]
            if not ev:
                return -1
            sc = ev.get("avg_score") if ev.get("avg_score") is not None else 0.0
            return ev.get("overall_conf", 0.0) * sc

        evaluations.sort(key=score_key, reverse=True)
        best = evaluations[0] if evaluations else None

        return jsonify({
            "candidates_evaluated": len(evaluations),
            "best_route": best["route"] if best else None,
            "best_eval": best["eval"] if best else None,
            "all_evaluations": evaluations,
            "aggs_count": len(aggs_map),
            "aggs_indexed_points": len(aggs_index)
        })
    except Exception as e:
        logger.exception("safe_route top-level exception")
        return jsonify({"error": str(e)}), 500
