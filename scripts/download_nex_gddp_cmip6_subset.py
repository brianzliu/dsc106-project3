#!/usr/bin/env python3
"""Download Amazon-bounded NEX-GDDP-CMIP6 subsets from NASA NCCS THREDDS.

This helper is for the higher-resolution atmospheric variables available in
NEX-GDDP-CMIP6 (0.25 degree / ~25 km daily data). It is a good fit for the
warming / precipitation / humidity side of the Amazon story, but it is not a
drop-in replacement for native CMIP6 land-carbon variables such as mrsos,
evspsbl, lai, gpp, or nbp.

Examples
--------
Historical GFDL-ESM4 warming + dry-season variables for the Amazon box:

    python3 dsc106-project3/scripts/download_nex_gddp_cmip6_subset.py \
      --model GFDL-ESM4 \
      --scenario historical \
      --years 1995-2014 \
      --variables tas tasmax pr hurs

Future SSP585 subset:

    python3 dsc106-project3/scripts/download_nex_gddp_cmip6_subset.py \
      --model GFDL-ESM4 \
      --scenario ssp585 \
      --years 2040-2059 \
      --variables tas tasmax pr hurs \
      --outdir dsc106-project3/data/nex_gddp_amazon
"""

from __future__ import annotations

import argparse
import csv
import re
import ssl
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

APP_ROOT = Path(__file__).resolve().parents[1]

BASE_URL = "https://ds.nccs.nasa.gov/thredds"
CATALOG_URL = (
    BASE_URL
    + "/catalog/AMES/NEX/GDDP-CMIP6/{model}/{scenario}/{run}/{variable}/catalog.xml"
)
NCSS_URL = (
    BASE_URL
    + "/ncss/grid/AMES/NEX/GDDP-CMIP6/{model}/{scenario}/{run}/{variable}/{filename}"
)
NAMESPACE = {"t": "http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0"}
SUPPORTED_VARIABLES = {
    "hurs",
    "huss",
    "pr",
    "rlds",
    "rsds",
    "sfcWind",
    "tas",
    "tasmax",
    "tasmin",
}
DEFAULT_BOUNDS = {"north": 12.0, "south": -22.0, "west": -82.0, "east": -44.0}


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
        raise ValueError("No years parsed from --years")
    return sorted(years)


def version_key(filename: str) -> tuple[int, ...]:
    match = re.search(r"_v(\d+(?:\.\d+)*)\.nc$", filename)
    if not match:
        return (0,)
    return tuple(int(part) for part in match.group(1).split("."))


def build_ssl_context(insecure: bool) -> ssl.SSLContext:
    if insecure:
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def fetch_text(url: str, *, insecure: bool) -> str:
    request = Request(url, headers={"User-Agent": "dsc106-nex-subset-downloader/1.0"})
    with urlopen(request, context=build_ssl_context(insecure), timeout=60) as response:
        return response.read().decode("utf-8")


def fetch_catalog_filenames(
    model: str,
    scenario: str,
    run: str,
    variable: str,
    *,
    insecure: bool,
) -> list[str]:
    url = CATALOG_URL.format(model=model, scenario=scenario, run=run, variable=variable)
    xml_text = fetch_text(url, insecure=insecure)
    root = ET.fromstring(xml_text)
    filenames = []
    for dataset in root.findall(".//t:dataset", NAMESPACE):
        name = dataset.attrib.get("name", "")
        if name.endswith(".nc"):
            filenames.append(name)
    if not filenames:
        raise RuntimeError(f"No NetCDF files found in catalog: {url}")
    return filenames


def select_filename(filenames: list[str], *, model: str, scenario: str, run: str, variable: str, year: int) -> str:
    pattern = re.compile(
        rf"^{re.escape(variable)}_day_{re.escape(model)}_{re.escape(scenario)}_{re.escape(run)}_"
        rf"[^_]+_{year}(?:_v\d+(?:\.\d+)*)?\.nc$"
    )
    matches = [name for name in filenames if pattern.match(name)]
    if not matches:
        raise RuntimeError(
            f"No matching NEX-GDDP-CMIP6 file found for {model} {scenario} {run} {variable} {year}."
        )
    return sorted(matches, key=version_key)[-1]


def build_subset_url(
    *,
    model: str,
    scenario: str,
    run: str,
    variable: str,
    filename: str,
    north: float,
    south: float,
    west: float,
    east: float,
    include_time: bool,
    year: int,
    accept: str,
) -> str:
    base = NCSS_URL.format(
        model=model,
        scenario=scenario,
        run=run,
        variable=variable,
        filename=filename,
    )
    params = {
        "var": variable,
        "north": north,
        "south": south,
        "west": west,
        "east": east,
        "horizStride": 1,
        "accept": accept,
        "addLatLon": "true",
    }
    if include_time:
        params["time_start"] = f"{year}-01-01T12:00:00Z"
        params["time_end"] = f"{year}-12-31T12:00:00Z"
    return f"{base}?{urlencode(params)}"


