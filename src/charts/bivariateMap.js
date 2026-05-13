import * as d3 from 'd3';
import { bivariateColor, bivariateNeutral, bivariatePalette, quantileRank } from '../utils/scales.js';
import { finiteNumber } from '../utils/dataTransforms.js';
import {
  drawMap,
  BIVARIATE_GRID_CELL_RADIUS_RANGE,
  BIVARIATE_OVERVIEW_RADIUS_RANGE
} from './map.js';
import { renderLegend } from './legend.js';

/** One numeric warming input per row: primary story key first, then mean warming when tasmax is sparse. */
export function warmingValueForRank(row, warmingKey) {
  return finiteNumber(row[warmingKey]) ?? finiteNumber(row.tas_change);
}

export function renderBivariateMap({ svg, legend, rows, width, height, warmingKey = 'tas_change', ...handlers }) {
  // Terciles use only cells that actually have a value on each axis; cells missing one
  // (or both) variables are still rendered, just with a neutral low/low fallback fill so
  // every dot on the map reads as filled.
  const landValues = rows.map((row) => finiteNumber(row.land_conversion_change)).filter((value) => value !== null);
  const warmingValues = rows.map((row) => warmingValueForRank(row, warmingKey)).filter((value) => value !== null);
  const landScale = d3.scaleQuantile().domain(landValues).range([0, 1, 2]);
  const warmingScale = d3.scaleQuantile().domain(warmingValues).range([0, 1, 2]);
  drawMap({
    svg, rows, width, height, ...handlers,
    magnitudeRadiusRange: BIVARIATE_GRID_CELL_RADIUS_RANGE,
    overviewMagnitudeRadiusRange: BIVARIATE_OVERVIEW_RADIUS_RANGE,
    gridDefaultStroke: 'rgba(28,38,31,0.52)',
    gridDefaultStrokeWidth: 0.92,
    colorFor: (row) => {
      const landRank = quantileRank(landScale, row.land_conversion_change);
      const wVal = warmingValueForRank(row, warmingKey);
      const warmingRank = quantileRank(warmingScale, wVal);
      if (landRank === null || warmingRank === null) return bivariateNeutral;
      return bivariateColor(landRank, warmingRank);
    },
    magnitudeFor: (row) => {
      const lr = quantileRank(landScale, row.land_conversion_change);
      const wr = quantileRank(warmingScale, warmingValueForRank(row, warmingKey));
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
    note: `Darker red = stronger land conversion AND stronger ${warmingLabel} in the same grid cell.`,
    calculation: 'Land-conversion and warming values are each split into three terciles; the color combines the two tercile ranks.'
  });
}
