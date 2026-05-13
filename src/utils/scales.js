import * as d3 from 'd3';
import { finiteNumber } from './dataTransforms.js';

export const neutralColor = '#d7d7d7';
export const regionColors = {
  northwest: '#8dd3c7',
  northeast: '#bebada',
  southwest: '#80b1d3',
  southeast: '#fb8072',
  other: '#bdbdbd'
};

export function extentFor(rows, key, fallback = [0, 1]) {
  const values = rows.map((row) => finiteNumber(row[key])).filter((value) => value !== null);
  return values.length ? d3.extent(values) : fallback;
}

export function sequentialScale(rows, key, range = ['#f7fbff', '#08306b']) {
  const extent = extentFor(rows, key);
  if (extent[0] === extent[1]) extent[1] = extent[0] + 1;
  return d3.scaleSequential(d3.interpolateRgb(range[0], range[1])).domain(extent);
}

export function divergingScale(rows, key) {
  const extent = extentFor(rows, key, [-1, 1]);
  const maxAbs = Math.max(Math.abs(extent[0] ?? 0), Math.abs(extent[1] ?? 0), 0.001);
  // Temperature: teal (BrBG end) = cooler/negative, brown (BrBG start) = warmer/positive.
  const interpolate =
    key === 'tas_change' ? (t) => d3.interpolateBrBG(1 - t) : d3.interpolateBrBG;
  return d3.scaleDiverging([-maxAbs, 0, maxAbs], interpolate);
}

export function riskScale(rows) {
  const extent = extentFor(rows, 'carbon_fragility_score', [0, 1]);
  if (extent[0] === extent[1]) extent[1] = extent[0] + 1;
  return d3.scaleSequential(d3.interpolateMagma).domain(extent);
}

// Bivariate palette: rows = land conversion (low → high), cols = warming (cool → hot).
// Earth tones along the land axis, heat tones along the warming axis, deep brick at both extremes.
export const bivariatePalette = [
  ['#f1ead7', '#e9b797', '#d6735c'], // low conversion
  ['#dab780', '#c98c63', '#a8543b'], // mid conversion
  ['#9c6c2c', '#7a4621', '#4d1d0e']  // high conversion
];

export function bivariateColor(landRank, warmingRank) {
  return bivariatePalette[landRank]?.[warmingRank] ?? neutralColor;
}

export function quantileRank(scale, value) {
  if (finiteNumber(value) === null) return null;
  return Math.max(0, Math.min(2, scale(value)));
}
