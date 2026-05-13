# Data transformations in this visualization

This document describes **only** transformations implemented in the app code (primarily `src/utils/dataTransforms.js`, `src/utils/scales.js`, and chart modules). **Pre-aggregation unit conversions and CMIP6 sourcing** for the bundled CESM2 grid are summarized from `public/data/amazon_cmip6_grid.cesm2.json.meta.json` where they appear; they are not re-applied in JavaScript.

**Primary implementation file:** `src/utils/dataTransforms.js` (imported as `./utils/dataTransforms.js` from `src/main.js`). The user-facing narrative also refers to this logic in tooltips and legend copy in `src/main.js`, `src/charts/riskMap.js`, and `src/charts/scatter.js`.

---

## 1. Data sources (`public/data/`)

The app loads grid rows from the **first successful path** in this order (`loadData` in `src/main.js`):

1. `amazon_cmip6_grid.cesm2.json`
2. `amazon_cmip6_grid.hybrid.json`
3. `amazon_cmip6_grid.json`
4. `amazon_cmip6_grid.sample.json`

Optional sidecar metadata: `<path>.meta.json` (e.g. `amazon_cmip6_grid.cesm2.json.meta.json`). If present, `early_years` and `late_years` drive the comparison-period labels in the UI (`summarizeYearRange` in `src/main.js`).

A separate timeline payload is loaded for the opening “sink transition” map (`loadTimelineData`):

- `amazon_nbp_timeline.cesm2.json`  
  Per-cell time series of NBP; **not** merged into `prepareRows`—see `buildChangeRows` in `src/charts/sinkTransition.js`.

Each grid row is expected to include coordinates (`lat`, `lon`), a `geometry` polygon, `cell_id`, `region`, and numerous `*_change` fields. Rows without valid `lat`, `lon`, or `geometry` are dropped in `prepareRows`.

---

## 2. Comparison periods (late − early)

### Period-mean *change* fields (`*_change` in the grid JSON)

For most maps and scores, the visualization treats each numeric `*_change` on a row as **already** representing a contrast between an early and a late period (typically **late-period mean minus early-period mean**). The exact calendar years are **not** recomputed in JS; they come from preprocessing and optional metadata.

When `*.meta.json` is loaded for the CESM2 grid, the UI labels use:

- **Early period:** `1850–1869` (`meta.early_years` min–max in `amazon_cmip6_grid.cesm2.json.meta.json`)
- **Late period:** `1995–2014` (`meta.late_years` min–max)

If metadata is missing, `main.js` falls back to the strings `"Earlier period"` and `"Later period"` (no numeric range).

Legend strings in `src/charts/smallMultiples.js` and `src/main.js` describe the intended difference as **late minus early** for the active variable (wording only; the subtraction is done upstream in the dataset).

### Dry-season window (metadata only)

`amazon_cmip6_grid.cesm2.json.meta.json` lists **`dry_months`: June–October (6–10)**. The grid’s `*_dry_*` and `tas_change` semantics in narrative copy are framed as dry-season or period contrasts consistent with that metadata; the app does not re-aggregate months in JS.

### Long-horizon NBP map (`sinkTransition`)

In `buildChangeRows` (`src/charts/sinkTransition.js`), for each cell:

- **`timeline_change`** = NBP at the **last** timeline year minus NBP at the **first** timeline year (`last - first`).
- **`timeline_end`** = NBP value at the **last** year.

The subtitle on the map uses `timeline.years[0]` and `timeline.years[last]` from the JSON. The legend states **1850 → 2014** in copy (`renderSinkTransition`); the actual endpoints are whatever the timeline file contains.

---

## 3. Row-level preprocessing (`prepareRows`)

Executed once after fetch (`src/main.js` → `prepareRows`):

