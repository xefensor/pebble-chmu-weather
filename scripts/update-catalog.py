#!/usr/bin/env python3
"""Refresh bundled ČHMÚ temperature stations and ALADIN forecast places.

Development dependency: python3 -m pip install pyproj
The phone plugin uses only the generated JSON and has no Python dependency.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen


METADATA = "https://opendata.chmi.cz/meteorology/climate/now/metadata/"
POI = "https://data-provider.chmi.cz/api/poi/data/map/obce/"
USER_AGENT = "PebbleCHMUWeather/0.1 (https://github.com/xefensor/pebble-chmu-weather)"
ATTRIBUTION = {
    "text": "Data: Český hydrometeorologický ústav (ČHMÚ), licence CC BY 4.0",
    "provider": "https://www.chmi.cz/",
    "license": "https://creativecommons.org/licenses/by/4.0/",
}


def fetch(url, parse_json=True):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        text = response.read().decode("utf-8-sig")
    if not parse_json:
        return text
    data = json.loads(text)
    # Some website endpoints negotiate a JSON-encoded GeoJSON string when an
    # application/json Accept header is present. Decode that wrapper once.
    return json.loads(data) if isinstance(data, str) else data


def latest_metadata_date(requested=None):
    if requested:
        datetime.strptime(requested, "%Y%m%d")
        return requested
    index = fetch(METADATA, parse_json=False)
    meta1 = set(re.findall(r'meta1-(\d{8})\.json', index))
    meta2 = set(re.findall(r'meta2-(\d{8})\.json', index))
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    dates = sorted(date for date in meta1 & meta2 if date <= today)
    if not dates:
        raise ValueError("no matching meta1/meta2 files in the official metadata index")
    return dates[-1]


def table(document):
    data = document["data"]["data"]
    fields = data["header"].split(",")
    return [dict(zip(fields, values)) for values in data["values"]]


def in_czech_bounds(latitude, longitude):
    return 48.4 <= latitude <= 51.2 and 11.9 <= longitude <= 19.0


def stations(meta1, meta2):
    # meta1 includes non-temperature stations and one foreign station. Only
    # stations advertising actual ten-minute air-temperature measurements belong
    # in a "nearest temperature station" catalogue.
    capable = {
        row["WSI"] for row in table(meta2)
        if row["OBS_TYPE"] == "10M" and row["EG_EL_ABBREVIATION"] == "T"
        and row["SCHEDULE"] == "10M"
    }
    found = {}
    for row in table(meta1):
        identifier = row["GH_ID"]
        if row["WSI"] not in capable or not re.fullmatch(r"[A-Z][0-9][A-Z0-9]{6}", identifier):
            continue
        lat, lon, elevation = map(float, (row["GEOGR2"], row["GEOGR1"], row["ELEVATION"]))
        if not all(map(math.isfinite, (lat, lon, elevation))) or not in_czech_bounds(lat, lon):
            continue
        found[identifier] = {
            "id": identifier, "wsi": row["WSI"], "name": row["FULL_NAME"],
            "latitude": round(lat, 6), "longitude": round(lon, 6), "elevation": elevation,
        }
    if len(found) < 100 or "C2CBUD01" not in found:
        raise ValueError("temperature station catalogue is unexpectedly incomplete")
    return [found[key] for key in sorted(found)]


def places(geojsons):
    try:
        from pyproj import Transformer
    except ImportError as error:
        raise ValueError("catalogue updates require pyproj: python3 -m pip install pyproj") from error
    # The official map init declares EPSG:32633 for all three POI layers.
    transform = Transformer.from_crs("EPSG:32633", "EPSG:4326", always_xy=True)
    found = {}
    for document in geojsons:
        for feature in document["features"]:
            if feature.get("geometry", {}).get("type") != "Point":
                continue
            properties = feature["properties"]
            match = re.search(r"/meteogram/(\d+)(?:-|$)", properties["url"])
            if not match:
                raise ValueError("forecast place has no POI identifier: " + properties["url"])
            lon, lat = transform.transform(*feature["geometry"]["coordinates"][:2])
            if not all(map(math.isfinite, (lat, lon))) or not in_czech_bounds(lat, lon):
                continue
            identifier = match.group(1)
            found[identifier] = {
                "id": identifier, "name": properties["name"],
                "latitude": round(lat, 6), "longitude": round(lon, 6),
            }
    if len(found) < 500 or "75" not in found:
        raise ValueError("forecast place catalogue is unexpectedly incomplete")
    return [found[key] for key in sorted(found, key=int)]


def build(date=None):
    date = latest_metadata_date(date)
    source_urls = [METADATA + "meta1-" + date + ".json", METADATA + "meta2-" + date + ".json"]
    source_urls += [POI + str(level) for level in (2, 3, 4)]
    with ThreadPoolExecutor(max_workers=5) as pool:
        documents = list(pool.map(fetch, source_urls))
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "metadataDate": date,
        "sources": source_urls,
        "attribution": ATTRIBUTION,
        "stations": stations(documents[0], documents[1]),
        "forecastPlaces": places(documents[2:]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="exact metadata date YYYYMMDD; otherwise use newest available")
    parser.add_argument("--stdout", action="store_true", help="print JSON without editing any files")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "src/catalog.json")
    args = parser.parse_args()
    try:
        catalog = build(args.date)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, "Cannot update catalogue: " + str(error) + "\n")
    # Compact UTF-8 keeps the generated catalogue small for the phone runtime.
    text = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.stdout:
        sys.stdout.write(text)
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
        print("Updated " + str(args.output) + ": " + str(len(catalog["stations"])) +
              " stations, " + str(len(catalog["forecastPlaces"])) + " forecast places")


if __name__ == "__main__":
    main()
