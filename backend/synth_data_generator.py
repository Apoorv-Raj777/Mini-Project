# synth_data_generator_full.py
"""
Generate synthetic historical_audits.csv including:
lighting, visibility, crowd_density, cctv, crime_rate, poi_type, security_present, overall_safe[, lat, lng]

Usage:
  python synth_data_generator_full.py --n 5000 --geo --out historical_audits.csv
"""
import csv, math, random, argparse
import numpy as np

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))

def generate_dataset(n_rows=5000, include_geo=True, seed=42, out_csv="historical_audits.csv"):
    random.seed(seed)
    np.random.seed(seed)

    # coefficients for latent safety (tweakable)
    beta_intercept = -0.2
    beta_lighting = 0.6
    beta_visibility = 0.55
    beta_crowd = -0.35
    beta_cctv = 0.7
    beta_crime = -0.9
    beta_poi = 0.1
    beta_security = 0.9
    noise_std = 0.5

    poi_choices = [
        ("none", 0.0),
        ("bus_stop", 0.1),
        ("metro_station", 0.4),
        ("train_station", 0.35),
        ("park", -0.2),
        ("market", 0.1),
        ("mall", 0.3),
        ("bar", -0.4),
        ("atm", -0.1),
        ("school", 0.2),
        ("residential", 0.05),
        ("other", 0.0)
    ]
    poi_names = [p for p,_ in poi_choices]

    # bounding box defaults (example city)
    lat_min, lat_max = 12.90, 13.10   # change to desired city if you want
    lon_min, lon_max = 77.50, 77.90

    rows = []
    for i in range(n_rows):
        lighting = int(np.clip(round(np.random.normal(3.4, 1.0)), 1, 5))
        visibility = int(np.clip(round(np.random.normal(3.2, 1.1)), 1, 5))

        r = random.random()
        if r < 0.45:
            crowd = "medium"; crowd_val = 1
        elif r < 0.75:
            crowd = "low"; crowd_val = 0
        else:
            crowd = "high"; crowd_val = 2

        crime_rate = int(np.clip(np.random.poisson(1.1), 0, 5))

        # choose poi_type correlated with crime_rate
        if crime_rate >= 4:
            weights = [1 if name not in ("bar","park","atm") else 3 for name in poi_names]
            poi = random.choices(poi_names, weights=weights, k=1)[0]
        else:
            weights = [2 if name in ("metro_station","mall","train_station","bus_stop","market") else 1 for name in poi_names]
            poi = random.choices(poi_names, weights=weights, k=1)[0]

        # security presence
        if crime_rate >= 4:
            security_present = "no" if random.random() < 0.7 else "yes"
        elif poi in ("metro_station","train_station","mall","school"):
            security_present = "yes" if random.random() < 0.8 else "no"
        else:
            security_present = "yes" if random.random() < 0.45 else "no"

        if security_present == "yes" or poi in ("metro_station","train_station","mall"):
            cctv = "yes" if random.random() < 0.85 else "no"
        else:
            cctv = "yes" if random.random() < 0.55 else "no"

        poi_safety_bonus = dict(poi_choices).get(poi, 0.0)
        x = (beta_intercept
             + beta_lighting * (lighting / 5.0)
             + beta_visibility * (visibility / 5.0)
             + beta_cctv * (1 if cctv=="yes" else 0)
             + beta_crowd * (crowd_val / 2.0)
             + beta_crime * (crime_rate / 5.0)
             + beta_poi * poi_safety_bonus
             + beta_security * (1 if security_present=="yes" else 0)
             + np.random.normal(0, noise_std))
        p_safe = sigmoid(x)

        label = 1 if random.random() < p_safe else 0
        if random.random() < 0.02:
            label = 1 - label

        if include_geo:
            lat = round(random.uniform(lat_min, lat_max), 6)
            lng = round(random.uniform(lon_min, lon_max), 6)
            row = {
                "lighting": lighting,
                "visibility": visibility,
                "crowd_density": crowd,
                "cctv": cctv,
                "crime_rate": crime_rate,
                "poi_type": poi,
                "security_present": security_present,
                "overall_safe": label,
                "lat": lat,
                "lng": lng
            }
        else:
            row = {
                "lighting": lighting,
                "visibility": visibility,
                "crowd_density": crowd,
                "cctv": cctv,
                "crime_rate": crime_rate,
                "poi_type": poi,
                "security_present": security_present,
                "overall_safe": label
            }
        rows.append(row)

    fieldnames = ["lighting", "visibility", "crowd_density", "cctv", "crime_rate", "poi_type", "security_present", "overall_safe"]
    if include_geo:
        fieldnames += ["lat", "lng"]

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)

    safe_frac = sum(r["overall_safe"] for r in rows) / len(rows)
    print(f"Generated {len(rows)} rows -> safe fraction {safe_frac:.3f} saved to {out_csv}")
    return out_csv

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic historical_audits.csv (with POI & security)")
    parser.add_argument("--n", type=int, default=5000, help="rows to generate")
    parser.add_argument("--geo", action="store_true", help="include lat/lng columns")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=str, default="historical_audits.csv")
    args = parser.parse_args()
    generate_dataset(n_rows=args.n, include_geo=args.geo, seed=args.seed, out_csv=args.out)