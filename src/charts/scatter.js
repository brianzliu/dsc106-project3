import * as d3 from 'd3';
import { finiteNumber } from '../utils/dataTransforms.js';
import { neutralColor } from '../utils/scales.js';
import { renderLegend } from './legend.js';
import { cellRadius, hexPoints, makeFeatureCollection, projectionFor } from './map.js';
import { getAmazonBoundary, getSouthAmerica } from '../utils/basemap.js';

let basemapPromise = null;
let amazonBoundaryPromise = null;
function ensureBasemap() {
  if (!basemapPromise) basemapPromise = getSouthAmerica().catch(() => null);
  return basemapPromise;
}
function ensureAmazonBoundary() {
  if (!amazonBoundaryPromise) amazonBoundaryPromise = getAmazonBoundary().catch(() => null);
  return amazonBoundaryPromise;
}

function yMetricDefinition(yKey) {
  if (yKey === 'gpp_change') {
    return 'Gross primary production (GPP) is the carbon vegetation fixes through photosynthesis. Each point is one grid cell.';
  }
  if (yKey === 'lai_change') {
    return 'Leaf area index (LAI) is the modeled one-sided leaf area per unit ground area — a structural measure of canopy cover. Each point is one grid cell.';
  }
  return 'Each point is one grid cell. Evapotranspiration change is used here as a vegetation-function proxy.';
}

function yMetricCalculation(yKey) {
  if (yKey === 'gpp_change') return 'Later-period GPP minus earlier-period GPP for each grid cell.';
  if (yKey === 'lai_change') return 'Later-period LAI minus earlier-period LAI for each grid cell.';
  return 'Later-period evapotranspiration minus earlier-period evapotranspiration for each grid cell.';
}

function binnedYColorScale(data, yVal) {
  const extent = d3.extent(data, yVal);
  const domain = [...extent];
  if (domain[0] === domain[1]) {
    domain[0] -= 0.5;
    domain[1] += 0.5;
  }
  // Earth-and-heat palette to harmonize with bivariate map: greens = healthy gain, oranges/reds = weakening.
  return d3.scaleQuantize()
    .domain(domain)
    .range(['#7a2a14', '#b25333', '#d99466', '#e6d3a8', '#7fb59a', '#1f6b58']);
}

function binnedLegendItems(scale) {
  const format = d3.format('.2~f');
  return scale.range().map((color) => {
    const [start, end] = scale.invertExtent(color);
    return [`${format(start)} to ${format(end)}`, color];
  });
}

const summaryMetrics = [
  { key: 'land_conversion_change', label: 'Land conversion', hint: 'How much grid-cell land cover shifted toward crops and pasture between periods.' },
  { key: 'tas_change', label: 'Mean warming (°C)', hint: 'Change in annual or dry-season mean near-surface air temperature, depending on the dataset.' },
  { key: 'mrsos_dry_change', label: 'Dry soil moisture', hint: 'Change in near-surface soil moisture averaged over the dry season.' },
  { key: 'gpp_change', label: 'GPP shift', hint: 'Change in gross primary production: carbon uptake by vegetation via photosynthesis.' },
  { key: 'nbp_change', label: 'NBP shift', hint: 'Change in net biome production: net carbon exchange between land and atmosphere (uptake minus release).' }
];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort(d3.ascending);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function renderSelectionSummary(container, allRows, selectedIds) {
  container.selectAll('*').remove();

  if (!selectedIds || selectedIds.size === 0) {
    container.append('div').attr('class', 'selection-summary-empty')
      .text('No selection yet.');
    return;
  }

  const selectedRows = allRows.filter((row) => selectedIds.has(row.cell_id));
  const header = container.append('div').attr('class', 'selection-summary-head');
  header.append('span').attr('class', 'selection-count').text(selectedRows.length);
  header.append('span').attr('class', 'selection-count-label').text(selectedRows.length === 1 ? 'cell selected' : 'cells selected');

  const table = container.append('div').attr('class', 'selection-summary-rows');
  const format = d3.format('.2~f');

  summaryMetrics.forEach(({ key, label, hint }) => {
    const allVals = allRows.map((row) => finiteNumber(row[key])).filter((v) => v !== null);
    const selVals = selectedRows.map((row) => finiteNumber(row[key])).filter((v) => v !== null);
    if (allVals.length < 4 || selVals.length === 0) return;

    const extent = d3.extent(allVals);
    const range = extent[1] - extent[0] || 1;
    const basinMed = median(allVals);
    const selMed = median(selVals);

    const row = table.append('div').attr('class', 'summary-row');
    row.append('div').attr('class', 'summary-row-label').text(label).attr('title', hint ?? '');

    const track = row.append('div').attr('class', 'summary-row-track');
    track.append('div').attr('class', 'summary-row-axis');

    const basinPct = ((basinMed - extent[0]) / range) * 100;
    const selPct = ((selMed - extent[0]) / range) * 100;
    const fromPct = Math.min(basinPct, selPct);
    const toPct = Math.max(basinPct, selPct);

    track.append('div')
      .attr('class', 'summary-row-link')
      .style('left', `${fromPct}%`)
      .style('width', `${toPct - fromPct}%`);
    track.append('div')
      .attr('class', 'summary-row-basin')
      .style('left', `${basinPct}%`)
      .attr('title', `Basin median: ${format(basinMed)}`);
    track.append('div')
      .attr('class', 'summary-row-selection')
      .style('left', `${selPct}%`)
      .attr('title', `Selection median: ${format(selMed)}`);

    row.append('div').attr('class', 'summary-row-value').text(format(selMed));
  });

  const legend = container.append('div').attr('class', 'selection-summary-legend');
  legend.append('span').attr('class', 'legend-chip legend-chip-basin').text('basin median');
  legend.append('span').attr('class', 'legend-chip legend-chip-selection').text('your selection');
}

