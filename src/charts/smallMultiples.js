import * as d3 from 'd3';
import { divergingScale, neutralColor } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { makeFeatureCollection, projectionFor } from './map.js';
import { renderLegend } from './legend.js';

const metrics = [
  { key: 'tas_change', label: 'Warming', unit: '°C' },
  { key: 'pr_dry_change', label: 'Dry-season precipitation', unit: 'mm/day' },
  { key: 'mrsos_dry_change', label: 'Soil moisture', unit: 'kg m⁻²' },
  { key: 'hurs_dry_change', label: 'Humidity / evap.', fallback: 'evspsbl_change', unit: '%' }
];

export function renderSmallMultiples({ container, legend, rows, width, height, selectedIds = new Set(), pinnedId, onHover, onLeave, onClick }) {
  container.selectAll('*').remove();
  const cols = width < 680 ? 1 : 2;
  const chartW = (width - (cols - 1) * 14) / cols;
  const chartH = Math.max(190, (height - 40) / 2);
  const wrapper = container.append('div').attr('class', 'multiples-grid').style('grid-template-columns', `repeat(${cols}, minmax(0, 1fr))`);

  metrics.forEach((metric) => {
    const key = rows.some((row) => finiteNumber(row[metric.key]) !== null) ? metric.key : metric.fallback;
    const scale = divergingScale(rows, key);
    const panel = wrapper.append('section').attr('class', 'multiple-panel');
    panel.append('h3').text(metric.label);
    const svg = panel.append('svg').attr('viewBox', `0 0 ${chartW} ${chartH}`).attr('role', 'img').attr('aria-label', metric.label);
    const projection = projectionFor(rows, chartW, chartH);
    const path = d3.geoPath(projection);
    svg.selectAll('path').data(makeFeatureCollection(rows).features).join('path')
      .attr('class', 'grid-cell')
      .attr('d', path)
      .attr('fill', (d) => {
        const value = finiteNumber(d.properties[key]);
        return value === null ? neutralColor : scale(value);
      })
      .attr('stroke', (d) => d.id === pinnedId || selectedIds.has(d.id) ? '#111827' : '#fff')
      .attr('stroke-width', (d) => d.id === pinnedId || selectedIds.has(d.id) ? 2 : 0.5)
      .on('pointerenter', (event, d) => onHover?.(event, d.properties, key))
      .on('pointermove', (event, d) => onHover?.(event, d.properties, key))
      .on('pointerleave', () => onLeave?.())
      .on('click', (event, d) => onClick?.(d.properties));
  });
  renderLegend(legend, { title: 'Change from early to late period', scale: divergingScale(rows, 'pr_dry_change') });
}
