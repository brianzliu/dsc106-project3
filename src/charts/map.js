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

export function focusTransform(features, path, width, height, padding = 60) {
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
  const scale = Math.max(1.05, Math.min(targetScale, 2.2));
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
function drawCellsByMode({ layer, features, path, mode, colorFor, magnitudeFor, focus, pinnedId, selectedIds, onHover, onLeave, onClick, strokeFor }) {
  const isFocus = (props) => !focus?.regions || focus.regions.includes(props.region);
  const baseFill = (props) => colorFor(props);

  const interactiveHandlers = (sel) => sel
    .on('pointerenter', (event, d) => onHover?.(event, d.properties))
    .on('pointermove',  (event, d) => onHover?.(event, d.properties))
    .on('pointerleave', () => onLeave?.())
    .on('click',        (event, d) => onClick?.(d.properties));

  const strokeForCell = (d) =>
    strokeFor?.(d.properties) ?? (d.id === pinnedId || selectedIds.has(d.id) ? '#111827' : 'rgba(20,31,22,0.18)');

  const strokeWidthForCell = (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 1.8 : 0.4);

  if (mode === 'alpha') {
    interactiveHandlers(layer.selectAll('circle.grid-cell')
      .data(features, (d) => d.id)
      .join('circle')
      .attr('class', 'grid-cell')
      .attr('cx', (d) => path.centroid(d)[0])
      .attr('cy', (d) => path.centroid(d)[1])
      .attr('r', (d) => cellRadius(d, path, 0.85))
      .attr('fill', (d) => baseFill(d.properties))
      .attr('fill-opacity', (d) => isFocus(d.properties) ? 0.45 : 0.14)
      .attr('stroke', 'none')
      .style('mix-blend-mode', 'multiply'));
    return;
  }

  if (mode === 'raster') {
    interactiveHandlers(layer.selectAll('path.grid-cell')
      .data(features, (d) => d.id)
      .join('path')
      .attr('class', 'grid-cell')
      .attr('d', path)
      .attr('fill', (d) => baseFill(d.properties))
      .attr('fill-opacity', (d) => isFocus(d.properties) ? 0.95 : 0.22)
      .attr('stroke', 'none'));
    return;
  }

  if (mode === 'proportional') {
    const magnitudes = features
      .map((d) => Math.abs(magnitudeFor?.(d.properties) ?? 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const maxMag = magnitudes.length ? d3.max(magnitudes) : 1;
    const sizeScale = d3.scaleSqrt().domain([0, maxMag || 1]).range([1.5, 14]).clamp(true);

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
      .attr('fill-opacity', (d) => isFocus(d.properties) ? 0.88 : 0.25)
      .attr('stroke', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? '#111827' : 'rgba(20,31,22,0.35)'))
      .attr('stroke-width', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 1.4 : 0.4)));
    return;
  }

  // default: hex
  interactiveHandlers(layer.selectAll('polygon.grid-cell')
    .data(features, (d) => d.id)
    .join('polygon')
    .attr('class', 'grid-cell')
    .attr('points', (d) => {
      const [cx, cy] = path.centroid(d);
      return hexPoints(cx, cy, cellRadius(d, path));
    })
    .attr('fill', (d) => baseFill(d.properties))
    .attr('fill-opacity', (d) => isFocus(d.properties) ? 0.95 : 0.22)
    .attr('stroke', strokeForCell)
    .attr('stroke-width', strokeWidthForCell)
    .attr('stroke-linejoin', 'round')
    .attr('vector-effect', 'non-scaling-stroke'));
}