| Step | Function | What it does |
|------|-----------|----------------|
| Filter | `prepareRows` | Keeps rows with finite `lat`, `lon`, and a `geometry`. |
| IDs | `prepareRows` | Sets `cell_id` to `cell-${index}` if missing. |
| Coords | `finiteNumber` | Parses `lat` / `lon` as numbers; non-finite → `null`. |
| Geometry | `normalizeGeometry` | If `geoArea` of the polygon exceeds \(2\pi\) (wrong orientation), rings are reversed so area is sensible for D3 (`normalizeGeometry` + `geoArea`). |
| Land conversion | `combineLandConversion` | **`land_conversion_change`** = existing `land_conversion_change` if present; otherwise **`crop_change + pasture_change`** (missing parts treated as 0). |
| Scores | `computeWarmingScore`, `computeDrynessScore`, `computeClimateStressScore`, `computeProductivityResponseScore`, `computeCarbonFragilityScore` | Adds composite fields (see §5). Clears each row’s `__components` object before use. |

If a composite field (e.g. `carbon_fragility_score`) is **already a finite number** on input, `prepareRows` **does not overwrite** it (`??` pattern in each `compute*` function).

### Parsing helper

- **`finiteNumber`**: `null` / `undefined` / `''` → `null`; otherwise `Number(value)` and require `Number.isFinite`.

---

## 4. Per-variable treatment in scores and maps

Unless noted, values are the raw row fields from JSON. **“Weakening”** in composites uses **negation** so that **decreases** in GPP, LAI, evapotranspiration, or NBP, and **drying** (less rain, soil moisture, or humidity), contribute **positively** after z-scoring.

### Warming

- **`warming_score`** (`computeWarmingScore`): z-score of **`tas_change`**, or **`tasmax_change`** if `tas_change` is null (`addZComponent` key `warming`). Same value is also stored in `__components.warming`.

### Dryness

- **`dryness_score`** (`computeDrynessScore`): For each cell, z-scored components are built from:
  - **Precipitation:** \(-\) `pr_dry_change` (key `dry_pr`) — *less rain* → more positive after z-score.
  - **Soil moisture:** \(-\) `mrsos_dry_change` (`dry_mrsos`).
  - **Relative humidity (optional):** If **any** row has finite `hurs_dry_change`, a third component \(-\) `hurs_dry_change` (`dry_hurs`) is included for **all** rows.
- **Aggregation:** Sum of the available z-scores, but only if at least **`min(2, number of keys)`** components are non-null (`componentSum`). So with two keys you need 2; with three keys you still need 2.

### Evapotranspiration

- **`evspsbl_change`**: Used **raw** on choropleth (`renderChoropleth` + `divergingScale`). In **`climate_stress_score`**, it enters as **\(-\) `evspsbl_change`** (weaker ET → higher stress contribution) when **any** row has finite `evspsbl_change`.

### GPP, LAI

- **`computeProductivityResponseScore`**: z-score **\(-\) `gpp_change`** and **\(-\) `lai_change`**, then **`productivity_response_score`** = sum of those z-scores if at least **one** component is present (`minComponents` = 1).

### NBP

- **`nbp_change`**: In **`carbon_fragility_score`** only, as **\(-\) `nbp_change`** (weaker sink / stronger source tendency → higher fragility contribution). The timeline map uses **year-first vs year-last** NBP differences, not `nbp_change` (`sinkTransition.js`).

### Land conversion

- **`land_conversion_change`**: After `combineLandConversion`, used **raw** in bivariate quantiles, choropleth, and as a z-scored component in **`carbon_fragility_score`**.

### Variables shown mainly as raw `*_change` on maps

- **Small multiples** (`smallMultiples.js`): `tas_change`, `pr_dry_change`, `mrsos_dry_change`, `hurs_dry_change` (with fallback to `evspsbl_change` if primary missing—labeled “proxy”). Coloring uses **`divergingScale`** on the active key.
- **Land step** (`map.js`): sequential scale on `land_conversion_change`.
- **Evaporation step**: diverging scale on `evspsbl_change`.

---

