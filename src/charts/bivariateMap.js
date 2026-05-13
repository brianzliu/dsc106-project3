import * as d3 from 'd3';
import { bivariateColor, bivariatePalette, neutralColor, quantileRank } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import { drawMap } from './map.js';
import { renderLegend } from './legend.js';

export function renderBivariateMap({ svg, legend, rows, width, height, warmingKey = 'tas_change', ...handlers }) {
  const landValues = rows.map((row) => finiteNumber(row.land_conversion_change)).filter((value) => value !== null);
  const warmingValues = rows.map((row) => finiteNumber(row[warmingKey])).filter((value) => value !== null);
  const landScale = d3.scaleQuantile().domain(landValues).range([0, 1, 2]);
  const warmingScale = d3.scaleQuantile().domain(warmingValues).range([0, 1, 2]);
  drawMap({
    svg, rows, width, height, ...handlers,
    colorFor: (row) => {
      const landRank = quantileRank(landScale, row.land_conversion_change);
      const warmingRank = quantileRank(warmingScale, row[warmingKey]);
      return landRank === null || warmingRank === null ? neutralColor : bivariateColor(landRank, warmingRank);
    },
    magnitudeFor: (row) => {
      const lr = quantileRank(landScale, row.land_conversion_change);
      const wr = quantileRank(warmingScale, row[warmingKey]);
      if (lr === null || wr === null) return 0;
      return lr + wr;
    }
  });

  const warmingLabel = warmingKey === 'tasmax_change' ? 'dry-season max-temperature warming' : 'mean warming';
  renderLegend(legend, {
    title: 'Land conversion + warming',
    type: 'bivariate',
    colors: bivariatePalette,
    axisLabels: { x: 'Land conversion →', y: 'Warming →' },
    labels: 'Darker red = both stronger conversion AND stronger warming in the same grid cell.',
    note: `Cells in the top-right of the legend are the ones where the most aggressive land-cover change overlaps with the strongest ${warmingLabel}.`,
    calculation: 'Land-conversion and warming values are each split into three terciles; the color combines the two tercile ranks.'
  });
}
