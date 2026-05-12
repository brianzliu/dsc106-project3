#!/usr/bin/env python3
"""Build an Amazon story-grid JSON from native-grid CESM2 CMIP6 data.

This script pulls actual public CESM2 Zarr chunks over HTTPS from the CMIP6
Google Cloud archive. It does not synthesize or interpolate missing values.

Current default build:
- model: CESM2
- member: r1i1p1f1
- early period: 1850-1869
- late period: 1995-2014
- experiments: historical for both periods

The output matches the frontend schema used by the D3 scrollytelling app.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cftime
import numpy as np
import requests
import urllib3
from numcodecs import get_codec

APP_ROOT = Path(__file__).resolve().parents[1]
CACHE_ROOT = APP_ROOT / ".cache"
CATALOG_CACHE = CACHE_ROOT / "cmip6-zarr-consolidated-stores.csv"
CHUNK_CACHE = CACHE_ROOT / "cmip6_chunks"
CATALOG_URL = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"
DEFAULT_BASE_GRID = APP_ROOT / "public/data/amazon_cmip6_grid.json"
DEFAULT_OUTPUT = APP_ROOT / "public/data/amazon_cmip6_grid.cesm2.json"
DEFAULT_BOUNDS = {"west": -85.0, "east": -30.0, "south": -25.0, "north": 10.0}
DRY_MONTHS = {6, 7, 8, 9, 10}

VARIABLE_SPECS = {
    "tas": {"table": "Amon", "months": None},
    "pr_dry": {"source": "pr", "table": "Amon", "months": DRY_MONTHS},
    "hurs_dry": {"source": "hurs", "table": "Amon", "months": DRY_MONTHS},
    "evspsbl": {"table": "Amon", "months": None},
    "mrsos_dry": {"source": "mrsos", "table": "Lmon", "months": DRY_MONTHS},
    "lai": {"table": "Lmon", "months": None},
    "gpp": {"table": "Lmon", "months": None},
    "nbp": {"table": "Lmon", "months": None},
    "fracLut": {"table": "Eyr", "months": None},
}


def parse_years(spec: str) -> list[int]:
    years: set[int] = set()
    for chunk in spec.split(","):
        token = chunk.strip()
        if not token:
            continue
        if "-" in token:
            start_str, end_str = token.split("-", 1)
            start = int(start_str)
            end = int(end_str)
            if end < start:
                raise ValueError(f"Invalid year range: {token}")
            years.update(range(start, end + 1))
        else:
            years.add(int(token))
    if not years:
        raise ValueError("No years parsed.")
    return sorted(years)


def rounded(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def normalize_lon(values: np.ndarray) -> np.ndarray:
    return ((values + 180.0) % 360.0) - 180.0


def geometry_bounds(geometry: dict) -> tuple[float, float, float, float]:
    if geometry["type"] == "Polygon":
        rings = geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        rings = [ring for polygon in geometry["coordinates"] for ring in polygon]
    else:
        raise ValueError(f"Unsupported geometry type: {geometry['type']}")

    xs = []
    ys = []
    for ring in rings:
        for lon, lat in ring:
            xs.append(float(lon))
            ys.append(float(lat))
    return min(xs), min(ys), max(xs), max(ys)


def gs_to_https(zstore: str) -> str:
    if not zstore.startswith("gs://"):
        raise ValueError(f"Unsupported zstore path: {zstore}")
    return "https://storage.googleapis.com/" + zstore.removeprefix("gs://").strip("/")


def read_catalog_text(session: requests.Session, path: Path | None, *, refresh: bool) -> str:
    if path and path.exists() and not refresh:
        return path.read_text()
    if CATALOG_CACHE.exists() and not refresh:
        return CATALOG_CACHE.read_text()

    response = session.get(CATALOG_URL, timeout=180)
    response.raise_for_status()
    text = response.text
    CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_CACHE.write_text(text)
    if path and path != CATALOG_CACHE:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return text


def load_catalog_rows(session: requests.Session, path: Path | None, *, refresh: bool) -> list[dict[str, str]]:
    text = read_catalog_text(session, path, refresh=refresh)
    return list(csv.DictReader(io.StringIO(text)))


def lookup_store(
    rows: Iterable[dict[str, str]],
    *,
    model: str,
    experiment: str,
    member: str,
    table: str,
    variable: str,
) -> str:
    matches = [
        row["zstore"]
        for row in rows
        if row.get("source_id") == model
        and row.get("experiment_id") == experiment
        and row.get("member_id") == member
        and row.get("table_id") == table
        and row.get("variable_id") == variable
        and row.get("grid_label") == "gn"
    ]
    if not matches:
        raise FileNotFoundError(
            f"Missing public CMIP6 Zarr store for {model} {experiment} {member} {table} {variable} gn."
        )
    return matches[0]


@dataclass
class RemoteZarrArray:
    session: requests.Session
    base_url: str
    name: str
    shape: tuple[int, ...]
    chunks: tuple[int, ...]
    dtype: np.dtype
    compressor_config: dict | None
    fill_value: object
    attrs: dict

    def __post_init__(self) -> None:
        self.codec = get_codec(self.compressor_config) if self.compressor_config else None

    def cache_path(self, chunk_index: tuple[int, ...]) -> Path:
        rel = self.base_url.replace("https://", "").replace("/", "__")
        chunk_name = ".".join(str(part) for part in chunk_index) + ".bin"
        return CHUNK_CACHE / rel / self.name / chunk_name

    def chunk_shape(self, chunk_index: tuple[int, ...]) -> tuple[int, ...]:
        shape = []
        for axis, start_index in enumerate(chunk_index):
            start = start_index * self.chunks[axis]
            remaining = self.shape[axis] - start
            shape.append(min(self.chunks[axis], remaining))
        return tuple(shape)

    def fetch_chunk(self, chunk_index: tuple[int, ...]) -> np.ndarray:
        path = self.cache_path(chunk_index)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            raw = path.read_bytes()
        else:
            url = f"{self.base_url}/{self.name}/" + ".".join(str(part) for part in chunk_index)
            response = self.session.get(url, timeout=180)
            response.raise_for_status()
            raw = response.content
            path.write_bytes(raw)

        decoded = self.codec.decode(raw) if self.codec else raw
        flat = np.frombuffer(decoded, dtype=self.dtype)
        actual_shape = self.chunk_shape(chunk_index)
        nominal_size = int(np.prod(self.chunks))
        actual_size = int(np.prod(actual_shape))

        if flat.size == actual_size:
            return flat.reshape(actual_shape).copy()
        if flat.size == nominal_size:
            nominal = flat.reshape(self.chunks)
            slices = tuple(slice(0, size) for size in actual_shape)
            return nominal[slices].copy()
        raise ValueError(
            f"Unexpected decoded chunk size for {self.name} {chunk_index}: "
            f"{flat.size} elements, expected {actual_size} or {nominal_size}."
        )


class RemoteZarrStore:
    def __init__(self, session: requests.Session, base_url: str) -> None:
        self.session = session
        self.base_url = base_url.rstrip("/")
        response = session.get(f"{self.base_url}/.zmetadata", timeout=180)
        response.raise_for_status()
        payload = response.json()
        self.metadata = payload["metadata"]

    def array(self, name: str) -> RemoteZarrArray:
        zarray = self.metadata[f"{name}/.zarray"]
        zattrs = self.metadata.get(f"{name}/.zattrs", {})
        return RemoteZarrArray(
            session=self.session,
            base_url=self.base_url,
            name=name,
            shape=tuple(zarray["shape"]),
            chunks=tuple(zarray["chunks"]),
            dtype=np.dtype(zarray["dtype"]),
            compressor_config=zarray.get("compressor"),
            fill_value=zarray.get("fill_value"),
            attrs=zattrs,
        )


def read_full_array(array: RemoteZarrArray) -> np.ndarray:
    zeros = (0,) * len(array.shape)
    return array.fetch_chunk(zeros)


def mask_invalid(array: np.ndarray, spec: RemoteZarrArray) -> np.ndarray:
    if array.dtype.kind not in "fiu":
        return array
    out = array.astype("float64", copy=False)
    candidates = [
        spec.fill_value,
        spec.attrs.get("_FillValue"),
        spec.attrs.get("missing_value"),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        try:
            numeric = float(candidate)
        except (TypeError, ValueError):
            continue
        if math.isfinite(numeric):
            out = np.where(out == numeric, np.nan, out)
    out = np.where(np.isfinite(out), out, np.nan)
    out = np.where(out > 1e19, np.nan, out)
    out = np.where(out < -1e19, np.nan, out)
    return out


def decode_times(time_array: RemoteZarrArray) -> list[cftime.datetime]:
    values = mask_invalid(read_full_array(time_array), time_array)
    units = time_array.attrs.get("units")
    if not units:
        raise ValueError("Missing time units in Zarr metadata.")
    calendar = time_array.attrs.get("calendar", "standard")
    return list(cftime.num2date(values, units=units, calendar=calendar))


def select_time_indices(dates: list[cftime.datetime], years: set[int], months: set[int] | None = None) -> list[int]:
    indices = []
    for index, dt in enumerate(dates):
        if int(dt.year) not in years:
            continue
        if months is not None and int(dt.month) not in months:
            continue
        indices.append(index)
    if not indices:
        raise ValueError(f"No time indices found for years={sorted(years)} months={sorted(months) if months else None}.")
    return indices


def group_indices_by_chunk(indices: list[int], chunk_size: int) -> dict[int, list[int]]:
    groups: dict[int, list[int]] = defaultdict(list)
    for index in indices:
        groups[index // chunk_size].append(index % chunk_size)
    return dict(groups)


def variable_multiplier(variable: str, units: str | None) -> float:
    normalized = (units or "").replace(" ", "").lower()
    if variable in {"pr", "evspsbl"} and ("kgm-2s-1" in normalized or "kg/m2/s" in normalized):
        return 86400.0
    if variable in {"gpp", "nbp"} and ("kgm-2s-1" in normalized or "kg/m2/s" in normalized):
        return 86400.0 * 1000.0
    return 1.0


def temperature_offset(variable: str, units: str | None) -> float:
    normalized = (units or "").strip()
    if variable == "tas" and normalized.upper() == "K":
        return -273.15
    return 0.0


def period_mean(
    array: RemoteZarrArray,
    *,
    indices: list[int],
    component_index: int | None = None,
    variable: str,
) -> np.ndarray:
    groups = group_indices_by_chunk(indices, array.chunks[0])
    sum_grid = None
    count_grid = None

    for chunk_number, local_indices in sorted(groups.items()):
        chunk_index = (chunk_number,) + (0,) * (len(array.shape) - 1)
        chunk = mask_invalid(array.fetch_chunk(chunk_index), array)
        if component_index is not None:
            chunk = chunk[:, component_index, :, :]
        subset = chunk[local_indices]
        if subset.size == 0:
            continue

        multiplier = variable_multiplier(variable, array.attrs.get("units"))
        offset = temperature_offset(variable, array.attrs.get("units"))
        if multiplier != 1.0:
            subset = subset * multiplier
        if offset != 0.0:
            subset = subset + offset

        finite = np.isfinite(subset)
        local_sum = np.where(finite, subset, 0.0).sum(axis=0)
        local_count = finite.sum(axis=0)
        if sum_grid is None:
            sum_grid = local_sum
            count_grid = local_count
        else:
            sum_grid += local_sum
            count_grid += local_count

    if sum_grid is None or count_grid is None:
        raise RuntimeError(f"No valid values found for {array.name}.")
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count_grid > 0, sum_grid / count_grid, np.nan)


def load_base_rows(path: Path) -> tuple[list[dict], list[tuple[float, float, float, float]], np.ndarray, list[str]]:
    rows = json.loads(path.read_text())
    filtered = [row for row in rows if row.get("geometry") and row.get("lat") is not None and row.get("lon") is not None]
    boxes = [geometry_bounds(row["geometry"]) for row in filtered]
    centers = np.array([[float(row["lat"]), float(row["lon"])] for row in filtered], dtype="float64")
    regions = [row.get("region", "other") for row in filtered]
    return filtered, boxes, centers, regions


def in_base_mask(lat: float, lon: float, boxes: list[tuple[float, float, float, float]]) -> bool:
    for min_lon, min_lat, max_lon, max_lat in boxes:
        if min_lon - 1e-9 <= lon <= max_lon + 1e-9 and min_lat - 1e-9 <= lat <= max_lat + 1e-9:
            return True
    return False


def nearest_region(lat: float, lon: float, centers: np.ndarray, regions: list[str]) -> str:
    distances = (centers[:, 0] - lat) ** 2 + (centers[:, 1] - lon) ** 2
    return regions[int(np.argmin(distances))]


def polygon_geometry(lat_bounds: np.ndarray, lon_bounds: np.ndarray) -> dict:
    south = float(np.min(lat_bounds))
    north = float(np.max(lat_bounds))
    west = float(np.min(normalize_lon(np.asarray(lon_bounds, dtype="float64"))))
    east = float(np.max(normalize_lon(np.asarray(lon_bounds, dtype="float64"))))
    return {
        "type": "Polygon",
        "coordinates": [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
        ]],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="CESM2")
    parser.add_argument("--member", default="r1i1p1f1")
    parser.add_argument("--early-experiment", default="historical")
    parser.add_argument("--late-experiment", default="historical")
    parser.add_argument("--early-years", default="1850-1869")
    parser.add_argument("--late-years", default="1995-2014")
    parser.add_argument("--west", type=float, default=DEFAULT_BOUNDS["west"])
    parser.add_argument("--east", type=float, default=DEFAULT_BOUNDS["east"])
    parser.add_argument("--south", type=float, default=DEFAULT_BOUNDS["south"])
    parser.add_argument("--north", type=float, default=DEFAULT_BOUNDS["north"])
    parser.add_argument("--base-grid", default=str(DEFAULT_BASE_GRID))
    parser.add_argument("--catalog-path", default=None, help="Optional local path to the CMIP6 Zarr catalog CSV.")
    parser.add_argument("--refresh-catalog", action="store_true")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--insecure", action="store_true", help="Disable SSL certificate verification for local Python setups with broken trust stores.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.insecure:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    output_path = Path(args.output)
    if output_path.exists() and not args.overwrite:
        raise FileExistsError(f"{output_path} already exists. Pass --overwrite to replace it.")

    session = requests.Session()
    session.verify = not args.insecure
    session.headers.update({"User-Agent": "dsc106-cesm2-builder/1.0"})

    catalog_rows = load_catalog_rows(
        session,
        Path(args.catalog_path) if args.catalog_path else None,
        refresh=args.refresh_catalog,
    )

    early_years = set(parse_years(args.early_years))
    late_years = set(parse_years(args.late_years))
    base_rows, base_boxes, base_centers, base_regions = load_base_rows(Path(args.base_grid))

    stores: dict[str, dict[str, str]] = {"early": {}, "late": {}}
    data_keys = [key for key in VARIABLE_SPECS if key != "fracLut"]
    for phase, experiment in [("early", args.early_experiment), ("late", args.late_experiment)]:
        for key, spec in VARIABLE_SPECS.items():
            source = spec.get("source", key)
            stores[phase][key] = lookup_store(
                catalog_rows,
                model=args.model,
                experiment=experiment,
                member=args.member,
                table=spec["table"],
                variable=source,
            )

    if args.dry_run:
        print(json.dumps(stores, indent=2))
        return 0

    tas_store = RemoteZarrStore(session, gs_to_https(stores["early"]["tas"]))
    lat_array = tas_store.array("lat")
    lon_array = tas_store.array("lon")
    lat_values = read_full_array(lat_array).astype("float64")
    lon_values_raw = read_full_array(lon_array).astype("float64")
    lon_values = normalize_lon(lon_values_raw)
    lat_bounds = read_full_array(tas_store.array("lat_bnds")).astype("float64")
    lon_bounds = read_full_array(tas_store.array("lon_bnds")).astype("float64")

    lat_indices = [i for i, value in enumerate(lat_values) if args.south <= float(value) <= args.north]
    lon_indices = [j for j, value in enumerate(lon_values) if args.west <= float(value) <= args.east]

    early_fields: dict[str, np.ndarray] = {}
    late_fields: dict[str, np.ndarray] = {}
    sources_meta: dict[str, dict[str, str]] = {}

    for key in data_keys:
        spec = VARIABLE_SPECS[key]
        source_name = spec.get("source", key)
        months = spec["months"]

        early_store = RemoteZarrStore(session, gs_to_https(stores["early"][key]))
        early_time = decode_times(early_store.array("time"))
        early_indices = select_time_indices(early_time, early_years, months)
        early_fields[key] = period_mean(
            early_store.array(source_name),
            indices=early_indices,
            variable=source_name,
        )

        late_store = RemoteZarrStore(session, gs_to_https(stores["late"][key]))
        late_time = decode_times(late_store.array("time"))
        late_indices = select_time_indices(late_time, late_years, months)
        late_fields[key] = period_mean(
            late_store.array(source_name),
            indices=late_indices,
            variable=source_name,
        )

        sources_meta[key] = {
            "source_variable": source_name,
            "early_store": stores["early"][key],
            "late_store": stores["late"][key],
        }

    frac_fields: dict[str, np.ndarray] = {}
    for phase, experiment, years in [
        ("early", args.early_experiment, early_years),
        ("late", args.late_experiment, late_years),
    ]:
        store = RemoteZarrStore(session, gs_to_https(stores[phase]["fracLut"]))
        dates = decode_times(store.array("time"))
        indices = select_time_indices(dates, years)
        frac_fields[phase] = period_mean(
            store.array("fracLut"),
            indices=indices,
            component_index=None,
            variable="fracLut",
        )
    sources_meta["fracLut"] = {
        "early_store": stores["early"]["fracLut"],
        "late_store": stores["late"]["fracLut"],
        "requested": "primary_and_secondary_land=0, pastures=1, crops=2, urban=3",
    }

    rows: list[dict] = []
    for lat_index in lat_indices:
        lat_value = float(lat_values[lat_index])
        for lon_index in lon_indices:
            lon_value = float(lon_values[lon_index])
            if not in_base_mask(lat_value, lon_value, base_boxes):
                continue

            geometry = polygon_geometry(lat_bounds[lat_index], lon_bounds[lon_index])
            region = nearest_region(lat_value, lon_value, base_centers, base_regions)

            crop_early = float(frac_fields["early"][2, lat_index, lon_index])
            crop_late = float(frac_fields["late"][2, lat_index, lon_index])
            pasture_early = float(frac_fields["early"][1, lat_index, lon_index])
            pasture_late = float(frac_fields["late"][1, lat_index, lon_index])

            def field_value(name: str, phase: str) -> float | None:
                value = float((early_fields if phase == "early" else late_fields)[name][lat_index, lon_index])
                return None if not math.isfinite(value) else value

            tas_early = field_value("tas", "early")
            tas_late = field_value("tas", "late")
            pr_early = field_value("pr_dry", "early")
            pr_late = field_value("pr_dry", "late")
            hurs_early = field_value("hurs_dry", "early")
            hurs_late = field_value("hurs_dry", "late")
            evap_early = field_value("evspsbl", "early")
            evap_late = field_value("evspsbl", "late")
            mrsos_early = field_value("mrsos_dry", "early")
            mrsos_late = field_value("mrsos_dry", "late")
            lai_early = field_value("lai", "early")
            lai_late = field_value("lai", "late")
            gpp_early = field_value("gpp", "early")
            gpp_late = field_value("gpp", "late")
            nbp_early = field_value("nbp", "early")
            nbp_late = field_value("nbp", "late")

            row = {
                "cell_id": f"cesm2-{lat_index}-{lon_index}",
                "lat": rounded(lat_value),
                "lon": rounded(lon_value),
                "geometry": geometry,
                "region": region,
                "crop_early": rounded(crop_early),
                "crop_late": rounded(crop_late),
                "crop_change": rounded(crop_late - crop_early),
                "pasture_early": rounded(pasture_early),
                "pasture_late": rounded(pasture_late),
                "pasture_change": rounded(pasture_late - pasture_early),
                "land_conversion_change": rounded((crop_late - crop_early) + (pasture_late - pasture_early)),
                "tas_early": rounded(tas_early),
                "tas_late": rounded(tas_late),
                "tas_change": rounded(None if tas_early is None or tas_late is None else tas_late - tas_early),
                "tasmax_early": None,
                "tasmax_late": None,
                "tasmax_change": None,
                "pr_dry_early": rounded(pr_early),
                "pr_dry_late": rounded(pr_late),
                "pr_dry_change": rounded(None if pr_early is None or pr_late is None else pr_late - pr_early),
                "mrsos_dry_early": rounded(mrsos_early),
                "mrsos_dry_late": rounded(mrsos_late),
                "mrsos_dry_change": rounded(None if mrsos_early is None or mrsos_late is None else mrsos_late - mrsos_early),
                "hurs_dry_early": rounded(hurs_early),
                "hurs_dry_late": rounded(hurs_late),
                "hurs_dry_change": rounded(None if hurs_early is None or hurs_late is None else hurs_late - hurs_early),
                "evspsbl_early": rounded(evap_early),
                "evspsbl_late": rounded(evap_late),
                "evspsbl_change": rounded(None if evap_early is None or evap_late is None else evap_late - evap_early),
                "lai_early": rounded(lai_early),
                "lai_late": rounded(lai_late),
                "lai_change": rounded(None if lai_early is None or lai_late is None else lai_late - lai_early),
                "gpp_early": rounded(gpp_early),
                "gpp_late": rounded(gpp_late),
                "gpp_change": rounded(None if gpp_early is None or gpp_late is None else gpp_late - gpp_early),
                "nbp_early": rounded(nbp_early),
                "nbp_late": rounded(nbp_late),
                "nbp_change": rounded(None if nbp_early is None or nbp_late is None else nbp_late - nbp_early),
                "warming_score": None,
                "dryness_score": None,
                "climate_stress_score": None,
                "productivity_response_score": None,
                "carbon_fragility_score": None,
            }
            rows.append(row)

    rows.sort(key=lambda row: (row["lat"], row["lon"]))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(rows, indent=2))

    metadata = {
        "dataset": "CESM2 native-grid historical comparison",
        "model": args.model,
        "member": args.member,
        "early_experiment": args.early_experiment,
        "late_experiment": args.late_experiment,
        "early_years": sorted(early_years),
        "late_years": sorted(late_years),
        "bbox": {
            "west": args.west,
            "east": args.east,
            "south": args.south,
            "north": args.north,
        },
        "dry_months": sorted(DRY_MONTHS),
        "notes": [
            "No synthetic fill values were used.",
            "tasmax fields are null because native-grid CESM2 historical public monthly tasmax was not found in the public Zarr archive used here.",
            "pr and evspsbl were converted from kg m-2 s-1 to mm/day.",
            "gpp and nbp were converted from kg m-2 s-1 to gC m-2 day-1.",
            "tas means were converted from K to degC.",
            "The Amazon mask follows the existing app grid footprint.",
        ],
        "sources": sources_meta,
    }
    meta_path = output_path.with_suffix(output_path.suffix + ".meta.json")
    meta_path.write_text(json.dumps(metadata, indent=2))

    print(f"Wrote CESM2 grid: {output_path}")
    print(f"Wrote metadata: {meta_path}")
    print(f"Rows: {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
