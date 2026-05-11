import * as d3 from 'd3';
import { finiteNumber } from '../utils/dataTransforms.js';
import { neutralColor, riskScale } from '../utils/scales.js';
import { drawMap, projectionFor } from './map.js';
import { renderLegend } from './legend.js';

export function renderRiskMap({ svg, legend, rows, width, height, ...handlers }) {
  const scale = riskScale(rows);
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => finiteNumber(row.carbon_fragility_score) === null ? neutralColor : scale(row.carbon_fragility_score)
  });

  const projection = projectionFor(rows, width, height);
  const hotspots = rows
    .filter((row) => finiteNumber(row.carbon_fragility_score) !== null)
    .sort((a, b) => b.carbon_fragility_score - a.carbon_fragility_score)
    .slice(0, 3);

  // Append labels inside the zoom group so they pan/zoom with the cells.
  const root = svg.select('g.map-root');
  const target = root.empty() ? svg : root;
  const labels = target.selectAll('g.hotspot-label').data(hotspots, (d) => d.cell_id);
  const enter = labels.enter().append('g').attr('class', 'hotspot-label');
  enter.append('line').attr('stroke', '#111827').attr('stroke-width', 1.2).attr('vector-effect', 'non-scaling-stroke');
  enter.append('text').attr('class', 'callout-text');
  labels.merge(enter).each(function(row, index) {
    const [x, y] = projection([row.lon, row.lat]);
    const lx = Math.min(width - 130, x + 28);
    const ly = Math.max(28, y - 28 - index * 5);
    d3.select(this).select('line').attr('x1', x).attr('y1', y).attr('x2', lx - 4).attr('y2', ly + 4);
    d3.select(this).select('text').attr('x', lx).attr('y', ly).text(`${row.region}: ${d3.format('.2f')(row.carbon_fragility_score)}`);
  });
  labels.exit().remove();

  renderLegend(legend, { title: 'Carbon fragility score', scale });
}
