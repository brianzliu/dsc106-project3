import * as d3 from 'd3';

export function renderLegend(container, { title, type = 'sequential', scale, colors, labels, note, calculation, axisLabels } = {}) {
  container.selectAll('*').remove();
  container.attr('class', 'legend').attr('aria-label', title ?? 'Map legend');
  container.append('div').attr('class', 'legend-title').text(title ?? 'Legend');

  if (type === 'bivariate') {
    const shell = container.append('div').attr('class', 'bivariate-shell');
    const yAxis = shell.append('div').attr('class', 'bivariate-axis bivariate-axis-y');
    yAxis.append('span').text(axisLabels?.y ?? 'Warming →');

    const stack = shell.append('div').attr('class', 'bivariate-stack');
    const grid = stack.append('div').attr('class', 'bivariate-legend');
    // Display order: row 0 (top) = high warming, row 2 (bottom) = low warming.
    // Data order in `colors`: row = land rank, col = warming rank. Reorient so that
    // the grid reads land conversion along x and warming along y.
    for (let warmingRank = 2; warmingRank >= 0; warmingRank -= 1) {
      for (let landRank = 0; landRank < 3; landRank += 1) {
        grid.append('span')
          .attr('class', 'bivariate-cell')
          .style('background', colors[landRank][warmingRank])
          .attr('aria-label', `Land rank ${landRank + 1}, warming rank ${warmingRank + 1}`);
      }
    }
    stack.append('div').attr('class', 'bivariate-axis bivariate-axis-x')
      .append('span').text(axisLabels?.x ?? 'Land conversion →');

    if (labels) {
      container.append('div').attr('class', 'legend-note').text(labels);
    }
    if (note) {
      container.append('div').attr('class', 'legend-note legend-definition').text(note);
    }
    if (calculation) {
      container.append('div').attr('class', 'legend-note legend-calculation').text(`Calculated as: ${calculation}`);
    }
    return;
  }

  if (type === 'categories') {
    const list = container.append('div').attr('class', 'category-legend');
    colors.forEach(([name, color]) => {
      const row = list.append('div').attr('class', 'category-row');
      row.append('span').attr('class', 'category-swatch').style('background', color);
      row.append('span').attr('class', 'category-label').text(name);
    });
    if (note) {
      container.append('div').attr('class', 'legend-note legend-definition').text(note);
    }
    if (calculation) {
      container.append('div').attr('class', 'legend-note legend-calculation').text(`Calculated as: ${calculation}`);
    }
    return;
  }

  const innerW = 200;
  const height = 12;
  const svgH = 44;
  const id = `grad-${Math.random().toString(36).slice(2)}`;
  const svg = container.append('svg')
    .attr('viewBox', `0 0 ${innerW} ${svgH}`)
    .attr('preserveAspectRatio', 'xMinYMin meet')
    .attr('width', '100%')
    .attr('height', null)
    .attr('role', 'img');
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient').attr('id', id);
  const range = colors ?? d3.range(0, 1.01, 0.1).map((t) => scale?.(scale.domain ? d3.interpolateNumber(scale.domain()[0], scale.domain()[scale.domain().length - 1])(t) : t));
  range.forEach((color, index) => {
    gradient.append('stop').attr('offset', `${(index / (range.length - 1)) * 100}%`).attr('stop-color', color);
  });
  svg.append('rect').attr('width', innerW).attr('height', height).attr('rx', 6).style('fill', `url(#${id})`);
  if (scale?.domain) {
    const domain = scale.domain();
    svg.append('text').attr('x', 0).attr('y', 30).attr('class', 'legend-tick').text(d3.format('.2~f')(domain[0]));
    svg.append('text').attr('x', innerW).attr('y', 30).attr('text-anchor', 'end').attr('class', 'legend-tick').text(d3.format('.2~f')(domain[domain.length - 1]));
  }
  if (note) {
    container.append('div').attr('class', 'legend-note legend-definition').text(note);
  }
  if (calculation) {
    container.append('div').attr('class', 'legend-note legend-calculation').text(`Calculated as: ${calculation}`);
  }
}
