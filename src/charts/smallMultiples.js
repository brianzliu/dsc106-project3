import * as d3 from 'd3';
import { divergingScale, neutralColor } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import {
  attachZoomAndOverviewPanel,
  makeFeatureCollection,
  projectionFor,
  gridMagnitudeRadiusScale
} from './map.js';
import { renderLegend } from './legend.js';
import { getAmazonBoundary, getSouthAmerica } from '../utils/basemap.js';

let basemapPromise = null;
let amazonBoundaryPromise = null;
function ensureBasemap() {
  if (!basemapPromise) basemapPromise = getSouthAmerica().catch(() => null);
  return basemapPromise;
}
function ensureAmazonBoundary() {
  if (!amazonBoundaryPromise) amazonBoundaryPromise = getAmazonBoundary().catch(() => null);
  return amazonBoundaryPromise;
}

const stressors = [
  {
    key: 'tas_change',
    fallback: null,
    label: 'Temperature',
    legendTitle: 'Mean dry-season temperature change',
    note: 'Where dry-season air temperatures have risen most between the early and late comparison periods.',
    calculation: 'Late-period mean dry-season temperature minus early-period mean dry-season temperature for each grid cell.',
    analysis: 'Across the last four decades, <strong>dry-season</strong> average temperatures are up about <strong>+1.86 °C</strong> in the northern region and about <strong>+2.54 °C</strong> in the southern one. In the <strong>two hottest months</strong> in the southern region, warming is closer to <strong>+3.07 °C</strong> — extra heat stacked on the part of the year when rain is already thinnest.'
  },
  {
    key: 'pr_dry_change',
    fallback: 'evspsbl_change',
    label: 'Precipitation',
    legendTitle: 'Dry-season precipitation change',
    note: 'Negative values mean less rain during the dry season — the part of the year when forests are already closest to water stress.',
    calculation: 'Late-period dry-season precipitation minus early-period dry-season precipitation for each grid cell.',
    analysis: 'August–October rainfall is down roughly <strong>24%</strong> in the southern region and <strong>34%</strong> in the northern region over the same forty-year span. Even the <strong>less-cleared west</strong> has lost about <strong>20%</strong> of dry-season rain — a basin-wide pattern consistent with a <strong>soil-moisture cascade</strong>: drying and forest loss in the east can reduce how much moisture cycles back into the air for everyone downwind.'
  },
  {
    key: 'mrsos_dry_change',
    fallback: 'evspsbl_change',
    label: 'Soil moisture',
    legendTitle: 'Dry-season near-surface soil moisture change',
    note: 'Negative values mean the top of the soil column holds less water during the dry season than it used to.',
    calculation: 'Late-period dry-season surface soil moisture minus early-period values for each grid cell.',
    analysis: 'When dry-season rain drops, <strong>topsoil dries out</strong> with it. The <strong>east begins each dry season with less soil water in reserve</strong> than the west, so the same cut in rainfall means surface layers cross into <strong>“not enough for plants to tap easily”</strong> earlier in the year.'
  },
  {
    key: 'hurs_dry_change',
    fallback: 'evspsbl_change',
    label: 'Humidity',
    legendTitle: 'Dry-season relative humidity change',
    note: 'Negative values mean the air dries out more strongly in the late period than it did historically.',
    calculation: 'Late-period dry-season relative humidity minus early-period values for each grid cell.',
    analysis: 'The southeast shows a strong rise in <strong>vapor pressure deficit</strong>: think of it as how hard the atmosphere is pulling on water — the gap between how much moisture the air <em>could</em> hold and how much it <em>actually</em> holds. When that gap widens, <strong>more water gets drawn out of leaves</strong>, stressing vegetation even in years that never get labeled as droughts.'
  }
];

function resolveStressor(rows, stressor) {
  const primaryHas = rows.some((row) => finiteNumber(row[stressor.key]) !== null);
  if (primaryHas) return { ...stressor, activeKey: stressor.key };
  if (stressor.fallback && rows.some((row) => finiteNumber(row[stressor.fallback]) !== null)) {
    return { ...stressor, activeKey: stressor.fallback, label: `${stressor.label} (proxy)` };
  }
  return null;
}

// Pick the cells that change most for the given variable, then return their
// cell_ids so the zoom can frame that cluster. For temperature we want the
// most warming (top quartile); for the drying variables we want the most
// negative change (bottom quartile).
function quartileFocusIds(rows, key, { topQuartile = false, fraction = 0.25 } = {}) {
  const valued = rows
    .map((row) => ({ id: row.cell_id, value: finiteNumber(row[key]) }))
    .filter((entry) => entry.value !== null);
  if (!valued.length) return [];
  valued.sort((a, b) => topQuartile ? b.value - a.value : a.value - b.value);
  const cutoff = Math.max(4, Math.ceil(valued.length * fraction));
  return valued.slice(0, cutoff).map((entry) => entry.id);
}

