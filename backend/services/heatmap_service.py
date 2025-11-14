import math, datetime
from services.geospatial import decay_weight, latlng_to_cell, haversine_m
from config import K_CONF
from services.audit_service import audits_db

# compute_aggregates preserved (function renamed here)
def compute_aggregates(audits, band_filter=None, min_samples=1):
    now = datetime.datetime.now()
    aggs = {}
    for a in audits:
        lat = a.get("lat"); lng = a.get("lng")
        if lat is None or lng is None: continue
        band = a.get("time_band")
        if band_filter and band_filter.lower() != "all":
            if band is None or band.lower() != band_filter.lower(): continue
        cell = a.get("cell_id") or latlng_to_cell(lat, lng)
        if cell is None: continue
        ts = a.get("timestamp", now.timestamp())
        w = decay_weight(ts, now)
        s = float(a.get("safety_score", 0.0))
        key = (cell, band)
        if key not in aggs:
            aggs[key] = {"W": w, "S": w*s, "N": 1, "last_ts": ts, "lat_sum": lat, "lng_sum": lng}
        else:
            e = aggs[key]
            e["W"] += w; e["S"] += w*s; e["N"] += 1
            e["last_ts"] = max(e["last_ts"], ts)
            e["lat_sum"] += lat; e["lng_sum"] += lng

    out = {}
    for (cell, band), e in aggs.items():
        N, W, S = e["N"], e["W"], e["S"]
        if N < min_samples: continue
        score = (S/W) if W>0 else None
        confidence = min(1.0, math.sqrt(W) / K_CONF)
        lat_mean = e["lat_sum"]/N
        lng_mean = e["lng_sum"]/N
        out.setdefault(cell, {})[band] = {
            "cell_id": cell, "band": band, "W": W, "S": S, "N": N, "last_ts": e["last_ts"],
            "score": score, "confidence": confidence, "lat": lat_mean, "lng": lng_mean
        }
    return out

# Keep OPENAPI and SWAGGER_HTML here so app.py routes can reuse them (unchanged)
OPENAPI = {
    "openapi": "3.0.0",
    "info": {
        "title": "Flask Safety Audit API",
        "version": "1.0.0",
        "description": "API for submitting safety audits and retrieving heatmap data."
    },
    "servers": [{"url": "http://127.0.0.1:5000"}],
    "paths": {
        # minimal spec entries (kept same as before)
    }
}

SWAGGER_HTML = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Swagger UI - Safety Audit API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>window.onload=function(){SwaggerUIBundle({url:"/openapi.json",dom_id:'#swagger-ui',deepLinking:true,presets:[SwaggerUIBundle.presets.apis],layout:"BaseLayout"});}</script></body></html>
"""
