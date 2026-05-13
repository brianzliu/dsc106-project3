import * as d3 from 'd3';
import { divergingScale, neutralColor, regionColors, sequentialScale } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { renderLegend } from './legend.js';
import { getAmazonBoundary, getSouthAmerica } from '../utils/basemap.js';

// Cache the basemap once it loads (async). The first map render will trigger fetch.
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

// Each grid cell renders as a pointy-top hexagon inscribed in the projected
// polygon. Slight overlap between neighbours produces a near-tessellating mosaic
// that reads as designed rather than as a raw lat/lon grid.
export function cellRadius(feature, path, factor = 0.62) {
  const bounds = path.bounds(feature);
  const dx = bounds[1][0] - bounds[0][0];
  const dy = bounds[1][1] - bounds[0][1];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) return 4;
  return Math.min(dx, dy) * factor;
}

export function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

// Sqrt-encoded magnitudes — radius span tuned so area differences read clearly without crowding mid-range cells.
export const GRID_CELL_RADIUS_RANGE = [2.4, 20];

// Bivariate choropleth only: higher radius floor (~4.5px) so low summed-rank cells in the west/north
// stay visible against the cream basemap; max unchanged so overlap behavior matches other maps.
export const BIVARIATE_GRID_CELL_RADIUS_RANGE = [4.5, 20];

// Overview minimap dot radii — scale the floor with the main map so the inset stays proportional.
const DEFAULT_OVERVIEW_RADIUS_RANGE = [1.15, 6.65];
export const BIVARIATE_OVERVIEW_RADIUS_RANGE = [
  (DEFAULT_OVERVIEW_RADIUS_RANGE[0] / GRID_CELL_RADIUS_RANGE[0]) * BIVARIATE_GRID_CELL_RADIUS_RANGE[0],
  DEFAULT_OVERVIEW_RADIUS_RANGE[1]
];

/** @returns {d3.ScalePower<number, number>} */
export function gridMagnitudeRadiusScale(maxMag, range = GRID_CELL_RADIUS_RANGE) {
  return d3.scaleSqrt().domain([0, maxMag || 1]).range(range).clamp(true);
}

export function focusTransform(features, path, width, height, padding = 60, maxScale = 1.7) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feature of features) {
    const bounds = path.bounds(feature);
    if (!Number.isFinite(bounds[0][0])) continue;
    minX = Math.min(minX, bounds[0][0]);
    minY = Math.min(minY, bounds[0][1]);
    maxX = Math.max(maxX, bounds[1][0]);
    maxY = Math.max(maxY, bounds[1][1]);
  }
  const fw = maxX - minX;
  const fh = maxY - minY;
  if (!Number.isFinite(fw) || !Number.isFinite(fh) || fw <= 0 || fh <= 0) return d3.zoomIdentity;
  const targetScale = Math.min((width - 2 * padding) / fw, (height - 2 * padding) / fh);
  const scale = Math.max(1.05, Math.min(targetScale, maxScale));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = width / 2 - scale * cx;
  const ty = height / 2 - scale * cy;
  return d3.zoomIdentity.translate(tx, ty).scale(scale);
}

function inFocus(row, focus) {
  if (!focus?.regions) return true;
  return focus.regions.includes(row.region);
}

export function makeFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      id: row.cell_id,
      properties: row,
      geometry: row.geometry
    }))
  };
}

function normalizePadding(width, height, padding = 20) {
  if (typeof padding === 'number') {
    const inset = Math.max(padding, Math.min(width, height) * 0.04);
    return { top: inset, right: inset, bottom: inset, left: inset };
  }

  return {
    top: padding.top ?? 20,
    right: padding.right ?? 20,
    bottom: padding.bottom ?? 20,
    left: padding.left ?? 20
  };
}

// Project the Amazon basin grid into the SVG with extra breathing room.
export function projectionFor(rows, width, height, padding = 20) {
  const fc = makeFeatureCollection(rows);
  const inset = normalizePadding(width, height, padding);
  return d3.geoMercator().fitExtent(
    [[inset.left, inset.top], [width - inset.right, height - inset.bottom]],
    fc
  );
}

/**
 * Draw a map with:
 *   • Country basemap underneath (gray-on-cream)
 *   • Grid cells on top, colored by `colorFor(row)`
 *   • d3.zoom for pan/zoom (scroll or pinch to zoom, drag to pan)
 */