// Per-variable rule for which area we frame. Each stressor zooms to a fixed
// quadrant of the basin chosen to match the narrative emphasis:
// - `tas_change` (temperature): southeast — strongest dry-season warming.
// - `pr_dry_change` (precipitation): northwest — drying signal anchors the
//   upper basin; tighter zoom keeps focus off the broader periphery.
// - `mrsos_dry_change` (soil moisture): northwest — companion to the
//   precipitation framing for a consistent upper-basin read.
// - `hurs_dry_change` (humidity): southeast — humidity collapse co-locates
//   with the warming hotspot in the southeast.
// Regions span a full quadrant, so `maxScale` is slightly higher than the old
// data-driven framing to keep the visible area comparably tight.
function focusForActiveKey(rows, activeKey) {
  const baseFocus = { padding: 48, duration: 700 };
  switch (activeKey) {
    case 'tas_change':
      return { ...baseFocus, regions: ['southeast'], maxScale: 1.9 };
    case 'pr_dry_change':
      return { ...baseFocus, regions: ['northwest'], maxScale: 2.0 };
    case 'mrsos_dry_change':
      return { ...baseFocus, regions: ['northwest'], maxScale: 2.0 };
    case 'hurs_dry_change':
      return { ...baseFocus, regions: ['southeast'], maxScale: 2.0 };
    default:
      return null;
  }
}

