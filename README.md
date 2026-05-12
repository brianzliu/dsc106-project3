# Amazon Climate-Stress Scrollytelling

This project implements an interactive D3 v7 scrollytelling visualization about Amazon land conversion, dry-season warming, moisture stress, vegetation response, and carbon-sink fragility using preprocessed CMIP6 grid data.

The scientific framing is inspired by Gatti et al. 2021, **“Amazonia as a carbon source linked to deforestation and climate change.”** The story intentionally focuses on the climate-stress mechanism emphasized by the paper: land conversion and deforestation are associated with hotter and drier regional conditions, especially in the dry season, and those stresses can weaken vegetation function and carbon uptake.

> Methods caveat: This visualization is inspired by Gatti et al. 2021 and uses CMIP6 gridded variables to explore related land-climate-carbon patterns. It does not reproduce the paper’s aircraft CO2 flux estimates.

## How to run locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

The app prefers `public/data/amazon_cmip6_grid.cesm2.json` when present, then falls back to `public/data/amazon_cmip6_grid.hybrid.json`, `public/data/amazon_cmip6_grid.json`, and finally `public/data/amazon_cmip6_grid.sample.json`.

## Vercel deployment

This repo is ready to deploy on Vercel as a Vite app:

- Framework Preset: `Vite`
- Root Directory: `.`
- Build Command: `npm run build`
- Output Directory: `dist`

The repo includes two Vercel-specific files:

- `.vercelignore`: excludes non-runtime artifacts such as `large-files-to-zip/`, `data/`, `scripts/`, and local caches from CLI-based deployments

For this project, the runtime files you should keep deployed are:

- `public/data/amazon_cmip6_grid.cesm2.json`
- `public/data/amazon_cmip6_grid.cesm2.json.meta.json`
- `public/data/countries-50m.json`
- any other assets the frontend imports directly from `public/`

Files that are useful for analysis or archiving but are not needed by the deployed site:

- `large-files-to-zip/`
- `data/raw/`
- `data/figures/`
- `scripts/`

Important note: `.vercelignore` helps exclude files from Vercel deployments, especially when deploying with the Vercel CLI. For Git-based Vercel projects, you should still keep genuinely large artifacts out of the repository whenever possible.

This app does not need a catch-all Vercel rewrite right now because it is served from `/` and does not use client-side URL routes. A broad SPA rewrite like `/(.*) -> /index.html` can break the app by intercepting `public/data/*.json` requests and serving HTML instead of JSON.

## Expected data schema

Each row in `public/data/amazon_cmip6_grid.json` should represent one Amazon grid cell:

```json
{
  "cell_id": "string",
  "lat": -10.0,
  "lon": -56.0,
  "geometry": { "type": "Polygon", "coordinates": [] },
  "region": "northwest | northeast | southwest | southeast | other",
  "crop_change": 0.05,
  "pasture_change": 0.08,
  "land_conversion_change": 0.13,
  "tas_change": 1.4,
  "tasmax_change": 1.8,
  "pr_dry_change": -0.35,
  "mrsos_dry_change": -3.2,
  "hurs_dry_change": -2.1,
  "evspsbl_change": -0.15,
  "lai_change": -0.12,
  "gpp_change": -0.35,
  "nbp_change": -0.08
}
```

Additional early/late fields such as `crop_early`, `crop_late`, `tas_early`, and `tas_late` can be included for tooltips or future extensions. Cells missing latitude, longitude, or geometry are filtered out before rendering. Cells with insufficient data for a composite score are shown in neutral gray and described as “insufficient data” in tooltips and the detail panel.

## Replacing the sample data with real CMIP6 output

1. Preprocess NetCDF outside the browser into one JSON array or CSV table. The frontend should not parse raw NetCDF.
2. Include one row per grid cell with `lat`, `lon`, and a GeoJSON `geometry` polygon.
3. Save the output as `public/data/amazon_cmip6_grid.json`.
4. Preserve the variable names listed in the schema, or update the accessors in `src/utils/dataTransforms.js` and the chart modules.
5. Re-run `npm run dev` or `npm run build`.

`public/data/amazon_cmip6_grid.sample.json` contains 20 fake/demo cells with plausible directional changes so all seven story frames render without the full dataset.

## Hybrid finer-grid atmospheric pipeline

If you want the Amazon story to use finer atmospheric fields while keeping the
existing coarse land / carbon variables, the repo now supports a hybrid build:

1. Download finer NEX-GDDP-CMIP6 subsets for `tas`, `tasmax`, `pr`, and `hurs`.
2. Aggregate those 0.25 degree fields back onto the existing coarse CMIP6 story grid.
3. Preserve the coarse `land_conversion_change`, `mrsos`, `evspsbl`, `lai`, `gpp`, and `nbp` fields from the base JSON.

The helper scripts live in `dsc106-project3/scripts/`:

- `download_nex_gddp_cmip6_subset.py`
- `build_hybrid_amazon_grid.py`

Example download for a historical early period:

```bash
python3 dsc106-project3/scripts/download_nex_gddp_cmip6_subset.py \
  --model GFDL-ESM4 \
  --scenario historical \
  --years 1995-2004 \
  --variables tas tasmax pr hurs \
  --outdir dsc106-project3/data/nex_gddp_amazon \
  --insecure
```

Example download for a later future period:

```bash
python3 dsc106-project3/scripts/download_nex_gddp_cmip6_subset.py \
  --model GFDL-ESM4 \
  --scenario ssp585 \
  --years 2040-2059 \
  --variables tas tasmax pr hurs \
  --outdir dsc106-project3/data/nex_gddp_amazon \
  --insecure
```

