import * as d3 from 'd3';
import { divergingScale, neutralColor } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { makeFeatureCollection, projectionFor } from './map.js';
import { renderLegend } from './legend.js';
import { getSouthAmerica } from '../utils/basemap.js';

let basemapPromise = null;
function ensureBasemap() {
  if (!basemapPromise) basemapPromise = getSouthAmerica().catch(() => null);
  return basemapPromise;
}

// Metrics are resolved in order: prefer the primary key; fall back if all values are null.
const metrics = [
  { key: 'tas_change', label: 'Local warming (land-use effect)', unit: 'K' },
  { key: 'pr_dry_change', label: 'Dry-season precipitation', fallback: 'evspsbl_change', fallbackLabel: 'Evapotranspiration change', unit: 'mm/day' },
  { key: 'mrsos_dry_change', label: 'Dry-season soil moisture', fallback: 'evspsbl_change', fallbackLabel: 'Evapotranspiration change', unit: 'kg m⁻²' },
  { key: 'hurs_dry_change', label: 'Dry-season humidity', fallback: 'evspsbl_change', fallbackLabel: 'Evapotranspiration change', unit: '%' }
];

export function renderSmallMultiples({ container, legend, rows, width, height, selectedIds = new Set(), pinnedId, onHover, onLeave, onClick }) {
  container.selectAll('*').remove();
  const cols = width < 680 ? 1 : 2;
  const chartW = (width - (cols - 1) * 14) / cols;
  const chartH = Math.max(190, (height - 40) / 2);
  const wrapper = container.append('div').attr('class', 'multiples-grid').style('grid-template-columns', `repeat(${cols}, minmax(0, 1fr))`);

  metrics.forEach((metric) => {
    const hasData = rows.some((row) => finiteNumber(row[metric.key]) !== null);
    const key = hasData ? metric.key : (metric.fallback ?? metric.key);
    const label = hasData ? metric.label : (metric.fallbackLabel ?? metric.label);
    const scale = divergingScale(rows, key);
    const panel = wrapper.append('section').attr('class', 'multiple-panel');
    panel.append('h3').text(label);
    const svg = panel.append('svg').attr('viewBox', `0 0 ${chartW} ${chartH}`).attr('role', 'img').attr('aria-label', metric.label);
    const projection = projectionFor(rows, chartW, chartH);
    const path = d3.geoPath(projection);

    // Basemap underneath (async)
    const baseLayer = svg.append('g').attr('class', 'basemap-layer').attr('pointer-events', 'none');
    ensureBasemap().then((sa) => {
      if (!sa) return;
      baseLayer.append('path').datum(sa).attr('d', path)
        .attr('fill', '#f0e9d8').attr('stroke', '#aea08a').attr('stroke-width', 0.7).attr('opacity', 0.95);
    });

    svg.append('g').selectAll('path').data(makeFeatureCollection(rows).features).join('path')
      .attr('class', 'grid-cell')
      .attr('d', path)
      .attr('fill', (d) => {
        const value = finiteNumber(d.properties[key]);
        return value === null ? neutralColor : scale(value);
      })
      .attr('fill-opacity', 0.92)
      .attr('stroke', (d) => d.id === pinnedId || selectedIds.has(d.id) ? '#111827' : 'rgba(255,255,255,0.55)')
      .attr('stroke-width', (d) => d.id === pinnedId || selectedIds.has(d.id) ? 1.6 : 0.4)
      .attr('vector-effect', 'non-scaling-stroke')
      .on('pointerenter', (event, d) => onHover?.(event, d.properties, key))
      .on('pointermove', (event, d) => onHover?.(event, d.properties, key))
      .on('pointerleave', () => onLeave?.())
      .on('click', (event, d) => onClick?.(d.properties));
  });
  // Use the first available key for the legend scale
  const legendKey = ['tas_change', 'evspsbl_change', 'pr_dry_change'].find((k) =>
    rows.some((r) => finiteNumber(r[k]) !== null)
  ) ?? 'pr_dry_change';
  renderLegend(legend, { title: 'Change from early to late period', scale: divergingScale(rows, legendKey) });
}
