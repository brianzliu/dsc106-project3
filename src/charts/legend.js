import * as d3 from 'd3';
import { neutralColor } from '../utils/scales.js';

export function renderLegend(container, { title, type = 'sequential', scale, colors, labels } = {}) {
  container.selectAll('*').remove();
  container.attr('class', 'legend').attr('aria-label', title ?? 'Map legend');
  container.append('div').attr('class', 'legend-title').text(title ?? 'Legend');

  if (type === 'bivariate') {
    const grid = container.append('div').attr('class', 'bivariate-legend');
    colors.flat().forEach((color) => grid.append('span').style('background', color));
    container.append('div').attr('class', 'legend-note').text(labels ?? '↗ more land conversion and stronger warming');
    return;
  }

  const width = 180;
  const height = 12;
  const id = `grad-${Math.random().toString(36).slice(2)}`;
  const svg = container.append('svg').attr('width', width).attr('height', 44).attr('role', 'img');
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient').attr('id', id);
  const range = colors ?? d3.range(0, 1.01, 0.1).map((t) => scale?.(scale.domain ? d3.interpolateNumber(scale.domain()[0], scale.domain()[scale.domain().length - 1])(t) : t));
  range.forEach((color, index) => {
    gradient.append('stop').attr('offset', `${(index / (range.length - 1)) * 100}%`).attr('stop-color', color);
  });
  svg.append('rect').attr('width', width).attr('height', height).attr('rx', 6).style('fill', `url(#${id})`);
  if (scale?.domain) {
    const domain = scale.domain();
    svg.append('text').attr('x', 0).attr('y', 32).text(d3.format('.2~f')(domain[0]));
    svg.append('text').attr('x', width).attr('y', 32).attr('text-anchor', 'end').text(d3.format('.2~f')(domain[domain.length - 1]));
  }
  container.append('div').attr('class', 'legend-note').html(`<span class="neutral-swatch" style="background:${neutralColor}"></span> insufficient data`);
}
