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
  return d3.scaleDiverging([-maxAbs, 0, maxAbs], d3.interpolateBrBG);
}

export function riskScale(rows) {
  const extent = extentFor(rows, 'carbon_fragility_score', [0, 1]);
  if (extent[0] === extent[1]) extent[1] = extent[0] + 1;
  return d3.scaleSequential(d3.interpolateMagma).domain(extent);
}

export function bivariateColor(landRank, warmingRank) {
  const palette = [
    ['#e8e8e8', '#ace4e4', '#5ac8c8'],
    ['#dfb0d6', '#a5add3', '#5698b9'],
    ['#be64ac', '#8c62aa', '#3b4994']
  ];
  return palette[landRank]?.[warmingRank] ?? neutralColor;
}

export function quantileRank(scale, value) {
  if (finiteNumber(value) === null) return null;
  return Math.max(0, Math.min(2, scale(value)));
}