## 5. Composite indices (formulas)

All indices below use **`zscore`** in `src/utils/dataTransforms.js`: mean and **population** variance \(\frac{1}{n}\sum (x-\bar{x})^2\), standard deviation = \(\sqrt{\text{variance}}\); if σ = 0, z = 0 for non-null values. Z-scores are computed **across all loaded grid rows** for that component.

Internal per-row buckets under `row.__components` hold each z-scored piece before summing.

### Warming score

- **Formula:** \(z(\texttt{tas\_change})\) or \(z(\texttt{tasmax\_change})\) if mean temperature change is missing.  
- **Function:** `computeWarmingScore`.

### Dryness score

- **Formula:** Sum of z-scores of \(-\texttt{pr\_dry\_change}\), \(-\texttt{mrsos\_dry\_change}\), and optionally \(-\texttt{hurs\_dry\_change}\), requiring at least two non-missing components when three keys are defined, or two when only two keys exist (`componentSum` with `minComponents = min(2, |keys|)`).  
- **Function:** `computeDrynessScore`.

### Climate stress score

- **Formula:**  
  1. z-score of **`warming_score`** (`warming_score_z`).  
  2. z-score of **`dryness_score`** (`dryness_score_z`).  
  3. If any row has `evspsbl_change`, z-score of **\(-\) `evspsbl_change`** (`evap_weakening`).  
- **Aggregation:** Sum of those with the same **`minComponents = min(2, |keys|)`** rule as dryness.  
- **Function:** `computeClimateStressScore`.

### Productivity response score

- **Formula:** \(z(-\texttt{gpp\_change}) + z(-\texttt{lai\_change})\), at least **one** term required.  
- **Function:** `computeProductivityResponseScore`.

### Carbon fragility score