def bounds_tag(north: float, south: float, west: float, east: float) -> str:
    return (
        f"amazon_w{abs(west):g}{'W' if west < 0 else 'E'}_"
        f"e{abs(east):g}{'W' if east < 0 else 'E'}_"
        f"s{abs(south):g}{'S' if south < 0 else 'N'}_"
        f"n{abs(north):g}{'N' if north >= 0 else 'S'}"
    ).replace(".", "p")


def download_file(url: str, destination: Path, *, insecure: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "dsc106-nex-subset-downloader/1.0"})
    with urlopen(request, context=build_ssl_context(insecure), timeout=120) as response:
        with destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="GFDL-ESM4")
    parser.add_argument("--scenario", default="historical")
    parser.add_argument("--run", default="r1i1p1f1")
    parser.add_argument(
        "--variables",
        nargs="+",
        default=["tas", "tasmax", "pr", "hurs"],
        help=f"Subset of supported NEX variables: {', '.join(sorted(SUPPORTED_VARIABLES))}",
    )
    parser.add_argument("--years", required=True, help="Comma/range syntax, e.g. 1995-2014 or 2014,2015,2040-2050")
    parser.add_argument("--north", type=float, default=DEFAULT_BOUNDS["north"])
    parser.add_argument("--south", type=float, default=DEFAULT_BOUNDS["south"])
    parser.add_argument("--west", type=float, default=DEFAULT_BOUNDS["west"])
    parser.add_argument("--east", type=float, default=DEFAULT_BOUNDS["east"])
    parser.add_argument("--outdir", default=str(APP_ROOT / "data/nex_gddp_amazon"))
    parser.add_argument("--accept", default="netcdf4", choices=["netcdf4", "netcdf3"])
    parser.add_argument("--no-time-subset", action="store_true", help="Do not append full-year time_start/time_end parameters.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--insecure", action="store_true", help="Disable SSL certificate verification if your local Python trust store is broken.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    unsupported = sorted(set(args.variables) - SUPPORTED_VARIABLES)
    if unsupported:
        print(
            "Unsupported NEX-GDDP-CMIP6 variable(s): "
            + ", ".join(unsupported)
            + f". Supported variables are: {', '.join(sorted(SUPPORTED_VARIABLES))}.",
            file=sys.stderr,
        )
        return 2

    years = parse_years(args.years)
    outdir = Path(args.outdir)
    include_time = not args.no_time_subset
    tag = bounds_tag(args.north, args.south, args.west, args.east)

    manifest_rows: list[dict[str, str]] = []
    catalog_cache: dict[str, list[str]] = {}

    for variable in args.variables:
        cache_key = f"{args.model}|{args.scenario}|{args.run}|{variable}"
        if cache_key not in catalog_cache:
            print(f"Resolving catalog for {args.model} {args.scenario} {variable}...")
            catalog_cache[cache_key] = fetch_catalog_filenames(
                args.model,
                args.scenario,
                args.run,
                variable,
                insecure=args.insecure,
            )

        filenames = catalog_cache[cache_key]
        for year in years:
            filename = select_filename(
                filenames,
                model=args.model,
                scenario=args.scenario,
                run=args.run,
                variable=variable,
                year=year,
            )
            url = build_subset_url(
                model=args.model,
                scenario=args.scenario,
                run=args.run,
                variable=variable,
                filename=filename,
                north=args.north,
                south=args.south,
                west=args.west,
                east=args.east,
                include_time=include_time,
                year=year,
                accept=args.accept,
            )
            output_name = filename.replace(".nc", f"_{tag}.nc")
            output_path = outdir / args.model / args.scenario / variable / output_name

            manifest_rows.append(
                {
                    "model": args.model,
                    "scenario": args.scenario,
                    "run": args.run,
                    "variable": variable,
                    "year": str(year),
                    "remote_filename": filename,
                    "output_path": str(output_path),
                    "url": url,
                }
            )

            if args.dry_run:
                print(url)
                continue

            if output_path.exists() and not args.overwrite:
                print(f"Skipping existing file: {output_path}")
                continue

            print(f"Downloading {variable} {year} -> {output_path}")
            download_file(url, output_path, insecure=args.insecure)

    if not args.dry_run:
        manifest_path = outdir / args.model / args.scenario / "download_manifest.tsv"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with manifest_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "model",
                    "scenario",
                    "run",
                    "variable",
                    "year",
                    "remote_filename",
                    "output_path",
                    "url",
                ],
                delimiter="\t",
            )
            writer.writeheader()
            writer.writerows(manifest_rows)
        print(f"Wrote manifest: {manifest_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
