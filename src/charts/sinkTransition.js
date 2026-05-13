import * as d3 from 'd3';
import { finiteNumber } from '../utils/dataTransforms.js';
import { neutralColor } from '../utils/scales.js';
import { cellRadius, hexPoints, makeFeatureCollection, projectionFor, gridMagnitudeRadiusScale } from './map.js';
import { renderLegend } from './legend.js';
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

function buildChangeRows(rows, timeline) {
  if (!timeline?.cells?.length || !Array.isArray(timeline.years) || timeline.years.length < 2) {
    return { frameRows: rows, years: null, extent: [-1, 1], hotspotThreshold: null, sourceShiftThreshold: null, values: [] };
  }

  const firstIndex = 0;
  const lastIndex = timeline.years.length - 1;
  const years = [timeline.years[firstIndex], timeline.years[lastIndex]];
  const changeById = new Map();
  const values = [];

  timeline.cells.forEach((cell) => {
    const first = finiteNumber(cell.values?.[firstIndex]);
    const last = finiteNumber(cell.values?.[lastIndex]);
    const change = first === null || last === null ? null : last - first;
    changeById.set(cell.cell_id, change);
    if (change !== null) values.push(change);
  });

  const maxAbs = Math.max(0.001, ...values.map((value) => Math.abs(value)));
  const hotspotThreshold = d3.quantile(values.map((value) => Math.abs(value)).sort(d3.ascending), 0.88) ?? maxAbs;
  const sourceShiftValues = timeline.cells
    .map((cell) => {
      const first = finiteNumber(cell.values?.[firstIndex]);
      const last = finiteNumber(cell.values?.[lastIndex]);
      if (first === null || last === null) return null;
      if (last > 0) return null;
      return last - first;
    })
    .filter((value) => value !== null)
    .sort(d3.ascending);
  const sourceShiftThreshold = sourceShiftValues.length
    ? (d3.quantileSorted(sourceShiftValues, 0.28) ?? sourceShiftValues[0])
    : null;
  const frameRows = rows.map((row) => ({
    ...row,
    timeline_change: changeById.get(row.cell_id) ?? null,
    timeline_end: finiteNumber(timeline.cells.find((cell) => cell.cell_id === row.cell_id)?.values?.[lastIndex]) ?? null
  }));

  return { frameRows, years, extent: [-maxAbs, maxAbs], hotspotThreshold, sourceShiftThreshold, values };
}

function binnedChangeScale(values, extent) {
  const sorted = [...values].sort(d3.ascending);
  const quantile = (p, fallback) => d3.quantileSorted(sorted, p) ?? fallback;
  const thresholds = [
    quantile(0.12, extent[0]),
    quantile(0.30, -0.08),
    quantile(0.52, 0.12),
    quantile(0.82, extent[1])
  ];
  const colors = ['#8b5a22', '#ddb56b', '#f2efe6', '#7fbdb4', '#0f5b57'];
  return {
    colorScale: d3.scaleThreshold().domain(thresholds).range(colors),
    bounds: [extent[0], ...thresholds, extent[1]]
  };
}

function changeLegendItems(colorScale, bounds) {
  const format = d3.format('.2~f');
  const labels = [
    'Much weaker sink by 2014',
    'Slightly weaker sink by 2014',
    'Little net change',
    'Slightly stronger sink by 2014',
    'Much stronger sink by 2014'
  ];

  return colorScale.range().map((color, index) => {
    const start = bounds[index];
    const end = bounds[index + 1];
    return [`${labels[index]} (${format(start)} to ${format(end)})`, color];
  });
}

