import * as d3 from 'd3';
import { finiteNumber } from '../utils/dataTransforms.js';
import { neutralColor } from '../utils/scales.js';
import { cellRadius, hexPoints, makeFeatureCollection, projectionFor } from './map.js';
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

function measureCluster(cluster) {
  const cx = d3.mean(cluster.points, (point) => point.x);
  const cy = d3.mean(cluster.points, (point) => point.y);
  const meanLon = d3.mean(cluster.points, (point) => point.lon);
  const meanLat = d3.mean(cluster.points, (point) => point.lat);
  const totalSeverity = d3.sum(cluster.points, (point) => point.severity);
  const radius = Math.max(
    34,
    d3.max(cluster.points, (point) => Math.hypot(point.x - cx, point.y - cy)) + 24
  );

  return {
    ...cluster,
    cx,
    cy,
    meanLon,
    meanLat,
    totalSeverity,
    radius
  };
}

function clampCallout(cluster, width, height) {
  const margin = 18;
  return {
    ...cluster,
    cx: Math.max(cluster.radius + margin, Math.min(width - cluster.radius - margin, cluster.cx)),
    cy: Math.max(cluster.radius + margin, Math.min(height - cluster.radius - margin, cluster.cy))
  };
}

function mergeOverlappingCallouts(clusters, width, height) {
  const working = clusters.map((cluster) => measureCluster(cluster));
  let changed = true;

  while (changed) {
    changed = false;

    outer: for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const a = working[i];
        const b = working[j];
        const distance = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const minDistance = (a.radius + b.radius) * 0.94;

        if (distance < minDistance) {
          const merged = measureCluster({
            points: [...a.points, ...b.points]
          });
          working.splice(j, 1);
          working.splice(i, 1, merged);
          changed = true;
          break outer;
        }
      }
    }
  }

  return working
    .sort((a, b) => b.totalSeverity - a.totalSeverity)
    .slice(0, 4)
    .map((cluster) => clampCallout(cluster, width, height));
}

function clusterSourceShiftRegions(features, path, width, height) {
  const points = features
    .map((feature) => {
      const [x, y] = path.centroid(feature);
      return Number.isFinite(x) && Number.isFinite(y)
        ? {
            feature,
            x,
            y,
            lon: Number(feature.properties.lon),
            lat: Number(feature.properties.lat),
            severity: Math.abs(finiteNumber(feature.properties.timeline_change) ?? 0)
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.severity - a.severity);

  const clusters = [];
  const mergeDistance = 105;

  for (const point of points) {
    let target = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = Math.hypot(point.x - cluster.cx, point.y - cluster.cy);
      if (distance < mergeDistance && distance < bestDistance) {
        target = cluster;
        bestDistance = distance;
      }
    }

    if (!target) {
      clusters.push({
        points: [point],
        totalSeverity: point.severity,
        cx: point.x,
        cy: point.y,
        meanLon: point.lon,
        meanLat: point.lat
      });
      continue;
    }

    target.points.push(point);
    target.totalSeverity += point.severity;
    target.cx = d3.mean(target.points, (item) => item.x);
    target.cy = d3.mean(target.points, (item) => item.y);
    target.meanLon = d3.mean(target.points, (item) => item.lon);
    target.meanLat = d3.mean(target.points, (item) => item.lat);
  }

  return mergeOverlappingCallouts(
    clusters
    .filter((cluster) => cluster.points.length >= 2)
    .sort((a, b) => b.totalSeverity - a.totalSeverity),
    width,
    height
  );
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

  cellsLayer.selectAll('polygon.grid-cell')
    .data(features, (d) => d.id)
    .join('polygon')
    .attr('class', 'grid-cell')
    .attr('points', (d) => {
      const [cx, cy] = path.centroid(d);
      return hexPoints(cx, cy, cellRadius(d, path));
    })
    .attr('fill', (d) => {
      if (revealPhase < 2) return 'rgba(255,255,255,0)';
      const value = finiteNumber(d.properties.timeline_change);
      return value === null ? neutralColor : colorScale(value);
    })
    .attr('fill-opacity', revealPhase < 2 ? 0 : 0.95)
    .attr('stroke', (d) => {
      if (revealPhase < 2) return 'rgba(255,255,255,0)';
      if (d.id === pinnedId || selectedIds.has(d.id)) return '#111827';
      return 'rgba(20,31,22,0.18)';
    })
    .attr('stroke-width', (d) => (d.id === pinnedId || selectedIds.has(d.id) ? 1.6 : 0.4))
    .attr('stroke-linejoin', 'round')
    .attr('vector-effect', 'non-scaling-stroke')
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

    const clusters = clusterSourceShiftRegions(hotspotFeatures, path, width, chartHeight);
    const calloutLayer = root.append('g').attr('class', 'sink-callouts').attr('pointer-events', 'none');

    clusters.forEach((cluster, index) => {
      const callout = calloutLayer.append('g')
        .attr('class', 'sink-callout')
        .attr('transform', `translate(${cluster.cx}, ${cluster.cy}) scale(0.82)`)
        .style('opacity', 0);

      callout.append('circle')
        .attr('class', 'sink-callout-halo')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', cluster.radius * 0.42)
        .attr('fill', 'rgba(184, 79, 22, 0.18)')
        .attr('stroke', 'none')
        .style('opacity', 0.55)
        .transition()
        .delay(180 + index * 140)
        .duration(820)
        .ease(d3.easeCubicOut)
        .attr('r', cluster.radius);

      callout.append('circle')
        .attr('class', 'sink-callout-ring')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', cluster.radius * 0.42)
        .attr('fill', 'rgba(184, 79, 22, 0.08)')
        .attr('stroke', '#9a3d11')
        .attr('stroke-width', 3.5)
        .style('opacity', 1)
        .attr('stroke-dasharray', '7 5')
        .transition()
        .delay(180 + index * 140)
        .duration(820)
        .ease(d3.easeCubicOut)
        .attr('r', cluster.radius);

      callout.transition()
        .delay(180 + index * 140)
        .duration(820)
        .ease(d3.easeCubicOut)
        .style('opacity', 1)
        .attr('transform', `translate(${cluster.cx}, ${cluster.cy}) scale(1)`);
    });
  }

  if (revealPhase >= 2 && years) {
    svg.append('text')
      .attr('class', 'sink-year-mark')
      .attr('x', width - 22)
      .attr('y', 44)
      .attr('text-anchor', 'end')
      .text(`${years[0]} → ${years[1]}`);
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

  svg.append('text')
    .attr('class', 'zoom-hint')
    .attr('x', width - 10)
    .attr('y', chartHeight - 10)
    .attr('text-anchor', 'end')
    .text('drag to pan · pinch/scroll to zoom · dbl-click to reset');

  if (revealPhase < 2) {
    legend.selectAll('*').remove();
    return;
  }

  renderLegend(legend, {
    title: 'Change in carbon sink strength, 1850 to 2014',
    type: 'categories',
    colors: changeLegendItems(colorScale, bounds),
    note: 'Carbon sink strength here means annual net biospheric production (NBP): positive NBP means the land is taking up more carbon than it releases, while negative NBP means it is behaving more like a carbon source. Brown bins mean the cell became less sink-like by 2014; green bins mean it became more sink-like.',
    calculation: 'Carbon sink strength change = annual NBP in 2014 minus annual NBP in 1850 for each grid cell. Orange circles mark clustered regions where the shift is strongest toward source-like behavior by 2014.'
  });
}
