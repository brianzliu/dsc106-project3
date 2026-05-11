import * as d3 from 'd3';
import { finiteNumber } from '../utils/dataTransforms.js';
import { sequentialScale, neutralColor } from '../utils/scales.js';

export function renderLinkedScatter({ container, rows, width, height, selectedIds = new Set(), pinnedId, onHover, onLeave, onClick, onBrush }) {
  container.selectAll('*').remove();
  const margin = { top: 28, right: 24, bottom: 56, left: 62 };
  const svg = container.append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img').attr('aria-label', 'Climate stress and vegetation response scatterplot');

  // Choose y-axis: prefer gpp_change, then lai_change, then evspsbl_change as vegetation proxy
  const yKey = rows.some((r) => finiteNumber(r.gpp_change) !== null) ? 'gpp_change'
    : rows.some((r) => finiteNumber(r.lai_change) !== null) ? 'lai_change'
    : 'evspsbl_change';
  const yLabel = yKey === 'evspsbl_change'
    ? 'Evapotranspiration change (vegetation-function proxy)'
    : yKey === 'gpp_change' ? 'GPP change' : 'LAI change';

  const yVal = (row) => finiteNumber(row[yKey]);
  const data = rows.filter((row) => finiteNumber(row.climate_stress_score) !== null && yVal(row) !== null);

  if (!data.length) {
    svg.append('text').attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle').attr('class', 'chart-note')
      .text('No data available for this scatterplot.');
    return;
  }

  const x = d3.scaleLinear().domain(d3.extent(data, (d) => d.climate_stress_score)).nice().range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain(d3.extent(data, yVal)).nice().range([height - margin.bottom, margin.top]);
  const color = sequentialScale(rows, 'land_conversion_change', ['#edf8fb', '#88419d']);
  const size = d3.scaleSqrt().domain(d3.extent(rows, (d) => finiteNumber(d.tas_change)).map((d) => d ?? 0)).range([4, 11]);

  svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y));
  svg.append('text').attr('x', width / 2).attr('y', height - 14).attr('text-anchor', 'middle').text('Climate stress score');
  svg.append('text').attr('x', -height / 2).attr('y', 18).attr('transform', 'rotate(-90)').attr('text-anchor', 'middle').text(yLabel);

  svg.append('g').selectAll('circle').data(data, (d) => d.cell_id).join('circle')
    .attr('cx', (d) => x(d.climate_stress_score))
    .attr('cy', (d) => y(yVal(d)))
    .attr('r', (d) => size(finiteNumber(d.tas_change) ?? 0))
    .attr('fill', (d) => finiteNumber(d.land_conversion_change) === null ? neutralColor : color(d.land_conversion_change))
    .attr('stroke', (d) => d.cell_id === pinnedId || selectedIds.has(d.cell_id) ? '#111827' : '#fff')
    .attr('stroke-width', (d) => d.cell_id === pinnedId || selectedIds.has(d.cell_id) ? 2.4 : 1)
    .attr('opacity', 0.86)
    .on('pointerenter', (event, d) => onHover?.(event, d))
    .on('pointermove', (event, d) => onHover?.(event, d))
    .on('pointerleave', () => onLeave?.())
    .on('click', (event, d) => onClick?.(d));

  const brush = d3.brush()
    .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
    .on('brush end', ({ selection }) => {
      if (!selection) { onBrush?.(new Set()); return; }
      const [[x0, y0], [x1, y1]] = selection;
      const ids = new Set(data.filter((d) => {
        const cx = x(d.climate_stress_score);
        const cy = y(yVal(d));
        return x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1;
      }).map((d) => d.cell_id));
      onBrush?.(ids);
    });
  svg.append('g').attr('class', 'brush').call(brush);

  svg.append('text').attr('x', width - margin.right).attr('y', margin.top).attr('text-anchor', 'end').attr('class', 'chart-note').text('Brush to highlight cells on the map');
}
