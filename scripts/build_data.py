#!/usr/bin/env python3
"""Build assets/js/data.js from public USDA NRCS SNOTEL data.

Pulls daily snow water equivalent (WTEQ) and the NRCS median for every active
Colorado SNOTEL station for one water year, then writes the small JSON payload
the site's charts read.

    python3 scripts/build_data.py                    # fetch live, write assets/js/data.js
    python3 scripts/build_data.py --cache-dir .cache # reuse raw responses if present

Standard library only. Data source: https://wcc.sc.egov.usda.gov/awdbRestApi/
SNOTEL data is provisional and can be revised, so a fresh pull may differ
slightly from an earlier one.
"""
import argparse
import datetime
import json
import pathlib
import urllib.parse
import urllib.request

API = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"
WATER_YEAR = 2026                       # Oct 1 2025 - Sep 30 2026
BEGIN, END = f"{WATER_YEAR - 1}-10-01", f"{WATER_YEAR}-09-30"
CHART_END = f"{WATER_YEAR}-06-30"       # charts stop here; July-September is bare ground
N_RIDGES = 30                           # stations drawn in the ridgeline


def fetch_json(url, cache_file=None):
    """GET a JSON document, reading and writing an optional on-disk cache."""
    if cache_file and cache_file.exists():
        return json.loads(cache_file.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": "snotel-site-build"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = resp.read().decode("utf-8")
    if cache_file:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(body)
    return json.loads(body)


def active_colorado_stations(cache_dir):
    url = f"{API}/stations?" + urllib.parse.urlencode(
        {"stateCds": "CO", "networkCds": "SNTL", "activeOnly": "true"})
    stations = fetch_json(url, cache_dir / "stations.json" if cache_dir else None)
    # The endpoint can return more than was asked for, so filter again here.
    return [s for s in stations
            if s["stateCode"] == "CO" and s["networkCode"] == "SNTL"
            and s["endDate"].startswith("2100")]


def daily_swe(stations, cache_dir):
    url = f"{API}/data?" + urllib.parse.urlencode({
        "stationTriplets": ",".join(s["stationTriplet"] for s in stations),
        "elements": "WTEQ", "duration": "DAILY",
        "beginDate": BEGIN, "endDate": END,
        "centralTendencyType": "MEDIAN",
    }, safe=":,")
    return fetch_json(url, cache_dir / f"wteq_wy{WATER_YEAR}.json" if cache_dir else None)


def build(stations, raw, retrieved):
    meta = {s["stationTriplet"]: s for s in stations}
    first = datetime.date.fromisoformat(BEGIN)
    n_days = (datetime.date.fromisoformat(END) - first).days + 1
    dates = [(first + datetime.timedelta(days=i)).isoformat() for i in range(n_days)]
    keep = dates.index(CHART_END) + 1

    # Only stations with a complete year of both readings and medians.
    complete = []
    for st in raw:
        if not st.get("data"):
            continue
        vals = st["data"][0]["values"]
        if [v["date"] for v in vals] != dates:
            continue
        if any(v.get("value") is None or v.get("median") is None for v in vals):
            continue
        complete.append((meta[st["stationTriplet"]], vals))
    n = len(complete)

    # Statewide series: a simple, unweighted average across those stations.
    # (Official statewide figures weight by basin, so they differ slightly.)
    avg = [round(sum(vals[i]["value"] for _, vals in complete) / n, 2) for i in range(n_days)]
    med = [round(sum(vals[i]["median"] for _, vals in complete) / n, 2) for i in range(n_days)]

    rows = []
    for s, vals in complete:
        peak_day = max(range(n_days), key=lambda i: (vals[i]["value"], -i))
        med_peak_day = max(range(n_days), key=lambda i: (vals[i]["median"], -i))
        rows.append({
            "name": s["name"], "elev": int(s["elevation"]), "lat": round(s["latitude"], 3),
            "peak": vals[peak_day]["value"], "peakDay": peak_day,
            "medPeak": vals[med_peak_day]["median"], "medPeakDay": med_peak_day,
            "v": [int(round(v["value"] * 10)) for v in vals[:keep]],   # tenths of an inch
        })

    # Ridgeline: stations evenly spaced through the north-to-south ordering.
    rows.sort(key=lambda r: -r["lat"])
    picks = sorted({round(i * (n - 1) / (N_RIDGES - 1)) for i in range(N_RIDGES)})
    ridges = [rows[i] for i in picks]

    late_snow = max(max(v["value"] for v in vals[keep:]) for _, vals in complete)
    return {
        "snow": {
            "start": BEGIN, "days": keep, "retrieved": retrieved,
            "source": "USDA NRCS SNOTEL, provisional daily data",
            "ridges": ridges,
            "statewide": {"n": n, "avg": avg[:keep], "med": med[:keep]},
        }
    }, late_snow


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="assets/js/data.js")
    ap.add_argument("--cache-dir", type=pathlib.Path, default=None,
                    help="directory for raw API responses (read if present, else written)")
    ap.add_argument("--retrieved", default=datetime.date.today().isoformat(),
                    help="date the raw data was pulled, recorded in the output")
    args = ap.parse_args()

    stations = active_colorado_stations(args.cache_dir)
    raw = daily_swe(stations, args.cache_dir)
    data, late_snow = build(stations, raw, args.retrieved)

    header = (f"/* Generated by scripts/build_data.py. Snow data: {data['snow']['source']}, "
              f"water year {WATER_YEAR}, retrieved {args.retrieved}. */\n")
    out = pathlib.Path(args.out)
    out.write_text(header + "window.SITE_DATA=" + json.dumps(data, separators=(",", ":")) + ";\n")

    sw = data["snow"]["statewide"]
    peak = max(range(len(sw["avg"])), key=lambda i: sw["avg"][i])
    med_peak = max(range(len(sw["med"])), key=lambda i: sw["med"][i])
    print(f"{len(stations)} active stations, {sw['n']} with a complete year, "
          f"{len(data['snow']['ridges'])} in the ridgeline")
    print(f"statewide average peak {sw['avg'][peak]} in on day {peak}; "
          f"median peak {sw['med'][med_peak]} in on day {med_peak}")
    print(f"largest reading after {CHART_END} at any station: {late_snow} in")
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
