import * as d3 from 'd3';
import { divergingScale, neutralColor, regionColors, sequentialScale } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { renderLegend } from './legend.js';
import { getSouthAmerica } from '../utils/basemap.js';

// Cache the basemap once it loads (async). The first map render will trigger fetch.
let basemapPromise = null;
function ensureBasemap() {
  if (!basemapPromise) basemapPromise = getSouthAmerica().catch(() => null);
  return basemapPromise;
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

// Project the Amazon basin grid into the SVG with a small padding.
export function projectionFor(rows, width, height, padding = 20) {
  const fc = makeFeatureCollection(rows);
  return d3.geoMercator().fitExtent([[padding, padding], [width - padding, height - padding]], fc);
}

/**
 * Draw a map with:
 *   • Country basemap underneath (gray-on-cream)
 *   • Grid cells on top, colored by `colorFor(row)`
 *   • d3.zoom for pan/zoom (Ctrl/⌘+scroll to zoom, drag to pan)
 */
export function drawMap({
  svg, rows, width, height,
  colorFor, strokeFor,
  selectedIds = new Set(), pinnedId,
  onHover, onLeave, onClick,
  showBasemap = true
}) {
  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img');
  const projection = projectionFor(rows, width, height);
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
        .attr('stroke', '#aea08a')
        .attr('stroke-width', 0.9)
        .attr('stroke-linejoin', 'round')
        .attr('opacity', 0.95);
    });
  }

  // Layer 2: grid cells
  const cellsLayer = root.append('g').attr('class', 'cells-layer');
  cellsLayer.selectAll('path.grid-cell')
    .data(features, (d) => d.id)
    .join('path')
    .attr('class', 'grid-cell')
    .attr('d', path)
    .attr('fill', (d) => colorFor(d.properties))
    .attr('fill-opacity', 0.9)
    .attr('stroke', (d) =>
      strokeFor?.(d.properties) ?? (d.id === pinnedId
        ? '#111827'
        : selectedIds.has(d.id) ? '#111827' : 'rgba(255,255,255,0.55)')
    )
    .attr('stroke-width', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 1.8 : 0.4))
    .attr('vector-effect', 'non-scaling-stroke')
    .on('pointerenter', (event, d) => onHover?.(event, d.properties))
    .on('pointermove',  (event, d) => onHover?.(event, d.properties))
    .on('pointerleave', () => onLeave?.())
    .on('click',        (event, d) => onClick?.(d.properties));

  // Layer 3: hint overlay
  svg.selectAll('.zoom-hint').remove();
  svg.append('text')
    .attr('class', 'zoom-hint')
    .attr('x', width - 10)
    .attr('y', height - 10)
    .attr('text-anchor', 'end')
    .text('drag to pan · scroll to zoom · dbl-click to reset');

  // Zoom / pan behavior — applies the same transform to root, so basemap and
  // cells stay aligned.
  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .translateExtent([[-width * 0.5, -height * 0.5], [width * 1.5, height * 1.5]])
    .on('zoom', (event) => {
      root.attr('transform', event.transform);
    });

  svg.call(zoom);
  svg.on('dblclick.zoom', null); // disable d3's built-in dblclick zoom-in
  svg.on('dblclick', () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
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
      ['northwest', regionColors.northwest],
      ['northeast', regionColors.northeast],
      ['southwest', regionColors.southwest],
      ['southeast', regionColors.southeast]
    ]
  });
}

export function renderChoropleth({
  svg, legend, rows, width, height,
  key, title, palette = ['#f7fcf5', '#00441b'], diverging = false,
  ...handlers
}) {
  const scale = diverging ? divergingScale(rows, key) : sequentialScale(rows, key, palette);
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => {
      const value = finiteNumber(row[key]);
      return value === null ? neutralColor : scale(value);
    }
  });
  renderLegend(legend, { title, scale });
}