Then build the hybrid app JSON:

```bash
python3 dsc106-project3/scripts/build_hybrid_amazon_grid.py \
  --base-grid dsc106-project3/public/data/amazon_cmip6_grid.json \
  --early-root dsc106-project3/data/nex_gddp_amazon/GFDL-ESM4/historical \
  --late-root dsc106-project3/data/nex_gddp_amazon/GFDL-ESM4/ssp585 \
  --early-years 1995-2004 \
  --late-years 2040-2059 \
  --variables tas tasmax pr hurs \
  --output dsc106-project3/public/data/amazon_cmip6_grid.hybrid.json
```

This produces:

- `amazon_cmip6_grid.hybrid.json`: app-ready grid rows
- `amazon_cmip6_grid.hybrid.json.meta.json`: provenance for the fine-field merge

Supporting raw assets now live inside the app project as well:

- `dsc106-project3/data/raw/deforestation_metrics_gfdl_esm4_historical.npz`
- `dsc106-project3/data/figures/`

Important caveats:

- This improves the granularity of atmospheric fields only. It does not create finer native CMIP6 `mrsos`, `evspsbl`, `lai`, `gpp`, or `nbp`.
- `pr` is converted to `mm/day` when the NEX source units are flux units (`kg m-2 s-1`).
- NEX longitude is converted from `0..360` to `-180..180` before aggregation.

## Native CESM2 pipeline

If you want a no-fake build from one public Earth-system model that includes
`mrsos`, `evspsbl`, `lai`, `gpp`, and `nbp`, the repo now includes a native CESM2
builder:

- `build_cesm2_native_grid.py`

Default build:

- model: `CESM2`
- member: `r1i1p1f1`
- early period: `1850-1869`
- late period: `1995-2014`
- experiments: `historical` for both periods

This historical-only default is intentional. In the public native-grid Zarr archive
used here, the full CESM2 monthly stack needed by the story is available for
historical output, while some future scenario combinations are incomplete. The
builder does not invent missing scenario variables.

Run it like this:

```bash
python3 dsc106-project3/scripts/build_cesm2_native_grid.py \
  --output dsc106-project3/public/data/amazon_cmip6_grid.cesm2.json \
  --insecure \
  --overwrite
```

This produces:

- `amazon_cmip6_grid.cesm2.json`: app-ready native CESM2 Amazon cells
- `amazon_cmip6_grid.cesm2.json.meta.json`: source stores, periods, and unit conversions

Important caveats:

- No synthetic fill or interpolation is used. Missing variables stay missing.
- `tasmax_*` is null in the default CESM2 historical build because the public native-grid monthly `tasmax` store was not found for this model/member/archive combination.
- `pr` and `evspsbl` are converted from `kg m-2 s-1` to `mm/day`.
- `gpp` and `nbp` are converted from `kg m-2 s-1` to `gC m-2 day-1`.
- `tas` means are converted from Kelvin to Celsius before `tas_change` is computed.

## Score computations

The score functions are implemented in `src/utils/dataTransforms.js` and are computed once after data load:

- `combineLandConversion(row)`: returns `land_conversion_change` when provided; otherwise returns `crop_change + pasture_change`.
- `zscore(values)`: standardizes finite values while ignoring null, missing, or non-numeric values.
- `computeWarmingScore(rows)`: `warming_score = z(tas_change)` or `z(tasmax_change)` when mean temperature is missing.
- `computeDrynessScore(rows)`: `dryness_score = z(-pr_dry_change) + z(-mrsos_dry_change)`, optionally adding `z(-hurs_dry_change)` when humidity is available.
- `computeClimateStressScore(rows)`: `climate_stress_score = z(warming_score) + z(dryness_score)`, optionally adding `z(-evspsbl_change)`.
- `computeProductivityResponseScore(rows)`: `productivity_response_score = z(-gpp_change) + z(-lai_change)`.
- `computeCarbonFragilityScore(rows)`: combines `z(land_conversion_change)`, `z(tas_change or tasmax_change)`, `z(-pr_dry_change)`, `z(-mrsos_dry_change)`, optional `z(-evspsbl_change)`, `z(-gpp_change or -lai_change)`, and `z(-nbp_change)`.

Composite scores are computed from available components only when at least three components exist for the final carbon-fragility score.

## Why the story focuses on climate stress

The visualization avoids the simple direct pathway “cropland replaces trees, so less biomass absorbs less carbon.” Instead, it follows a seven-step chain:

1. Amazonia is spatially uneven.
2. Land conversion is concentrated unevenly, especially in eastern/southeastern regions.
3. Converted regions overlap with stronger warming.
4. Dry-season moisture stress intensifies where warming and land conversion coincide.
5. Evaporative cooling weakens.
6. Vegetation productivity weakens under hotter/drier conditions.
7. Carbon uptake becomes fragile where warming, drying, productivity decline, and carbon uptake weakening overlap.

This framing is consistent with the mechanism discussed by Gatti et al. 2021: regional land-surface disturbance, warming, and moisture stress can interact to weaken ecosystem carbon uptake.

## Causality caveat

The page uses careful language such as “coincides with,” “associated with,” and “consistent with.” CMIP6 grid-cell patterns alone do not prove that land conversion caused a specific carbon-flux outcome, and this project does not reproduce the aircraft CO2 flux estimates in the Nature paper. The final hotspot map should be interpreted as an exploratory synthesis of modeled land-climate-carbon stress indicators, not as a causal attribution product.