export function renderSinkTransition({
  container,
  legend,
  rows,
  width,
  height,
  timeline,
  revealPhase = 2,
  selectedIds = new Set(),
  pinnedId,
  onHover,
  onLeave,
  onClick,
  focus = null // eslint-disable-line no-unused-vars
}) {
  container.selectAll('*').remove();

  const { frameRows, years, extent, hotspotThreshold, sourceShiftThreshold, values } = buildChangeRows(rows, timeline);
  const { colorScale, bounds } = binnedChangeScale(values, extent);
  const wrapper = container.append('div').attr('class', 'sink-transition');
  const mapCard = wrapper.append('div').attr('class', 'sink-map-card');

  if (revealPhase < 2) {
    const overlay = mapCard.append('div').attr('class', 'amazon-reveal-overlay');
    overlay.append('span').attr('class', 'amazon-reveal-text').text('The Amazon');
  }
  const chartHeight = Math.max(320, height - 18);
  const svg = mapCard.append('svg')
    .attr('viewBox', `0 0 ${width} ${chartHeight}`)
    .attr('role', 'img')
    .attr('aria-label', 'Amazon carbon-balance change map from 1850 to 2014');

  const projection = projectionFor(rows, width, chartHeight, 18);
  const path = d3.geoPath(projection);
  const features = makeFeatureCollection(frameRows).features;

  const root = svg.append('g').attr('class', 'map-root');
  const basemapLayer = root.append('g').attr('class', 'basemap-layer').attr('pointer-events', 'none');
  ensureBasemap().then((southAmerica) => {
    if (!southAmerica) return;
    basemapLayer.append('path')
      .datum(southAmerica)
      .attr('d', path)
      .attr('fill', '#f2ebda')
      .attr('stroke', 'none')
      .attr('opacity', 0.98);
  });

  // Cells render first (when revealed), so the boundary can always sit above.
  const cellsLayer = root.append('g')
    .attr('class', 'cells-layer')
    .style('opacity', 0);

  const magnitudes = features
    .map((d) => Math.abs(d.properties.timeline_change ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const maxMag = magnitudes.length ? d3.max(magnitudes) : 1;
  const sizeScale = gridMagnitudeRadiusScale(maxMag);

  cellsLayer.selectAll('circle.grid-cell')
    .data(features, (d) => d.id)
    .join('circle')
    .attr('class', 'grid-cell')
    .attr('cx', (d) => path.centroid(d)[0])
    .attr('cy', (d) => path.centroid(d)[1])
    .attr('r', (d) => {
      const m = Math.abs(d.properties.timeline_change ?? 0);
      return sizeScale(Number.isFinite(m) ? m : 0);
    })
    .attr('fill', (d) => {
      if (revealPhase < 2) return 'rgba(255,255,255,0)';
      const value = finiteNumber(d.properties.timeline_change);
      return value === null ? neutralColor : colorScale(value);
    })
    .attr('fill-opacity', revealPhase < 2 ? 0 : 0.88)
    .attr('stroke', (d) => {
      if (revealPhase < 2) return 'rgba(255,255,255,0)';
      if (d.id === pinnedId || selectedIds.has(d.id)) return '#111827';
      return 'rgba(20,31,22,0.35)';
    })
    .attr('stroke-width', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 1.65 : 0.65))
    .style('pointer-events', revealPhase < 2 ? 'none' : null)
    .on('pointerenter', (event, d) => onHover?.(event, d.properties))
    .on('pointermove', (event, d) => onHover?.(event, d.properties))
    .on('pointerleave', () => onLeave?.())
    .on('click', (event, d) => onClick?.(d.properties));

  if (revealPhase >= 2) {
    cellsLayer.transition().duration(560).style('opacity', 1);
  }

  // Boundary appended LAST so it sits above the cells regardless of reveal phase.
  if (revealPhase >= 1) {
    const boundaryLayer = root.append('g')
      .attr('class', 'amazon-boundary-layer')
      .attr('pointer-events', 'none');
    ensureAmazonBoundary().then((amazonBoundary) => {
      if (!amazonBoundary) return;
      const boundaryPath = boundaryLayer.append('path')
        .datum(amazonBoundary)
        .attr('class', 'sink-outline')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', '#0f2013')
        .attr('stroke-opacity', 0.95)
        .attr('stroke-width', revealPhase < 2 ? 2.6 : 2.1)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('vector-effect', 'non-scaling-stroke');

      if (revealPhase < 2) {
        // Animate the boundary as one continuous draw-on stroke that loops
        // back to its starting point.
        const totalLength = boundaryPath.node().getTotalLength?.() ?? 0;
        if (totalLength > 0) {
          boundaryPath
            .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
            .attr('stroke-dashoffset', totalLength)
            .transition()
            .duration(1900)
            .ease(d3.easeCubicInOut)
            .attr('stroke-dashoffset', 0);
        }

      }
    });
  }

  if (revealPhase >= 2 && hotspotThreshold !== null && sourceShiftThreshold !== null) {
    const hotspotFeatures = features.filter((feature) => {
      const value = finiteNumber(feature.properties.timeline_change);
      const endValue = finiteNumber(feature.properties.timeline_end);
      return value !== null && endValue !== null && endValue <= 0 && value <= sourceShiftThreshold && Math.abs(value) >= hotspotThreshold;
    });

    const hotspotLayer = root.append('g')
      .attr('class', 'sink-hotspot-outlines')
      .attr('pointer-events', 'none');

    hotspotFeatures.forEach((feature, index) => {
      const [cx, cy] = path.centroid(feature);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
      const m = Math.abs(feature.properties.timeline_change ?? 0);
      const r = sizeScale(Number.isFinite(m) ? m : 0);

      hotspotLayer.append('circle')
        .attr('class', 'sink-hotspot-outline')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', r + 2.5) // Slightly larger to act as an outline
        .attr('fill', 'none')
        .attr('stroke', '#8b1f0f')
        .attr('stroke-width', 2.6)
        .attr('stroke-linejoin', 'round')
        .attr('vector-effect', 'non-scaling-stroke')
        .style('opacity', 0)
        .transition()
        .delay(180 + index * 18)
        .duration(420)
        .ease(d3.easeCubicOut)
        .style('opacity', 1);
    });
  }

  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .translateExtent([[-width * 0.5, -height * 0.5], [width * 1.5, height * 1.5]])
    .on('zoom', (event) => {
      root.attr('transform', event.transform);
    });

  svg.call(zoom);
  svg.on('dblclick.zoom', null);
  svg.on('dblclick', () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  if (revealPhase < 2) {
    legend.selectAll('*').remove();
    return;
  }

  renderLegend(legend, {
    title: 'Change in carbon sink strength',
    type: 'categories',
    colors: changeLegendItems(colorScale, bounds),
    note: 'Carbon sink strength here means annual net biospheric production (NBP): positive NBP means the land is taking up more carbon than it releases, while negative NBP means it is behaving more like a carbon source. Brown bins mean the cell became less sink-like by 2014; green bins mean it became more sink-like.',
    calculation: 'Carbon sink strength change = annual NBP in 2014 minus annual NBP in 1850 for each grid cell. Red-outlined cells are the ones that have flipped from absorbing carbon in 1850 to releasing it by 2014.'
  });
}