function drawCellsByMode({
  layer, features, path, colorFor, magnitudeFor, focus, pinnedId, selectedIds, onHover, onLeave, onClick,
  magnitudeRadiusRange = GRID_CELL_RADIUS_RANGE,
  gridDefaultStroke = 'rgba(20,31,22,0.35)',
  gridDefaultStrokeWidth = 0.65
}) {
  const isFocus = (props) => !focus?.regions || focus.regions.includes(props.region);
  const baseFill = (props) => colorFor(props);

  const interactiveHandlers = (sel) => sel
    .on('pointerenter', (event, d) => onHover?.(event, d.properties))
    .on('pointermove',  (event, d) => onHover?.(event, d.properties))
    .on('pointerleave', () => onLeave?.())
    .on('click',        (event, d) => onClick?.(d.properties));

  const magnitudes = features
    .map((d) => Math.abs(magnitudeFor?.(d.properties) ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const maxMag = magnitudes.length ? d3.max(magnitudes) : 1;
  const sizeScale = gridMagnitudeRadiusScale(maxMag, magnitudeRadiusRange);
  /** Bivariate: pale low-bin fills need near-full opacity outside regional focus so the palette stays legible on cream. */
  const isBivariateMap = magnitudeRadiusRange === BIVARIATE_GRID_CELL_RADIUS_RANGE;

  interactiveHandlers(layer.selectAll('circle.grid-cell')
    .data(features, (d) => d.id)
    .join('circle')
    .attr('class', 'grid-cell')
    .attr('cx', (d) => path.centroid(d)[0])
    .attr('cy', (d) => path.centroid(d)[1])
    .attr('r', (d) => {
      const m = Math.abs(magnitudeFor?.(d.properties) ?? 0);
      return sizeScale(Number.isFinite(m) ? m : 0);
    })
    .attr('fill', (d) => baseFill(d.properties))
    .attr('fill-opacity', (d) =>
      isFocus(d.properties) ? 0.88 : (isBivariateMap ? 1 : 0.25))
    .attr('stroke', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? '#111827' : gridDefaultStroke))
    .attr('stroke-width', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 1.65 : gridDefaultStrokeWidth)));
}

export function drawMap({
  svg, rows, width, height,
  colorFor, strokeFor, magnitudeFor,
  selectedIds = new Set(), pinnedId,
  onHover, onLeave, onClick,
  showBasemap = true,
  mapPadding = 20,
  focus = null,
  applyFocus = false,
  magnitudeRadiusRange = GRID_CELL_RADIUS_RANGE,
  overviewMagnitudeRadiusRange = DEFAULT_OVERVIEW_RADIUS_RANGE,
  gridDefaultStroke = 'rgba(20,31,22,0.35)',
  gridDefaultStrokeWidth = 0.65
}) {
  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img');
  const projection = projectionFor(rows, width, height, mapPadding);
  const path = d3.geoPath(projection);
  const features = makeFeatureCollection(rows).features;

  // A single <g> contains everything that should zoom/pan together.
  let root = svg.select('g.map-root');
  if (root.empty()) {
    root = svg.append('g').attr('class', 'map-root');
  } else {
    root.selectAll('*').remove();
  }

  // Layer 1: basemap (rendered async, doesn't block grid cells)
  if (showBasemap) {
    const basemapLayer = root.append('g').attr('class', 'basemap-layer').attr('pointer-events', 'none');
    ensureBasemap().then((sa) => {
      if (!sa) return;
      basemapLayer.append('path')
        .datum(sa)
        .attr('d', d3.geoPath(projection))
        .attr('fill', '#f0e9d8')
        .attr('stroke', 'none')
        .attr('opacity', 0.95);
    });
  }

  // Layer 2: cells in the requested encoding (proportional).
  const cellsLayer = root.append('g').attr('class', 'cells-layer');
  drawCellsByMode({
    layer: cellsLayer,
    features,
    path,
    colorFor,
    magnitudeFor,
    focus,
    pinnedId,
    selectedIds,
    onHover, onLeave, onClick,
    magnitudeRadiusRange,
    gridDefaultStroke,
    gridDefaultStrokeWidth
  });

  // Layer 3 (top): Amazon boundary sits above every cell.
  const amazonBoundaryLayer = root.append('g').attr('class', 'amazon-boundary-layer').attr('pointer-events', 'none');
  ensureAmazonBoundary().then((amazonBoundary) => {
    if (!amazonBoundary) return;
    amazonBoundaryLayer.append('path')
      .datum(amazonBoundary)
      .attr('class', 'amazon-outline')
      .attr('d', d3.geoPath(projection))
      .attr('fill', 'none')
      .attr('stroke', '#0f2013')
      .attr('stroke-opacity', 0.95)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('vector-effect', 'non-scaling-stroke');
  });

  attachZoomAndOverviewPanel(svg, root, {
    projection, path, width, height,
    rows, features, colorFor, magnitudeFor,
    focus, applyFocus,
    overviewMagnitudeRadiusRange
  });
}

/**
 * d3-zoom on `svg`, driving `root`'s transform, plus `.map-overview-panel` on `.map-wrap`
 * when present. Keeps choropleths and standalone stressor maps in sync with the minimap.
 */