function renderMiniMap(container, rows, { onCellLink }) {
  container.selectAll('*').remove();
  const w = container.node().clientWidth || 260;
  const h = container.node().clientHeight || 320;
  const svg = container.append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', 'Linked Amazon map');

  const projection = projectionFor(rows, w, h, 10);
  const path = d3.geoPath(projection);
  const features = makeFeatureCollection(rows).features;

  const baseLayer = svg.append('g').attr('pointer-events', 'none');
  ensureBasemap().then((sa) => {
    if (!sa) return;
    baseLayer.append('path').datum(sa).attr('d', path)
      .attr('fill', '#f1ead8').attr('stroke', 'none').attr('opacity', 0.92);
  });

  const cellsLayer = svg.append('g').attr('class', 'mini-cells-layer');
  cellsLayer.selectAll('circle.mini-cell')
    .data(features, (d) => d.id)
    .join('circle')
    .attr('class', 'mini-cell')
    .attr('cx', (d) => path.centroid(d)[0])
    .attr('cy', (d) => path.centroid(d)[1])
    .attr('r', (d) => cellRadius(d, path) * 0.92)
    .attr('fill', '#d9cdb2')
    .attr('fill-opacity', 0.55)
    .attr('stroke', 'rgba(20,31,22,0.16)')
    .attr('stroke-width', 0.35);

  // Boundary stays on top.
  const boundaryLayer = svg.append('g').attr('pointer-events', 'none');
  ensureAmazonBoundary().then((amazon) => {
    if (!amazon) return;
    boundaryLayer.append('path').datum(amazon).attr('d', path)
      .attr('fill', 'none').attr('stroke', '#0f2013').attr('stroke-width', 1.4).attr('stroke-opacity', 0.95)
      .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('vector-effect', 'non-scaling-stroke');
  });

  function highlight({ hoveredId, selectedIds = new Set() }) {
    cellsLayer.selectAll('circle.mini-cell')
      .attr('fill', (d) => {
        if (d.id === hoveredId) return '#b84f16';
        if (selectedIds.has(d.id)) return '#1c3820';
        return '#d9cdb2';
      })
      .attr('fill-opacity', (d) => (d.id === hoveredId || selectedIds.has(d.id) ? 0.9 : 0.45))
      .attr('stroke', (d) => (d.id === hoveredId || selectedIds.has(d.id) ? '#111827' : 'rgba(20,31,22,0.18)'))
      .attr('stroke-width', (d) => (d.id === hoveredId || selectedIds.has(d.id) ? 1.05 : 0.42));
  }

  onCellLink?.(highlight);
  return highlight;
}

