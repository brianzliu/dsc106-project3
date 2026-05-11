# Amazon Climate-Stress Scrollytelling

This project implements an interactive D3 v7 scrollytelling visualization about Amazon land conversion, dry-season warming, moisture stress, vegetation response, and carbon-sink fragility using preprocessed CMIP6 GFDL-ESM4 grid data.

The scientific framing is inspired by Gatti et al. 2021, **“Amazonia as a carbon source linked to deforestation and climate change.”** The story intentionally focuses on the climate-stress mechanism emphasized by the paper: land conversion and deforestation are associated with hotter and drier regional conditions, especially in the dry season, and those stresses can weaken vegetation function and carbon uptake.

> Methods caveat: This visualization is inspired by Gatti et al. 2021 and uses CMIP6 GFDL-ESM4 variables to explore related gridded land-climate-carbon patterns. It does not reproduce the paper’s aircraft CO2 flux estimates.

## How to run locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

The app loads `public/data/amazon_cmip6_grid.json` first. If that file is missing, it falls back to `public/data/amazon_cmip6_grid.sample.json`.

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
