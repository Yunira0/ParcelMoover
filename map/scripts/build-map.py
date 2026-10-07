#!/usr/bin/env python3
"""Compile an Overpass snapshot into compact, offline SVG geometry.

Usage: python3 scripts/build-map.py /path/to/overpass.json
The query is kept beside this script. Raw data remains ODbL licensed.
"""
import datetime
import heapq
import gzip
import json
import math
import pathlib
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
BOUNDS = {"south": 27.684, "west": 85.277, "north": 27.755, "east": 85.381}
WIDTH = 1600


def mercator(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


SCALE = WIDTH / math.radians(BOUNDS["east"] - BOUNDS["west"])
TOP = mercator(BOUNDS["north"])
HEIGHT = round((TOP - mercator(BOUNDS["south"])) * SCALE, 2)


def project(lon, lat):
    return [round(math.radians(lon - BOUNDS["west"]) * SCALE, 1),
            round((TOP - mercator(lat)) * SCALE, 1)]


def path(points, closed=False):
    if len(points) < 2:
        return ""
    return "M" + "L".join(f"{x},{y}" for x, y in points) + ("Z" if closed else "")


def length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Pass an Overpass JSON snapshot; see scripts/kathmandu.overpass.")
    source = json.loads(pathlib.Path(sys.argv[1]).read_text())
    if source.get("remark"):
        raise SystemExit("Overpass returned incomplete data: " + source["remark"])
    elements = source["elements"]
    buildings = defaultdict(list)
    minor = defaultdict(list)
    road_groups = defaultdict(list)
    water, green, airport, labels = [], [], [], []
    places = []
    building_count = road_count = 0
    graph = defaultdict(dict)
    locations = {}
    road_classes = {"motorway", "trunk", "primary", "secondary", "tertiary"}
    driveable = road_classes | {"residential", "unclassified", "living_street"}
    for item in elements:
        tags = item.get("tags", {})
        name = tags.get("name:en", tags.get("name", ""))
        geom = item.get("geometry", [])
        pts = [project(p["lon"], p["lat"]) for p in geom if "lat" in p]
        if pts:
            # The bounding-box centre is stable for landmarks with building outlines.
            xy = [(min(p[0] for p in pts) + max(p[0] for p in pts)) / 2,
                  (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2]
        elif "lat" in item:
            xy = project(item["lon"], item["lat"])
        else:
            continue
        if name and 0 <= xy[0] <= WIDTH and 0 <= xy[1] <= HEIGHT:
            places.append({"id": f'{item["type"]}-{item["id"]}', "name": name,
                           "x": round(xy[0], 2), "y": round(xy[1], 2), "tags": tags})
        if item["type"] != "way" or len(pts) < 2:
            continue
        closed = item.get("nodes", [0, 1])[0] == item.get("nodes", [0, 1])[-1]
        d = path(pts, closed)
        bucket = (max(0, min(15, int(xy[0] / WIDTH * 16))),
                  max(0, min(15, int(xy[1] / HEIGHT * 16))))
        if "building" in tags:
            buildings[bucket].append(d)
            building_count += 1
        elif "highway" in tags:
            road_count += 1
            kind = tags["highway"].removesuffix("_link")
            if kind in road_classes:
                road_groups[(kind, name)].append(d)
                if name and length(pts) > 95:
                    ordered = pts if pts[0][0] <= pts[-1][0] else list(reversed(pts))
                    labels.append({"id": str(item["id"]), "name": name,
                                   "d": path(ordered), "length": round(length(pts))})
            else:
                kind = "path" if kind in {"footway", "path", "steps", "cycleway", "pedestrian"} else "local"
                minor[(kind, *bucket)].append(d)
            if tags["highway"] in driveable and tags.get("access") != "private":
                ids = item.get("nodes", [])
                for node, pt in zip(ids, pts):
                    locations[node] = pt
                for a, b in zip(ids, ids[1:]):
                    cost = math.dist(locations[a], locations[b])
                    if tags.get("oneway") != "-1":
                        graph[a][b] = cost
                    if tags.get("oneway") not in {"yes", "1", "true"}:
                        graph[b][a] = cost
        elif "waterway" in tags or tags.get("natural") == "water":
            water.append({"id": str(item["id"]), "d": d, "area": closed,
                          "kind": tags.get("waterway", "water"), "name": name})
        elif "aeroway" in tags:
            airport.append({"id": str(item["id"]), "d": d, "kind": tags["aeroway"], "area": closed})
        elif closed:
            kind = "forest" if tags.get("natural") in {"wood", "scrub"} or tags.get("landuse") == "forest" else "park"
            green.append({"id": str(item["id"]), "d": d, "kind": kind, "name": name})

    # Curated source labels, rather than invented landmark positions.
    landmark_specs = [
        ("swayambhu", "Swayambhunath", "stupa"),
        ("boudha", "Boudhanath", "stupa"),
        ("pashupati", "Pashupatinath", "temple"),
        ("garden of dreams", "Garden of Dreams", "garden"),
        ("narayanhiti", "Narayanhiti Palace", "palace"),
        ("dharahara", "Dharahara", "tower"),
        ("durbar square", "Kathmandu Durbar Square", "temple"),
        ("rani pokhari", "Rani Pokhari", "water"),
    ]
    landmarks = []
    for search, display, kind in landmark_specs:
        candidates = [p for p in places if search in p["name"].lower() and
                      (p["tags"].get("tourism") in {"attraction", "museum"} or
                       p["tags"].get("amenity") == "place_of_worship" or
                       p["tags"].get("leisure") == "park" or p["tags"].get("natural") == "water")]
        candidates.sort(key=lambda p: (p["name"].lower() != display.lower(),
                                      0 if p["tags"].get("tourism") == "attraction" else 1,
                                      len(p["name"])))
        if candidates:
            p = candidates[0]
            landmarks.append({"id": p["id"], "name": display, "x": p["x"], "y": p["y"], "kind": kind})
    neighborhoods = []
    for p in places:
        if p["tags"].get("place") in {"suburb", "neighbourhood"}:
            if len(p["name"]) < 25 and p["name"].isascii():
                neighborhoods.append({k: p[k] for k in ("id", "name", "x", "y")})
    # Cull close labels at the overview level; retain street labels for closer zoom.
    neighborhoods.sort(key=lambda p: (p["name"] not in {"Thamel", "Lazimpat", "Baluwatar", "Baneshwor", "Chabahil", "Kalanki"}, p["name"]))
    accepted = []
    for p in neighborhoods:
        if all(math.dist([p["x"], p["y"]], [q["x"], q["y"]]) > 100 for q in accepted):
            accepted.append(p)

    labels.sort(key=lambda p: -p["length"])
    street_labels, used_names = [], set()
    for p in labels:
        if p["name"] not in used_names and p["name"].isascii() and len(p["name"]) <= 32:
            street_labels.append(p)
            used_names.add(p["name"])
        if len(street_labels) == 45:
            break

    # A road-following sample, labelled demo in the maker. This is not a routing engine.
    start_place = next((p for p in places if p["name"] == "Thamel"), None)
    end_place = next((p for p in landmarks if p["name"] == "Boudhanath"), None)
    route = None
    if start_place and end_place:
        def nearest(p):
            return min(graph, key=lambda n: math.dist(locations[n], [p["x"], p["y"]]))
        start, end = nearest(start_place), nearest(end_place)
        queue, costs, parent = [(0, start)], {start: 0}, {}
        while queue:
            cost, node = heapq.heappop(queue)
            if node == end:
                chain = [end]
                while chain[-1] != start:
                    chain.append(parent[chain[-1]])
                points = [locations[n] for n in reversed(chain)]
                route = {"id": "demo-thamel-boudha", "name": "Thamel → Boudhanath", "d": path(points),
                         "points": points, "start": points[0], "end": points[-1]}
                break
            if cost != costs.get(node):
                continue
            for nxt, step in graph[node].items():
                new = cost + step
                if new < costs.get(nxt, float("inf")):
                    costs[nxt], parent[nxt] = new, node
                    heapq.heappush(queue, (new, nxt))

    data = {"bounds": BOUNDS, "width": WIDTH, "height": HEIGHT,
            "source": {"attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0",
                       "url": "https://www.openstreetmap.org/copyright",
                       "snapshot": source.get("osm3s", {}).get("timestamp_osm_base", ""),
                       "generated": datetime.datetime.now(datetime.timezone.utc).isoformat()},
            "counts": {"buildings": building_count, "roadSegments": road_count},
            "buildings": [{"id": f"buildings-{x}-{y}", "d": "".join(ds)} for (x, y), ds in sorted(buildings.items())],
            "minorRoads": [{"id": f"{kind}-{x}-{y}", "kind": kind, "d": "".join(ds)} for (kind, x, y), ds in sorted(minor.items())],
            "roads": [{"id": f"road-{i}", "kind": kind, "name": name, "d": "".join(ds)}
                      for i, ((kind, name), ds) in enumerate(sorted(road_groups.items()))],
            "green": green, "water": water, "airport": airport,
            "neighborhoods": accepted, "streetLabels": street_labels, "landmarks": landmarks, "demoRoute": route}
    # Bounds enable cheap viewport culling before parsing a Path2D.
    for layer in ("buildings", "minorRoads", "roads", "green", "water", "airport"):
        for feature in data[layer]:
            coords = [(float(x), float(y)) for x, y in re.findall(r"(-?[\d.]+),(-?[\d.]+)", feature["d"])]
            feature["bounds"] = [min(x for x, _ in coords), min(y for _, y in coords),
                                 max(x for x, _ in coords), max(y for _, y in coords)]
            if layer == "buildings":
                # Relative footprint deltas avoid storing long city-wide coordinates
                # at every corner. Retains the same 0.1-unit precision and geometry.
                compact = []
                for polygon in feature["d"].split("M")[1:]:
                    points = [(float(x), float(y)) for x, y in re.findall(r"(-?[\d.]+),(-?[\d.]+)", polygon)]
                    if len(points) > 2 and points[0] == points[-1]:
                        points.pop()
                    if len(points) < 3:
                        continue
                    start = points[0]
                    deltas = [(round(b[0] - a[0], 1), round(b[1] - a[1], 1)) for a, b in zip(points, points[1:])]
                    compact.append(f"M{start[0]:g},{start[1]:g}l" + " ".join(f"{x:g},{y:g}" for x, y in deltas) + "Z")
                feature["d"] = "".join(compact)
    outdir = ROOT / "src/data"
    detailed = data.pop("buildings")
    def write_gzip(name, content):
        with (outdir / name).open("wb") as file:
            with gzip.GzipFile(fileobj=file, mode="wb", mtime=0, compresslevel=9) as gz:
                gz.write(json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode())
    write_gzip("kathmandu-base.json.gz", data)
    write_gzip("kathmandu-buildings.json.gz", detailed)
    meta = {k: data[k] for k in ("bounds", "width", "height", "source", "counts", "landmarks", "demoRoute")}
    (outdir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(json.dumps({"counts": data["counts"], "landmarks": landmarks, "neighborhoods": len(accepted),
                      "route": bool(route), "bytes": {f.name: f.stat().st_size for f in outdir.glob("*.gz")}}, indent=2))


if __name__ == "__main__":
    main()
