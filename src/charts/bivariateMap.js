import * as d3 from 'd3';
import { bivariateColor, neutralColor, quantileRank } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { drawMap } from './map.js';
import { renderLegend } from './legend.js';

export function renderBivariateMap({ svg, legend, rows, width, height, warmingKey = 'tas_change', ...handlers }) {
  const landScale = d3.scaleQuantile().domain(rows.map((row) => finiteNumber(row.land_conversion_change)).filter((value) => value !== null)).range([0, 1, 2]);
  const warmingScale = d3.scaleQuantile().domain(rows.map((row) => finiteNumber(row[warmingKey])).filter((value) => value !== null)).range([0, 1, 2]);
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => {
      const landRank = quantileRank(landScale, row.land_conversion_change);
      const warmingRank = quantileRank(warmingScale, row[warmingKey]);
      return landRank === null || warmingRank === null ? neutralColor : bivariateColor(landRank, warmingRank);
    }
  });
  renderLegend(legend, {
    title: 'Land conversion + warming',
    type: 'bivariate',
    colors: [
      ['#e8e8e8', '#ace4e4', '#5ac8c8'],
      ['#dfb0d6', '#a5add3', '#5698b9'],
      ['#be64ac', '#8c62aa', '#3b4994']
    ]
  });
}
