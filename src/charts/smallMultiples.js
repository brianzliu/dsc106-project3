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
    calculation: 'Late-period mean dry-season temperature minus early-period mean dry-season temperature for each grid cell.'
  },
  {
    key: 'pr_dry_change',
    fallback: 'evspsbl_change',
    label: 'Precipitation',
    legendTitle: 'Dry-season precipitation change',
    note: 'Negative values mean less rain during the dry season — the part of the year when forests are already closest to water stress.',
    calculation: 'Late-period dry-season precipitation minus early-period dry-season precipitation for each grid cell.'
  },
  {
    key: 'mrsos_dry_change',
    fallback: 'evspsbl_change',
    label: 'Soil moisture',
    legendTitle: 'Dry-season near-surface soil moisture change',
    note: 'Negative values mean the top of the soil column holds less water during the dry season than it used to.',
    calculation: 'Late-period dry-season surface soil moisture minus early-period values for each grid cell.'
  },
  {
    key: 'hurs_dry_change',
    fallback: 'evspsbl_change',
    label: 'Humidity',
    legendTitle: 'Dry-season relative humidity change',
    note: 'Negative values mean the air dries out more strongly in the late period than it did historically.',
    calculation: 'Late-period dry-season relative humidity minus early-period values for each grid cell.'
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

function drawStressorMap({ svg, rows, width, height, activeKey, focus = null, applyFocus = false, ...handlers }) {
  const scale = divergingScale(rows, activeKey);
  const projection = projectionFor(rows, width, height, Math.max(14, Math.min(width, height) * 0.04));
  const path = d3.geoPath(projection);
  const features = makeFeatureCollection(rows).features;
  const inFocus = (row) => !focus?.regions || focus.regions.includes(row.region);

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
  const scale = drawStressorMap({ svg, rows, width: mapWidth, height: mapHeight, activeKey: active.activeKey, focus, applyFocus, ...handlers });

  renderLegend(legend, {
    title: active.legendTitle,
    scale,
    note: active.note,
    calculation: `${comparisonPeriods?.late ?? 'Later period'} minus ${comparisonPeriods?.early ?? 'earlier period'}: ${active.calculation}`
  });
}
