#!/usr/bin/env python3
"""Build a real annual CESM2 Amazon NBP timeline for the opening playback map.

This reads native-grid CESM2 monthly `nbp` from the public CMIP6 Zarr archive
and writes a compact per-cell annual timeline JSON for the frontend.
No interpolation or synthetic in-between years are created.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import requests
import urllib3

from build_cesm2_native_grid import (
    CATALOG_CACHE,
    RemoteZarrStore,
    decode_times,
    gs_to_https,
    in_base_mask,
    load_base_rows,
    load_catalog_rows,
    lookup_store,
    mask_invalid,
    normalize_lon,
    parse_years,
    read_full_array,
    rounded,
    variable_multiplier,
)

APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_GRID = APP_ROOT / "public/data/amazon_cmip6_grid.cesm2.json"
DEFAULT_OUTPUT = APP_ROOT / "public/data/amazon_nbp_timeline.cesm2.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="CESM2")
    parser.add_argument("--member", default="r1i1p1f1")
    parser.add_argument("--experiment", default="historical")
    parser.add_argument("--years", default="1850-2014")
    parser.add_argument("--base-grid", default=str(DEFAULT_BASE_GRID))
    parser.add_argument("--catalog-path", default=str(CATALOG_CACHE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--refresh-catalog", action="store_true")
    parser.add_argument("--insecure", action="store_true")
    return parser


def annual_means(array, dates, years):
    chunk_size = array.chunks[0]
    multiplier = variable_multiplier("nbp", array.attrs.get("units"))
    sums = {year: None for year in years}
    counts = {year: None for year in years}

    year_to_indices = {}
    for year in years:
      year_to_indices[year] = [index for index, dt in enumerate(dates) if int(dt.year) == year]

    needed_indices = [index for indices in year_to_indices.values() for index in indices]
    if not needed_indices:
        raise ValueError("No time indices found for requested years.")

    needed_chunks = sorted({index // chunk_size for index in needed_indices})

    for chunk_number in needed_chunks:
        chunk_index = (chunk_number,) + (0,) * (len(array.shape) - 1)
        chunk = mask_invalid(array.fetch_chunk(chunk_index), array)
        if multiplier != 1.0:
            chunk = chunk * multiplier

        start = chunk_number * chunk_size
        for local_index in range(chunk.shape[0]):
            global_index = start + local_index
            if global_index >= len(dates):
                break
            year = int(dates[global_index].year)
            if year not in year_to_indices:
                continue
            grid = chunk[local_index]
            finite = np.isfinite(grid)
            local_sum = np.where(finite, grid, 0.0)
            local_count = finite.astype("int16")
            if sums[year] is None:
                sums[year] = local_sum
                counts[year] = local_count
            else:
                sums[year] += local_sum
                counts[year] += local_count

    means = {}
    for year in years:
        if sums[year] is None or counts[year] is None:
            means[year] = None
            continue
        with np.errstate(invalid="ignore", divide="ignore"):
            means[year] = np.where(counts[year] > 0, sums[year] / counts[year], np.nan)
    return means


def main() -> int:
    args = build_parser().parse_args()
    if args.insecure:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    output_path = Path(args.output)
    if output_path.exists() and not args.overwrite:
        raise FileExistsError(f"{output_path} already exists. Pass --overwrite to replace it.")

    years = parse_years(args.years)
    session = requests.Session()
    session.verify = not args.insecure
    session.headers.update({"User-Agent": "dsc106-cesm2-nbp-timeline/1.0"})

    catalog_rows = load_catalog_rows(
        session,
        Path(args.catalog_path) if args.catalog_path else None,
        refresh=args.refresh_catalog,
    )

    zstore = lookup_store(
        catalog_rows,
        model=args.model,
        experiment=args.experiment,
        member=args.member,
        table="Lmon",
        variable="nbp",
    )

    base_rows, base_boxes, _, _ = load_base_rows(Path(args.base_grid))
    store = RemoteZarrStore(session, gs_to_https(zstore))
    lat_array = store.array("lat")
    lon_array = store.array("lon")
    lat_values = read_full_array(lat_array).astype("float64")
    lon_values = normalize_lon(read_full_array(lon_array).astype("float64"))
    dates = decode_times(store.array("time"))
    annual_fields = annual_means(store.array("nbp"), dates, years)

    cells = []
    for row in base_rows:
        lat = float(row["lat"])
        lon = float(row["lon"])
        lat_matches = np.where(np.isclose(lat_values, lat))[0]
        lon_matches = np.where(np.isclose(lon_values, lon))[0]
        if not len(lat_matches) or not len(lon_matches):
            continue
        lat_index = int(lat_matches[0])
        lon_index = int(lon_matches[0])
        if not in_base_mask(lat, lon, base_boxes):
            continue

        values = []
        for year in years:
            field = annual_fields[year]
            if field is None:
                values.append(None)
                continue
            value = float(field[lat_index, lon_index])
            values.append(None if not math.isfinite(value) else rounded(value, 4))

        cells.append({
            "cell_id": row["cell_id"],
            "values": values,
        })

    payload = {
        "dataset": "CESM2 annual Amazon NBP timeline",
        "model": args.model,
        "member": args.member,
        "experiment": args.experiment,
        "metric": "nbp",
        "years": years,
        "cells": cells,
        "notes": [
            "Annual values are derived from real monthly CESM2 native-grid nbp.",
            "No interpolation or synthetic in-between years were created."
        ],
        "source_store": zstore,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload))
    print(f"Wrote {output_path}")
    print(f"Years: {years[0]}-{years[-1]}")
    print(f"Cells: {len(cells)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
