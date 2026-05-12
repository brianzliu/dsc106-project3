#!/usr/bin/env python3
"""Build a hybrid Amazon grid JSON for the D3 app.

This script keeps the existing coarse CMIP6 land / carbon fields from
`amazon_cmip6_grid.json`, but replaces or fills the atmospheric fields with
finer NEX-GDDP-CMIP6 data aggregated back onto each coarse cell:

- `tas_*`
- `tasmax_*`
- `pr_dry_*`
- `hurs_dry_*`

The result preserves the frontend schema while letting the warming and
dry-season stress fields come from a finer 0.25 degree product.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import netCDF4
import numpy as np

APP_ROOT = Path(__file__).resolve().parents[1]


VARIABLE_CONFIG = {
    "tas": {"output_prefix": "tas", "months": None},
    "tasmax": {"output_prefix": "tasmax", "months": None},
    "pr": {"output_prefix": "pr_dry", "months": [6, 7, 8, 9, 10]},
    "hurs": {"output_prefix": "hurs_dry", "months": [6, 7, 8, 9, 10]},
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


def year_from_filename(path: Path) -> int | None:
    match = re.search(r"_(\d{4})(?:_v\d+(?:\.\d+)*)?_[^/]+\.nc$|_(\d{4})(?:_v\d+(?:\.\d+)*)?\.nc$", path.name)
    if not match:
        return None
    for group in match.groups():
        if group:
            return int(group)
    return None


def collect_year_files(root: Path, variable: str, years: list[int]) -> list[Path]:
    variable_dir = root / variable
    if not variable_dir.exists():
        raise FileNotFoundError(f"Missing variable directory: {variable_dir}")

    wanted = set(years)
    chosen: dict[int, Path] = {}
    for path in sorted(variable_dir.glob("*.nc")):
        year = year_from_filename(path)
        if year in wanted:
            chosen[year] = path

    missing = sorted(wanted - set(chosen))
    if missing:
        raise FileNotFoundError(
            f"Missing {variable} files for years {missing} under {variable_dir}"
        )
    return [chosen[year] for year in years]


def read_lon_lat(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with netCDF4.Dataset(path) as ds:
        lon = normalize_lon(np.asarray(ds.variables["lon"][:], dtype=float))
        lat = np.asarray(ds.variables["lat"][:], dtype=float)
    return lon, lat


def ensure_same_grid(reference: tuple[np.ndarray, np.ndarray] | None, path: Path) -> tuple[np.ndarray, np.ndarray]:
    lon, lat = read_lon_lat(path)
    if reference is None:
        return lon, lat

    ref_lon, ref_lat = reference
    if ref_lon.shape != lon.shape or ref_lat.shape != lat.shape:
        raise ValueError(f"NEX grid shape mismatch in {path}")
    if not np.allclose(ref_lon, lon) or not np.allclose(ref_lat, lat):
        raise ValueError(f"NEX grid coordinate mismatch in {path}")
    return reference


def variable_scale(variable: str, units: str | None) -> float:
    if variable != "pr" or not units:
        return 1.0
    normalized = units.replace(" ", "").lower()
    if "kgm-2s-1" in normalized or "kgm**-2s**-1" in normalized or "kg/m2/s" in normalized:
        return 86400.0
    return 1.0


def compute_period_mean(files: list[Path], variable: str, months: list[int] | None) -> np.ndarray:
    sum_grid = None
    count_grid = None

    for path in files:
        with netCDF4.Dataset(path) as ds:
            values = ds.variables[variable]
            time = ds.variables["time"]
            dates = netCDF4.num2date(
                time[:],
                units=time.units,
                calendar=getattr(time, "calendar", "standard"),
                only_use_cftime_datetimes=False,
            )
            indices = [
                idx for idx, dt in enumerate(dates)
                if months is None or int(dt.month) in months
            ]
            if not indices:
                continue

            data = np.asarray(values[indices, :, :], dtype=float)
            scale = variable_scale(variable, getattr(values, "units", None))
            if scale != 1.0:
                data = data * scale

            finite = np.isfinite(data)
            local_sum = np.where(finite, data, 0.0).sum(axis=0)
            local_count = finite.sum(axis=0)

            if sum_grid is None:
                sum_grid = local_sum
                count_grid = local_count
            else:
                sum_grid += local_sum
                count_grid += local_count

    if sum_grid is None or count_grid is None:
        raise RuntimeError(f"No valid {variable} data found for requested months.")

    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count_grid > 0, sum_grid / count_grid, np.nan)


@dataclass
class FineToCoarseMapper:
    lon2d: np.ndarray
    lat2d: np.ndarray
    masks: list[np.ndarray]

    @classmethod
    def from_rows(cls, rows: list[dict], fine_lon: np.ndarray, fine_lat: np.ndarray) -> "FineToCoarseMapper":
        lon2d, lat2d = np.meshgrid(fine_lon, fine_lat)
        masks = []
        for row in rows:
            min_lon, min_lat, max_lon, max_lat = geometry_bounds(row["geometry"])
            mask = (
                (lon2d >= min_lon - 1e-9)
                & (lon2d <= max_lon + 1e-9)
                & (lat2d >= min_lat - 1e-9)
                & (lat2d <= max_lat + 1e-9)
            )
            masks.append(mask)
        return cls(lon2d=lon2d, lat2d=lat2d, masks=masks)

    def aggregate(self, field: np.ndarray) -> list[float | None]:
        result: list[float | None] = []
        for mask in self.masks:
            values = field[mask]
            finite = values[np.isfinite(values)]
            result.append(float(finite.mean()) if finite.size else None)
        return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-grid",
        default=str(APP_ROOT / "public/data/amazon_cmip6_grid.json"),
        help="Existing coarse app JSON to use as the hybrid template.",
    )
    parser.add_argument(
        "--early-root",
        required=True,
        help="Directory containing NEX variable folders for the early period, e.g. .../GFDL-ESM4/historical",
    )
    parser.add_argument(
        "--late-root",
        required=True,
        help="Directory containing NEX variable folders for the late period, e.g. .../GFDL-ESM4/ssp585",
    )
    parser.add_argument("--early-years", required=True, help="Year list/range, e.g. 1995-2004")
    parser.add_argument("--late-years", required=True, help="Year list/range, e.g. 2040-2059")
    parser.add_argument(
        "--variables",
        nargs="+",
        default=["tas", "tasmax", "pr", "hurs"],
        choices=sorted(VARIABLE_CONFIG.keys()),
    )
    parser.add_argument(
        "--dry-months",
        nargs="+",
        type=int,
        default=[6, 7, 8, 9, 10],
        help="Months used for dry-season variables such as pr and hurs.",
    )
    parser.add_argument(
        "--output",
        default=str(APP_ROOT / "public/data/amazon_cmip6_grid.hybrid.json"),
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    base_path = Path(args.base_grid)
    rows = json.loads(base_path.read_text())
    early_root = Path(args.early_root)
    late_root = Path(args.late_root)
    early_years = parse_years(args.early_years)
    late_years = parse_years(args.late_years)

    reference_grid = None
    mapper = None
    provenance: dict[str, object] = {
        "base_grid": str(base_path),
        "early_root": str(early_root),
        "late_root": str(late_root),
        "early_years": early_years,
        "late_years": late_years,
        "dry_months": args.dry_months,
        "variables": args.variables,
        "notes": [
            "Fine atmospheric variables are aggregated from NEX-GDDP-CMIP6 onto the coarse CMIP6 story grid.",
            "Coarse land conversion and carbon-response fields are preserved from the base grid JSON.",
            "pr is converted to mm/day when source units are kg m-2 s-1.",
        ],
    }

    for variable in args.variables:
        config = dict(VARIABLE_CONFIG[variable])
        if variable in {"pr", "hurs"}:
            config["months"] = args.dry_months

        early_files = collect_year_files(early_root, variable, early_years)
        late_files = collect_year_files(late_root, variable, late_years)

        for path in early_files + late_files:
            reference_grid = ensure_same_grid(reference_grid, path)

        if mapper is None:
            fine_lon, fine_lat = reference_grid
            mapper = FineToCoarseMapper.from_rows(rows, fine_lon, fine_lat)

        early_field = compute_period_mean(early_files, variable, config["months"])
        late_field = compute_period_mean(late_files, variable, config["months"])

        early_values = mapper.aggregate(early_field)
        late_values = mapper.aggregate(late_field)
        prefix = config["output_prefix"]

        for row, early_value, late_value in zip(rows, early_values, late_values):
            row[f"{prefix}_early"] = rounded(early_value, 4)
            row[f"{prefix}_late"] = rounded(late_value, 4)
            change = None
            if early_value is not None and late_value is not None:
                change = late_value - early_value
            row[f"{prefix}_change"] = rounded(change, 4)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(rows, separators=(",", ":")))

    meta_path = output_path.with_suffix(output_path.suffix + ".meta.json")
    meta_path.write_text(json.dumps(provenance, indent=2))

    print(f"Wrote hybrid grid: {output_path}")
    print(f"Wrote provenance: {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
