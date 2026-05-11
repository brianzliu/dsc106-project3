import * as d3 from 'd3';
import { divergingScale, neutralColor, regionColors, sequentialScale } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { renderLegend } from './legend.js';

export function makeFeatureCollection(rows) {
  return { type: 'FeatureCollection', features: rows.map((row) => ({ type: 'Feature', id: row.cell_id, properties: row, geometry: row.geometry })) };
}

export function projectionFor(rows, width, height) {
  const fc = makeFeatureCollection(rows);
  return d3.geoMercator().fitExtent([[18, 18], [width - 18, height - 18]], fc);
}

export function drawMap({ svg, rows, width, height, colorFor, selectedIds = new Set(), pinnedId, onHover, onLeave, onClick, strokeFor }) {
  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img');
  const projection = projectionFor(rows, width, height);
  const path = d3.geoPath(projection);
  const features = makeFeatureCollection(rows).features;

  const cells = svg.selectAll('path.grid-cell').data(features, (d) => d.id);
  cells.join(
    (enter) => enter.append('path').attr('class', 'grid-cell').attr('d', path).attr('fill', neutralColor),
    (update) => update,
    (exit) => exit.remove()
  )
    .attr('d', path)
    .transition().duration(500)
    .attr('fill', (d) => colorFor(d.properties))
    .attr('stroke', (d) => strokeFor?.(d.properties) ?? (d.id === pinnedId ? '#111827' : selectedIds.has(d.id) ? '#111827' : '#ffffff'))
    .attr('stroke-width', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 2.1 : 0.7));

  svg.selectAll('path.grid-cell')
    .on('pointerenter', (event, d) => onHover?.(event, d.properties))
    .on('pointermove', (event, d) => onHover?.(event, d.properties))
    .on('pointerleave', () => onLeave?.())
    .on('click', (event, d) => onClick?.(d.properties));
}

export function renderOverview({ svg, legend, rows, width, height, ...handlers }) {
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => regionColors[row.region] ?? regionColors.other,
    strokeFor: (row) => ['northeast', 'southeast'].includes(row.region) ? '#3b0764' : '#fff'
  });
  renderLegend(legend, { title: 'Amazon regions', colors: Object.values(regionColors) });
}

export function renderChoropleth({ svg, legend, rows, width, height, key, title, palette = ['#f7fcf5', '#00441b'], diverging = false, ...handlers }) {
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