function buildContourGrid(rows, valueFn) {
  const lats = [...new Set(rows.map((r) => r.lat).filter(Number.isFinite))].sort((a, b) => a - b);
  const lons = [...new Set(rows.map((r) => r.lon).filter(Number.isFinite))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  const w = lons.length;
  const h = lats.length;
  const values = new Float64Array(w * h);
  const lonIx = new Map(lons.map((l, i) => [l, i]));
  const latIx = new Map(lats.map((l, i) => [l, i]));
  let valid = 0;
  for (const row of rows) {
    const i = lonIx.get(row.lon);
    const j = latIx.get(row.lat);
    if (i === undefined || j === undefined) continue;
    const v = valueFn(row);
    if (Number.isFinite(v)) {
      // Flip j so j=0 maps to highest latitude (top of grid).
      values[(h - 1 - j) * w + i] = v;
      valid += 1;
    } else {
      values[(h - 1 - j) * w + i] = 0;
    }
  }
  if (valid < 4) return null;
  return { values, w, h, lats, lons };
}

function drawContours(layer, rows, projection, colorFor, magnitudeFor) {
  const grid = buildContourGrid(rows, (row) => magnitudeFor?.(row) ?? 0);
  if (!grid) return;
  const { values, w, h, lats, lons } = grid;
  const finite = Array.from(values).filter((v) => Number.isFinite(v) && v !== 0);
  if (finite.length < 4) return;
  const extent = d3.extent(finite);
  const span = extent[1] - extent[0] || 1;
  const thresholds = d3.range(8).map((i) => extent[0] + (span * (i + 0.5)) / 8);

  const contourGen = d3.contours().size([w, h]).thresholds(thresholds);
  const polygons = contourGen(values);

  const lonRange = lons[w - 1] - lons[0];
  const latRange = lats[h - 1] - lats[0];
  const gridToScreen = ([gx, gy]) => {
    const lon = lons[0] + (gx / (w - 1)) * lonRange;
    const lat = lats[h - 1] - (gy / (h - 1)) * latRange;
    return projection([lon, lat]);
  };

  const polygonToPath = (poly) => poly.coordinates.map((ring) =>
    'M' + ring.map(gridToScreen).map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z'
  ).join(' ');

  // Render from low threshold to high so darker contours stack on top.
  polygons.forEach((poly) => {
    layer.append('path')
      .attr('class', 'contour-band')
      .attr('d', polygonToPath(poly))
      .attr('fill', colorFor({ contour_value: poly.value }))
      .attr('fill-opacity', 0.78)
      .attr('stroke', 'none');
  });
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
  cellMode = 'hex',
  contourColorFor
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

  // Layer 2: cells in the requested encoding (hex / alpha / raster / proportional / contour).
  const cellsLayer = root.append('g').attr('class', 'cells-layer');
  if (cellMode === 'contour') {
    drawContours(cellsLayer, rows, projection, contourColorFor ?? colorFor, magnitudeFor);
  } else {
    drawCellsByMode({
      layer: cellsLayer,
      features,
      path,
      mode: cellMode,
      colorFor,
      magnitudeFor,
      focus,
      pinnedId,
      selectedIds,
      onHover, onLeave, onClick,
      strokeFor
    });
  }

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

  // Layer 3: hint overlay
  svg.selectAll('.zoom-hint').remove();
  svg.append('text')
    .attr('class', 'zoom-hint')
    .attr('x', width - 10)
    .attr('y', height - 10)
    .attr('text-anchor', 'end')
    .text('drag to pan · pinch/scroll to zoom · dbl-click to reset');

  // Zoom / pan behavior — applies the same transform to root, so basemap and
  // cells stay aligned.
  const minZoom = 0.6;
  const maxZoom = 12;
  const zoom = d3.zoom()
    .scaleExtent([minZoom, maxZoom])
    .translateExtent([[-width * 0.5, -height * 0.5], [width * 1.5, height * 1.5]])
    .on('zoom', (event) => {
      root.attr('transform', event.transform);
    });

  svg.call(zoom);
  svg.on('dblclick.zoom', null); // disable d3's built-in dblclick zoom-in
  svg.on('dblclick', () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  // Programmatic focus: gently zoom toward the focus region's bbox.
  // Animate only on step navigation; on resize-driven re-renders snap so the
  // user does not see a competing transition every time they resize the window.
  if (focus?.regions) {
    const focusFeatures = features.filter((feature) => focus.regions.includes(feature.properties.region));
    if (focusFeatures.length) {
      const target = focusTransform(focusFeatures, path, width, height);
      const selection = applyFocus
        ? svg.transition().duration(640).ease(d3.easeCubicInOut)
        : svg;
      selection.call(zoom.transform, target);
    }
  }

  // Safari exposes trackpad pinch as WebKit gesture events rather than wheel
  // input, so mirror those into d3-zoom.
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
    contourColorFor: (entry) => scale(entry.contour_value),
    magnitudeFor: (row) => finiteNumber(row[key])
  });
  renderLegend(legend, { title, scale, note, calculation });
}