export function attachZoomAndOverviewPanel(svg, root, {
  projection,
  path,
  width,
  height,
  rows,
  features,
  colorFor,
  magnitudeFor,
  focus,
  applyFocus,
  overviewMagnitudeRadiusRange = DEFAULT_OVERVIEW_RADIUS_RANGE
}) {
  const minZoom = 0.6;
  const maxZoom = 12;
  let refreshOverview = () => {};

  function polygonAreaMm(vertices) {
    if (vertices.length < 3) return 0;
    let sum = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i += 1) {
      const [x1, y1] = vertices[i];
      const [x2, y2] = vertices[(i + 1) % n];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum / 2);
  }

  const zoom = d3.zoom()
    .scaleExtent([minZoom, maxZoom])
    .translateExtent([[-width * 0.5, -height * 0.5], [width * 1.5, height * 1.5]])
    .on('zoom', (event) => {
      root.attr('transform', event.transform);
      refreshOverview();
    });

  svg.call(zoom);
  svg.on('dblclick.zoom', null);
  svg.on('dblclick', () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  // Resolve the set of features to frame: explicit cell ids take precedence
  // (e.g. data-driven per-variable zoom), then fall back to whole regions.
  let focusFeatures = null;
  if (Array.isArray(focus?.featureIds) && focus.featureIds.length) {
    const idSet = new Set(focus.featureIds);
    focusFeatures = features.filter((feature) => idSet.has(feature.id));
  } else if (focus?.regions) {
    focusFeatures = features.filter((feature) => focus.regions.includes(feature.properties.region));
  }
  const zoomToFocusedArea = focus?.zoomToFocus !== false;
  if (focusFeatures && focusFeatures.length && zoomToFocusedArea) {
    const target = focusTransform(
      focusFeatures, path, width, height,
      focus?.padding ?? 60,
      focus?.maxScale ?? 1.7
    );
    const duration = focus?.duration ?? 640;
    const selection = applyFocus
      ? svg.transition().duration(duration).ease(d3.easeCubicInOut)
      : svg;
    selection.call(zoom.transform, target);
    if (applyFocus && selection !== svg) {
      selection.on('end.overview', () => refreshOverview());
    }
  }

  let gestureStartScale = null;

  svg
    .on('gesturestart.zoompinch', (event) => {
      event.preventDefault();
      gestureStartScale = d3.zoomTransform(svg.node()).k;
    }, { passive: false })
    .on('gesturechange.zoompinch', (event) => {
      event.preventDefault();
      if (gestureStartScale === null) return;
      const pointer = d3.pointer(event, svg.node());
      const nextScale = Math.max(minZoom, Math.min(maxZoom, gestureStartScale * event.scale));
      svg.call(zoom.scaleTo, nextScale, pointer);
    }, { passive: false })
    .on('gestureend.zoompinch', (event) => {
      event.preventDefault();
      gestureStartScale = null;
    }, { passive: false });

  const mapWrapNode = svg.node()?.closest('.map-wrap');
  if (!mapWrapNode) return;

  d3.select(mapWrapNode).selectAll('.map-overview-panel').remove();
  const OVW = 180;
  const OVH = 118;
  const projectionMini = projectionFor(rows, OVW, OVH, 5);
  const pathMini = d3.geoPath(projectionMini);
  const ovMagnitudes = features
    .map((d) => Math.abs(magnitudeFor?.(d.properties) ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const ovMaxMag = ovMagnitudes.length ? d3.max(ovMagnitudes) : 1;
  const miniSizeScale = gridMagnitudeRadiusScale(ovMaxMag, overviewMagnitudeRadiusRange);
  const isOvFocus = (props) => !focus?.regions || focus.regions.includes(props.region);
  const bivariateOverviewDots = overviewMagnitudeRadiusRange === BIVARIATE_OVERVIEW_RADIUS_RANGE;

  const overviewWrap = d3.select(mapWrapNode).append('div')
    .attr('class', 'map-overview-panel')
    .attr('aria-hidden', 'true');
  overviewWrap.append('div').attr('class', 'map-overview-title').text('Overview');
  const overviewSvgEl = overviewWrap.append('svg')
    .attr('class', 'map-overview-svg')
    .attr('viewBox', `0 0 ${OVW} ${OVH}`)
    .attr('role', 'presentation');

  const ovBasemapG = overviewSvgEl.append('g').attr('class', 'map-overview-basemap')
    .attr('pointer-events', 'none');
  ensureBasemap().then((sa) => {
    if (!sa || ovBasemapG.empty()) return;
    ovBasemapG.append('path')
      .datum(sa)
      .attr('d', pathMini)
      .attr('fill', '#efe7d6')
      .attr('stroke', 'none')
      .attr('opacity', 0.92);
  });

  overviewSvgEl.append('g')
    .attr('class', 'map-overview-dots')
    .attr('pointer-events', 'none')
    .selectAll('circle')
    .data(features, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => pathMini.centroid(d)[0])
    .attr('cy', (d) => pathMini.centroid(d)[1])
    .attr('r', (d) => {
      const m = Math.abs(magnitudeFor?.(d.properties) ?? 0);
      return miniSizeScale(Number.isFinite(m) ? m : 0);
    })
    .attr('fill', (d) => colorFor(d.properties))
    .attr('fill-opacity', (d) => {
      if (isOvFocus(d.properties)) return 0.82;
      return bivariateOverviewDots ? 0.9 : 0.2;
    })
    .attr('stroke', () => (bivariateOverviewDots ? 'rgba(20,31,22,0.22)' : 'rgba(20,31,22,0.16)'))
    .attr('stroke-width', overviewMagnitudeRadiusRange === BIVARIATE_OVERVIEW_RADIUS_RANGE ? 0.38 : 0.25);

  const ovBoundary = overviewSvgEl.append('g').attr('class', 'map-overview-outline')
    .attr('pointer-events', 'none');
  ensureAmazonBoundary().then((amazonBoundary) => {
    if (!amazonBoundary || ovBoundary.empty()) return;
    ovBoundary.append('path')
      .datum(amazonBoundary)
      .attr('d', pathMini)
      .attr('fill', 'none')
      .attr('stroke', '#0f2013')
      .attr('stroke-opacity', 0.9)
      .attr('stroke-width', 1.2)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('vector-effect', 'non-scaling-stroke');
  });

  const viewportPoly = overviewSvgEl.append('g')
    .attr('class', 'map-overview-framing')
    .attr('pointer-events', 'none')
    .append('polygon')
    .attr('fill', 'rgba(184, 79, 22, 0.11)')
    .attr('stroke', '#b84f16')
    .attr('stroke-opacity', 0.88)
    .attr('stroke-width', 1.15)
    .attr('vector-effect', 'non-scaling-stroke');

  refreshOverview = () => {
    const panel = overviewWrap.node();
    if (!panel) return;
    const t = d3.zoomTransform(svg.node());
    const roughlyReset = Math.abs(t.k - 1) < 0.022 && Math.abs(t.x) < 2.2 && Math.abs(t.y) < 2.2;
    if (roughlyReset) {
      panel.classList.remove('is-visible');
      return;
    }

    const screenCorners = [[0, 0], [width, 0], [width, height], [0, height]];
    const miniPts = screenCorners.flatMap(([sx, sy]) => {
      const [lx, ly] = t.invert([sx, sy]);
      const lonlat = projection.invert([lx, ly]);
      if (!lonlat || !Number.isFinite(lonlat[0]) || !Number.isFinite(lonlat[1])) return [];
      const [mx, my] = projectionMini(lonlat);
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return [];
      return [[mx, my]];
    });

    if (miniPts.length < 3) {
      panel.classList.remove('is-visible');
      return;
    }

    const areaMm = polygonAreaMm(miniPts);
    const fullArea = OVW * OVH;
    const hasStoryRegionalFocus = Array.isArray(focus?.regions) && focus.regions.length > 0;
    const hideForNearlyFullViewport = !hasStoryRegionalFocus
      && fullArea > 0
      && areaMm >= fullArea * 0.97;
    if (hideForNearlyFullViewport) {
      panel.classList.remove('is-visible');
      return;
    }

    viewportPoly.attr('points', miniPts.map((p) => p.join(',')).join(' '));
    panel.classList.add('is-visible');
  };

  requestAnimationFrame(() => refreshOverview());
}

export function renderOverview({ svg, legend, rows, width, height, ...handlers }) {
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => regionColors[row.region] ?? regionColors.other,
    strokeFor: (row) => ['northeast', 'southeast'].includes(row.region) ? '#3b0764' : 'rgba(255,255,255,0.55)'
  });
  renderLegend(legend, {
    title: 'Amazon regions',
    type: 'categories',
    colors: [
      ['Northwest', regionColors.northwest],
      ['Northeast', regionColors.northeast],
      ['Southwest', regionColors.southwest],
      ['Southeast', regionColors.southeast]
    ]
  });
}

export function renderChoropleth({
  svg, legend, rows, width, height,
  key, title, palette = ['#f7fcf5', '#00441b'], diverging = false, note, calculation,
  ...handlers
}) {
  const scale = diverging ? divergingScale(rows, key) : sequentialScale(rows, key, palette);
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => {
      const value = finiteNumber(row[key]);
      return value === null ? neutralColor : scale(value);
    },
    magnitudeFor: (row) => finiteNumber(row[key])
  });
  renderLegend(legend, { title, scale, note, calculation });
}
