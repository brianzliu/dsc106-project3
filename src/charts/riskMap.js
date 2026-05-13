import * as d3 from 'd3';
import { finiteNumber } from '../utils/dataTransforms.js';
import { neutralColor, riskScale } from '../utils/scales.js';
import { drawMap, projectionFor } from './map.js';
import { renderLegend } from './legend.js';

export function renderRiskMap({ svg, legend, rows, width, height, mapPadding, ...handlers }) {
  const scale = riskScale(rows);
  drawMap({
    svg, rows, width, height, mapPadding, ...handlers,
    colorFor: (row) => finiteNumber(row.carbon_fragility_score) === null ? neutralColor : scale(row.carbon_fragility_score),
    contourColorFor: (entry) => scale(entry.contour_value),
    magnitudeFor: (row) => finiteNumber(row.carbon_fragility_score)
  });

  const projection = projectionFor(rows, width, height, mapPadding);
  const hotspots = rows
    .filter((row) => finiteNumber(row.carbon_fragility_score) !== null)
    .sort((a, b) => b.carbon_fragility_score - a.carbon_fragility_score)
    .slice(0, 3);

  const root = svg.select('g.map-root');
  const target = root.empty() ? svg : root;
  const labels = target.append('g').attr('class', 'hotspot-labels').attr('pointer-events', 'none')
    .selectAll('g.hotspot-label')
    .data(hotspots, (d) => d.cell_id)
    .join('g')
    .attr('class', 'hotspot-label');

  labels.each(function(row, index) {
    const [x, y] = projection([row.lon, row.lat]);
    const labelX = Math.min(width - 140, Math.max(60, x + 28));
    const labelY = Math.max(28, y - 28 - index * 6);
    const g = d3.select(this);
    g.selectAll('*').remove();
    g.append('line')
      .attr('x1', x).attr('y1', y).attr('x2', labelX - 4).attr('y2', labelY + 4)
      .attr('stroke', '#111827').attr('stroke-width', 1.1)
      .attr('vector-effect', 'non-scaling-stroke');
    g.append('circle')
      .attr('cx', x).attr('cy', y).attr('r', 3.4)
      .attr('fill', '#fffbe6').attr('stroke', '#111827').attr('stroke-width', 1.1)
      .attr('vector-effect', 'non-scaling-stroke');
    g.append('text').attr('class', 'callout-text')
      .attr('x', labelX).attr('y', labelY)
      .text(`${row.region}: ${d3.format('.2f')(row.carbon_fragility_score)}`);
  });

  renderLegend(legend, {
    title: 'Carbon fragility score',
    scale,
    note: 'Brighter cells are where land conversion, warming, dry-season stress, weakened evapotranspiration, productivity loss, and reduced NBP overlap most strongly.',
    calculation: 'Sum of standardized (z-scored) components: land conversion, warming, dry-season precipitation deficit, surface soil-moisture deficit, evapotranspiration weakening, GPP/LAI weakening, and NBP weakening. Cells must have at least three non-missing components to receive a score.'
  });
}