- **Per-cell z-scored ingredients** (`computeCarbonFragilityScore`):  
  `land_conversion`, `tas_change` or `tasmax_change`, \(-\) `pr_dry_change`, \(-\) `mrsos_dry_change`, \(-\) `evspsbl_change`, \(-\)(\(`gpp_change` or `lai_change` — first available), \(-\) `nbp_change`.  
- **Aggregation:** **Sum** of those seven z-scores; a cell gets a score only if **≥ 3** non-null components (`componentSum` with `minComponents = 3`).  
- **Functionnames:** `computeCarbonFragilityScore`, `componentSum`.

**Weighting:** none beyond equal z-scored terms and the minimum-component gates; no explicit weights in code.

---

## 6. Bivariate and categorical encodings

### Land × warming bivariate map (`bivariateMap.js`)

- **`land_conversion_change`** and the active warming field (`tasmax_change` if any row has it, else `tas_change` — see `src/main.js`) are each passed through **`d3.scaleQuantile`** with domain = all non-null values and **range `[0, 1, 2]`** → **terciles** (three bins per axis).
- **`quantileRank`** in `src/utils/scales.js` returns `scale(value)` clamped to \([0, 2]\) (tercile index 0, 1, or 2).
- **Color:** `bivariateColor(landRank, warmingRank)` indexes a fixed 3×3 palette (`bivariatePalette` in `scales.js`).
- **Symbol size on map:** `magnitudeFor` uses **`landRank + warmingRank`** (0–4), passed into the map’s sqrt radius scale (`drawMap` in `map.js`).

### Scatterplot Y-axis coloring (`scatter.js`)

- **`binnedYColorScale`:** `d3.scaleQuantize` over the **extent** of the chosen Y metric (`gpp_change`, else `lai_change`, else `evspsbl_change`) into **6** discrete colors (equal **width** subdivisions of the min–max interval, not rank quantiles).

### Sink transition map (`sinkTransition.js`)

- **`binnedChangeScale`:** `d3.scaleThreshold` with **fixed quantile positions** (0.12, 0.30, 0.52, 0.82) on sorted `timeline_change` values, with **fallback** anchors `-0.08` and `0.12` if quantiles are missing.
- **Hotspot outlines:** cells where `timeline_end <= 0`, `timeline_change <= sourceShiftThreshold` (28th percentile among cells that flipped to non-positive NBP by the end), and `|timeline_change| >= hotspotThreshold` (88th percentile of absolute changes across cells). Implemented in `renderSinkTransition`.

### Tooltip percentile labels (`main.js`)

- **`percentileText`:** empirical rank of a value among **all rows** for that key (not a separate transformed field).

### Selection summary (`scatter.js`)

- For brushed points, shows **median** of selected cells vs **basin median** on raw fields; positions on a track normalized by basin **extent**.

---

## 7. Legend binning and scales (`scales.js`)

### Sequential

- **`sequentialScale`:** `d3.scaleSequential` with `interpolateRgb` between two endpoint colors; domain = **data min–max** for the key (`extentFor`). If min = max, max is bumped by 1.

### Diverging (symmetric around zero)

- **`divergingScale`:** domain **\([-M, 0, M]\)** where \(M = \max(|min|, |max|, 0.001)\) from the data extent for that key (`extentFor` with fallback `[-1, 1]`). So the color ramp is **symmetric about zero** for whatever range the cells have (not forced to global CMIP bounds).
- **Exception for temperature key:** if `key === 'tas_change'`, the `d3.interpolateBrBG` ramp is **reversed** via `(t) => d3.interpolateBrBG(1 - t)` so interpretation matches the comment (teal ↔ cooler/negative, brown ↔ warmer/positive).

### Fragility / risk map

- **`riskScale`:** sequential **Magma** on **`carbon_fragility_score`** extent (`extentFor` with fallback `[0, 1]`).

### Region overview

- **Categorical** colors from `regionColors`; no numeric transform.

---

## 8. Grid cell visual aggregation (maps)

There is **no numerical aggregation across cells** in the client: each GeoJSON polygon stays one feature.

- **Position:** circle at **`path.centroid`** of the cell polygon (`map.js`).
- **Size:** radius = **`gridMagnitudeRadiusScale`**: square-root scale from **0** to **max |`magnitudeFor`|** across cells, clamped; default pixel range `GRID_CELL_RADIUS_RANGE` `[2.4, 20]`.
- **`magnitudeFor`** depends on the view (e.g. raw `*_change`, `carbon_fragility_score`, or bivariate rank sum).

Hexagon helpers (`hexPoints`) exist in `map.js` but **cells are drawn as circles** in the current `drawCellsByMode` implementation.

---

## 9. Pipeline notes from CESM2 meta (not applied in JS)

From `amazon_cmip6_grid.cesm2.json.meta.json` **`notes`**:

- `pr` and `evspsbl` converted **kg m⁻² s⁻¹ → mm/day**.
- `gpp` and `nbp` converted **kg m⁻² s⁻¹ → gC m⁻² day⁻¹**.
- `tas` converted **K → °C**.
- **`tasmax` may be null** in this bundle (meta note); the app then uses **`tas_change`** for max-temperature steps (`main.js`).

---

## 10. Quick reference: function index

| Concern | Primary function / module |
|--------|---------------------------|
| Load + label periods | `loadData`, `summarizeYearRange` — `src/main.js` |
| Row prep + composites | `prepareRows`, `compute*` — `src/utils/dataTransforms.js` |
| Z-score definition | `zscore` — `src/utils/dataTransforms.js` |
| Land sum | `combineLandConversion` — `src/utils/dataTransforms.js` |
| Diverging / sequential legends | `divergingScale`, `sequentialScale`, `riskScale` — `src/utils/scales.js` |
| Bivariate terciles | `renderBivariateMap` — `src/charts/bivariateMap.js` |
| NBP 1850–2014 map | `buildChangeRows`, `binnedChangeScale` — `src/charts/sinkTransition.js` |
| Scatter | `renderLinkedScatter` — `src/charts/scatter.js` |