export function renderLinkedScatter({
  container, legend, rows, width, height,
  selectedIds = new Set(), pinnedId,
  onHover, onLeave, onClick, onBrush
}) {
  container.selectAll('*').remove();

  const shell = container.append('div').attr('class', 'scatter-shell');
  shell.append('p')
    .attr('class', 'scatter-instruction')
    .text('Brush or hover points on the scatter — the map and summary stay linked. Dot size scales with mean warming (°C).');
  const scatterCard = shell.append('div').attr('class', 'scatter-card');
  const scatterStage = scatterCard.append('div').attr('class', 'scatter-stage');

  const mapCard = shell.append('div').attr('class', 'scatter-mini');
  const mapHolder = mapCard.append('div').attr('class', 'scatter-mini-map');
  const summaryHolder = mapCard.append('div').attr('class', 'selection-summary');

  const scatterW = Math.max(320, Math.floor(width * 0.62));
  const scatterH = Math.max(320, height - 24);
  const margin = { top: 32, right: 24, bottom: 78, left: 72 };

  const yKey = rows.some((r) => finiteNumber(r.gpp_change) !== null) ? 'gpp_change'
    : rows.some((r) => finiteNumber(r.lai_change) !== null) ? 'lai_change'
    : 'evspsbl_change';
  const yLabel = yKey === 'evspsbl_change'
    ? 'Evapotranspiration change (vegetation-function proxy)'
    : yKey === 'gpp_change' ? 'GPP change' : 'LAI change';

  const svg = scatterStage.append('svg')
    .attr('viewBox', `0 0 ${scatterW} ${scatterH}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', yKey === 'gpp_change'
      ? 'Scatterplot of climate stress versus change in gross primary production (GPP)'
      : yKey === 'lai_change'
        ? 'Scatterplot of climate stress versus change in leaf area index (LAI)'
        : 'Scatterplot of climate stress versus evapotranspiration change');

  const yVal = (row) => finiteNumber(row[yKey]);
  const data = rows.filter((row) => finiteNumber(row.climate_stress_score) !== null && yVal(row) !== null);

  const stressIncludesEvap = rows.some((r) => finiteNumber(r.evspsbl_change) !== null);
  const climateStressSublabel = stressIncludesEvap
    ? 'Standardized warming plus dry-season drying, with weaker evapotranspiration folded in when available—higher values mean hotter, drier, less buffered cells.'
    : 'Standardized warming plus dry-season drying (less rain, drier soil, and drier air when those variables exist)—higher values mean hotter, drier cells.';

  if (!data.length) {
    svg.append('text').attr('x', scatterW / 2).attr('y', scatterH / 2)
      .attr('text-anchor', 'middle').attr('class', 'chart-note')
      .text('No data available for this scatterplot.');
    return;
  }

  const x = d3.scaleLinear().domain(d3.extent(data, (d) => d.climate_stress_score)).nice().range([margin.left, scatterW - margin.right]);
  const y = d3.scaleLinear().domain(d3.extent(data, yVal)).nice().range([scatterH - margin.bottom, margin.top]);
  const color = binnedYColorScale(data, yVal);
  const sizeExtent = d3.extent(rows, (d) => finiteNumber(d.tas_change)).map((d) => d ?? 0);
  if (sizeExtent[0] === sizeExtent[1]) sizeExtent[1] = sizeExtent[0] + 0.001;
  const size = d3.scaleSqrt().domain(sizeExtent).range([5.5, 16]);

  // Quadrant background: stress > 0 AND at/below-zero productivity change — lower-right visually.
  const zeroX = x.domain()[0] <= 0 && x.domain()[1] >= 0 ? x(0) : null;
  const zeroY = y.domain()[0] <= 0 && y.domain()[1] >= 0 ? y(0) : null;
  if (zeroX !== null && zeroY !== null) {
    svg.append('rect')
      .attr('x', zeroX).attr('y', zeroY)
      .attr('width', scatterW - margin.right - zeroX)
      .attr('height', scatterH - margin.bottom - zeroY)
      .attr('fill', 'rgba(184, 79, 22, 0.05)');
    svg.append('text')
      .attr('class', 'chart-quadrant-label')
      .attr('x', scatterW - margin.right - 8)
      .attr('y', scatterH - margin.bottom - 14)
      .attr('text-anchor', 'end')
      .text('high stress · weaker vegetation');
    svg.append('line')
      .attr('x1', zeroX).attr('x2', zeroX)
      .attr('y1', margin.top).attr('y2', scatterH - margin.bottom)
      .attr('stroke', 'rgba(20,31,22,0.18)').attr('stroke-dasharray', '3 4');
    svg.append('line')
      .attr('x1', margin.left).attr('x2', scatterW - margin.right)
      .attr('y1', zeroY).attr('y2', zeroY)
      .attr('stroke', 'rgba(20,31,22,0.18)').attr('stroke-dasharray', '3 4');
  }

  svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${scatterH - margin.bottom})`).call(d3.axisBottom(x).ticks(5));
  svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));
  svg.append('text').attr('class', 'chart-axis-label').attr('x', scatterW / 2).attr('y', scatterH - 42).attr('text-anchor', 'middle').text('Climate stress score (warmer + drier → higher)');
  svg.append('text').attr('class', 'chart-axis-sublabel').attr('x', scatterW / 2).attr('y', scatterH - 26).attr('text-anchor', 'middle').text(climateStressSublabel);

  const yTitle = svg.append('g').attr('class', 'chart-y-axis-titles').attr('transform', `translate(22, ${scatterH / 2}) rotate(-90)`);
  yTitle.append('text').attr('class', 'chart-axis-label').attr('text-anchor', 'middle').attr('y', 0).text(yLabel);
  if (yKey === 'gpp_change') {
    yTitle.append('text').attr('class', 'chart-axis-sublabel').attr('text-anchor', 'middle').attr('y', 16).text('(gross primary production)');
  } else if (yKey === 'lai_change') {
    yTitle.append('text').attr('class', 'chart-axis-sublabel').attr('text-anchor', 'middle').attr('y', 16).text('(leaf area index)');
  }

  // Linked mini-map
  let updateMini = null;
  let activeSelection = new Set(selectedIds);

  renderMiniMap(mapHolder, rows, {
    onCellLink: (fn) => {
      updateMini = fn;
      updateMini({ selectedIds: activeSelection });
    }
  });
  renderSelectionSummary(summaryHolder, rows, activeSelection);

  function applyHover(cellId) {
    if (updateMini) updateMini({ hoveredId: cellId, selectedIds: activeSelection });
  }

  function applySelection(ids) {
    activeSelection = ids;
    if (updateMini) updateMini({ selectedIds: ids });
    renderSelectionSummary(summaryHolder, rows, ids);
  }

  // Brush is appended BEFORE points so the brush overlay sits below interactive
  // circles. Drag from empty space brushes a region; hover over a point fires
  // its tooltip handler unimpeded.
  const brush = d3.brush()
    .extent([[margin.left, margin.top], [scatterW - margin.right, scatterH - margin.bottom]])
    .on('brush end', ({ selection }) => {
      if (!selection) {
        applySelection(new Set());
        onBrush?.(new Set());
        return;
      }
      const [[x0, y0], [x1, y1]] = selection;
      const ids = new Set(data.filter((d) => {
        const cx = x(d.climate_stress_score);
        const cy = y(yVal(d));
        return x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1;
      }).map((d) => d.cell_id));
      applySelection(ids);
      onBrush?.(ids);
    });
  svg.append('g').attr('class', 'brush').call(brush);

  const points = svg.append('g').attr('class', 'scatter-points').selectAll('circle')
    .data(data, (d) => d.cell_id)
    .join('circle')
    .attr('cx', (d) => x(d.climate_stress_score))
    .attr('cy', (d) => y(yVal(d)))
    .attr('r', (d) => size(finiteNumber(d.tas_change) ?? 0))
    .attr('fill', (d) => color(yVal(d)))
    .attr('stroke', (d) => d.cell_id === pinnedId || selectedIds.has(d.cell_id) ? '#111827' : 'rgba(255,255,255,0.9)')
    .attr('stroke-width', (d) => d.cell_id === pinnedId || selectedIds.has(d.cell_id) ? 2.35 : 1.05)
    .attr('opacity', 0.9);

  const hoverHaloLayer = svg.append('g').attr('class', 'scatter-hover-halo').attr('pointer-events', 'none');

  points
    .on('pointerenter', (event, d) => {
      onHover?.(event, d);
      applyHover(d.cell_id);
      const target = d3.select(event.currentTarget);
      target.attr('stroke', '#111827').attr('stroke-width', 2.35);
      const r = +target.attr('r');
      hoverHaloLayer.selectAll('*').remove();
      hoverHaloLayer.append('circle')
        .attr('cx', target.attr('cx'))
        .attr('cy', target.attr('cy'))
        .attr('r', r + 2)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(184, 79, 22, 0.8)')
        .attr('stroke-width', 1.5)
        .style('opacity', 0)
        .transition().duration(180).ease(d3.easeCubicOut)
        .attr('r', r + 10)
        .style('opacity', 1);
    })
    .on('pointermove', (event, d) => {
      onHover?.(event, d);
    })
    .on('pointerleave', (event, d) => {
      onLeave?.();
      applyHover(null);
      const isSelected = d.cell_id === pinnedId || activeSelection.has(d.cell_id);
      d3.select(event.currentTarget)
        .attr('stroke', isSelected ? '#111827' : 'rgba(255,255,255,0.9)')
        .attr('stroke-width', isSelected ? 2.35 : 1.05);
      hoverHaloLayer.selectAll('*').remove();
    })
    .on('click', (event, d) => onClick?.(d));

  renderLegend(legend, {
    title: yLabel,
    type: 'categories',
    colors: binnedLegendItems(color),
    note: yMetricDefinition(yKey),
    calculation: yMetricCalculation(yKey)
  });
}