function drawStressorMap({ svg, rows, width, height, activeKey, focus = null, applyFocus = false, ...handlers }) {
  const scale = divergingScale(rows, activeKey);
  const projection = projectionFor(rows, width, height, Math.max(14, Math.min(width, height) * 0.04));
  const path = d3.geoPath(projection);
  const features = makeFeatureCollection(rows).features;
  // With per-variable zoom we don't fade out non-focused cells: dimming the
  // region we're zooming into would defeat the point of the framing.
  const inFocus = () => true;

  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img');
  svg.selectAll('*').remove();

  const root = svg.append('g').attr('class', 'multiples-root');
  const basemapLayer = root.append('g').attr('class', 'basemap-layer').attr('pointer-events', 'none');
  ensureBasemap().then((sa) => {
    if (!sa) return;
    basemapLayer.append('path').datum(sa).attr('d', path)
      .attr('fill', '#f0e9d8').attr('stroke', 'none').attr('opacity', 0.95);
  });

  const cellsLayer = root.append('g');

  const magnitudes = features
    .map((d) => Math.abs(finiteNumber(d.properties[activeKey]) ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const maxMag = magnitudes.length ? d3.max(magnitudes) : 1;
  const sizeScale = gridMagnitudeRadiusScale(maxMag);

  cellsLayer.selectAll('circle.grid-cell')
    .data(features, (d) => d.id)
    .join('circle')
    .attr('class', 'grid-cell')
    .attr('cx', (d) => path.centroid(d)[0])
    .attr('cy', (d) => path.centroid(d)[1])
    .attr('r', (d) => {
      const m = Math.abs(finiteNumber(d.properties[activeKey]) ?? 0);
      return sizeScale(Number.isFinite(m) ? m : 0);
    })
    .attr('fill', (d) => {
      const value = finiteNumber(d.properties[activeKey]);
      return value === null ? neutralColor : scale(value);
    })
    .attr('fill-opacity', (d) => inFocus(d.properties) ? 0.88 : 0.25)
    .attr('stroke', (d) => d.id === handlers.pinnedId || handlers.selectedIds?.has?.(d.id) ? '#111827' : 'rgba(20,31,22,0.35)')
    .attr('stroke-width', (d) => d.id === handlers.pinnedId || handlers.selectedIds?.has?.(d.id) ? 1.65 : 0.65)
    .on('pointerenter', (event, d) => handlers.onHover?.(event, d.properties))
    .on('pointermove', (event, d) => handlers.onHover?.(event, d.properties))
    .on('pointerleave', () => handlers.onLeave?.())
    .on('click', (event, d) => handlers.onClick?.(d.properties));

  // Boundary appended LAST so it stays above cells.
  const boundaryLayer = root.append('g').attr('pointer-events', 'none');
  ensureAmazonBoundary().then((amazon) => {
    if (!amazon) return;
    boundaryLayer.append('path')
      .datum(amazon).attr('d', path)
      .attr('fill', 'none').attr('stroke', '#0f2013').attr('stroke-width', 1.6).attr('stroke-opacity', 0.95)
      .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('vector-effect', 'non-scaling-stroke');
  });

  attachZoomAndOverviewPanel(svg, root, {
    projection,
    path,
    width,
    height,
    rows,
    features,
    colorFor: (row) => {
      const value = finiteNumber(row[activeKey]);
      return value === null ? neutralColor : scale(value);
    },
    magnitudeFor: (row) => finiteNumber(row[activeKey]),
    focus,
    applyFocus
  });

  return scale;
}

export function renderSmallMultiples({
  container, legend, rows, width, height, comparisonPeriods,
  activeStressorIndex = 0, onSelectStressor,
  focus = null, applyFocus = false,
  ...handlers
}) {
  container.selectAll('*').remove();

  const available = stressors.map((stressor) => resolveStressor(rows, stressor)).filter(Boolean);
  if (!available.length) {
    container.append('div').attr('class', 'sm-empty').text('No dry-season data available for this dataset.');
    return;
  }

  const activeIndex = Math.min(Math.max(0, activeStressorIndex), available.length - 1);
  const active = available[activeIndex];

  const wrapper = container.append('div').attr('class', 'sm-frame');

  const picker = wrapper.append('nav').attr('class', 'sm-picker').attr('aria-label', 'Choose a dry-season stressor');
  available.forEach((stressor, index) => {
    const isActive = index === activeIndex;
    const btn = picker.append('button')
      .attr('class', `sm-pill ${isActive ? 'is-active' : ''}`)
      .attr('type', 'button')
      .attr('aria-pressed', String(isActive))
      .on('click', () => onSelectStressor?.(index));
    btn.append('span').attr('class', 'sm-pill-step').text(String(index + 1).padStart(2, '0'));
    btn.append('span').attr('class', 'sm-pill-label').text(stressor.label);
  });

  const stage = wrapper.append('div').attr('class', 'sm-stage');
  stage.append('h3').attr('class', 'sm-caption-title').text(active.legendTitle);

  const mapHolder = stage.append('div').attr('class', 'sm-map-card');
  const svg = mapHolder.append('svg').attr('class', 'sm-map-svg');
  // Defer to layout to compute final size; use a sensible default viewBox.
  const mapWidth = Math.max(360, Math.floor(width * 0.92));
  const mapHeight = Math.max(280, Math.floor(height * 0.66));
  // Compute the framing per active variable (bottom-quartile cells, except
  // temperature which uses the top quartile). This ignores the step-level
  // region focus so we always zoom to the cluster that's changing the most.
  const variableFocus = focusForActiveKey(rows, active.activeKey) ?? focus;
  const scale = drawStressorMap({
    svg, rows,
    width: mapWidth, height: mapHeight,
    activeKey: active.activeKey,
    focus: variableFocus,
    applyFocus,
    ...handlers
  });

  // Translucent overlay anchored to the map bottom-left (over .sm-map-card).
  const analysis = mapHolder.append('aside')
    .attr('class', 'stressor-analysis')
    .attr('aria-live', 'polite');

  // Render every variable's copy as a layered <p>; only the active one is visible.
  // Layered absolute positioning lets opacity transitions cross-fade without layout jumps.
  const textStack = analysis.append('div').attr('class', 'stressor-analysis-stack');
  available.forEach((stressor) => {
    const isActive = stressor.key === active.key;
    textStack.append('p')
      .attr('class', `stressor-analysis-text${isActive ? ' is-active' : ''}`)
      .attr('data-variable', stressor.key)
      .attr('aria-hidden', String(!isActive))
      .html(stressor.analysis ?? '');
  });

  // Force the fade-in transition on each render: start at opacity 0 then promote on next frame.
  // Honors prefers-reduced-motion via the CSS rule on .stressor-analysis-text.
  const activeNode = textStack.select('.stressor-analysis-text.is-active').node();
  const stackNode = textStack.node();
  if (activeNode && stackNode) {
    // Measure the active paragraph's natural height at the stack's current
    // width by briefly flipping it out of absolute positioning. The siblings
    // stay opacity:0 + pointer-events:none so this is invisible to users.
    const prevPosition = activeNode.style.position;
    const prevVisibility = activeNode.style.visibility;
    activeNode.style.position = 'static';
    activeNode.style.visibility = 'hidden';
    const naturalHeight = activeNode.getBoundingClientRect().height;
    activeNode.style.position = prevPosition;
    activeNode.style.visibility = prevVisibility;

    activeNode.classList.remove('is-active');
    activeNode.setAttribute('aria-hidden', 'true');
    requestAnimationFrame(() => {
      activeNode.classList.add('is-active');
      activeNode.setAttribute('aria-hidden', 'false');
      if (Number.isFinite(naturalHeight) && naturalHeight > 0) {
        // Transition from the CSS-default `min-height: 6.4em` to the
        // measured value so the card auto-fits the active paragraph.
        stackNode.style.minHeight = `${Math.ceil(naturalHeight)}px`;
      }
    });
  }

  renderLegend(legend, {
    title: active.legendTitle,
    scale,
    note: active.note,
    calculation: `${comparisonPeriods?.late ?? 'Later period'} minus ${comparisonPeriods?.early ?? 'earlier period'}: ${active.calculation}`
  });
}
