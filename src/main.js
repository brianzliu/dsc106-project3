import * as d3 from 'd3';
import './styles.css';
import { storySteps, toggles } from './storySteps.js';
import { prepareRows, finiteNumber } from './utils/dataTransforms.js';
import { renderOverview, renderChoropleth } from './charts/map.js';
import { renderBivariateMap } from './charts/bivariateMap.js';
import { renderSmallMultiples } from './charts/smallMultiples.js';
import { renderLinkedScatter } from './charts/scatter.js';
import { renderRiskMap } from './charts/riskMap.js';

const app = d3.select('#app');
const state = {
  rows: [],
  activeStep: 0,
  activeToggle: 'Warming',
  seasonMode: 'dry',
  pinned: null,
  hovered: null,
  brushedIds: new Set()
};

const format = d3.format('.2f');
const metrics = [
  ['land_conversion_change', 'Land conversion'],
  ['tas_change', 'Mean warming'],
  ['tasmax_change', 'Max-temperature warming'],
  ['pr_dry_change', 'Dry-season precipitation'],
  ['mrsos_dry_change', 'Dry-season soil moisture'],
  ['evspsbl_change', 'Evapotranspiration'],
  ['lai_change', 'Leaf-area response'],
  ['gpp_change', 'GPP response'],
  ['nbp_change', 'NBP / carbon uptake'],
  ['climate_stress_score', 'Climate stress score'],
  ['carbon_fragility_score', 'Carbon fragility score']
];

function metricText(row, key) {
  const value = finiteNumber(row?.[key]);
  return value === null ? 'insufficient data' : format(value);
}

function layout() {
  app.html(`
    <header class="hero">
      <p class="eyebrow">CMIP6 GFDL-ESM4 scrollytelling demo</p>
      <h1>Amazon land conversion, dry-season stress, and carbon-sink fragility</h1>
      <p class="lede">A D3 story about how uneven land conversion coincides with hotter, drier conditions that can weaken vegetation function and carbon uptake.</p>
    </header>
    <main class="scrolly">
      <section class="story-column" aria-label="Narrative steps"></section>
      <aside class="viz-column" aria-label="Sticky visualization">
        <div class="sticky-panel">
          <div class="controls">
            <div class="toggle-group" role="group" aria-label="Map mode toggles"></div>
            <label class="mode-switch">Variable mode
              <select id="season-mode"><option value="dry">Dry season</option><option value="annual">Annual when available</option></select>
            </label>
          </div>
          <h2 id="viz-title"></h2>
          <div class="viz-grid">
            <div class="map-wrap"><svg id="main-map"></svg><div id="dynamic-chart"></div></div>
            <div class="side-panel">
              <div id="legend"></div>
              <div id="detail-panel"></div>
            </div>
          </div>
        </div>
      </aside>
    </main>
    <div id="tooltip" role="status" aria-live="polite"></div>
  `);

  const stepSelection = d3.select('.story-column').selectAll('.step').data(storySteps).join('article')
    .attr('class', 'step')
    .attr('data-step', (_, i) => i)
    .html((d, i) => `<span class="step-number">${String(i + 1).padStart(2, '0')}</span><h2>${d.title}</h2>${d.body.map((p) => `<p>${p}</p>`).join('')}`);

  d3.select('.toggle-group').selectAll('button').data(toggles).join('button')
    .attr('type', 'button')
    .text((d) => d)
    .on('click', (_, d) => {
      state.activeToggle = d;
      const index = storySteps.findIndex((step) => step.toggle === d);
      if (index >= 0) {
        state.activeStep = index;
        document.querySelectorAll('.step')[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      render();
    });

  d3.select('#season-mode').on('change', (event) => {
    state.seasonMode = event.target.value;
    render();
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        state.activeStep = Number(entry.target.dataset.step);
        state.activeToggle = storySteps[state.activeStep].toggle;
        render();
      }
    });
  }, { rootMargin: '-35% 0px -45% 0px', threshold: 0.1 });
  stepSelection.nodes().forEach((node) => observer.observe(node));
}

function chartSize() {
  const wrap = document.querySelector('.map-wrap');
  return {
    width: Math.max(320, wrap.clientWidth || 720),
    height: Math.max(360, Math.min(620, window.innerHeight * 0.68))
  };
}

function showTooltip(event, row) {
  state.hovered = row;
  const tooltip = d3.select('#tooltip');
  tooltip.style('opacity', 1)
    .style('transform', `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`)
    .html(`<strong>${row.cell_id}</strong><br>${row.region ?? 'unknown region'}<br>Land conversion: ${metricText(row, 'land_conversion_change')}<br>Warming: ${metricText(row, 'tas_change')}<br>Dry-season precip.: ${metricText(row, 'pr_dry_change')}<br>Carbon fragility: ${metricText(row, 'carbon_fragility_score')}`);
  updateDetail();
}

function hideTooltip() {
  state.hovered = null;
  d3.select('#tooltip').style('opacity', 0);
  updateDetail();
}

function pinRow(row) {
  state.pinned = state.pinned?.cell_id === row.cell_id ? null : row;
  render();
}

function updateDetail() {
  const row = state.pinned ?? state.hovered;
  const panel = d3.select('#detail-panel');
  if (!row) {
    panel.html('<h3>Cell details</h3><p>Hover or click a grid cell to inspect the linked land, climate, vegetation, and carbon metrics. Click again to unpin.</p>');
    return;
  }
  panel.html(`
    <h3>${state.pinned ? 'Pinned' : 'Hovered'} cell: ${row.cell_id}</h3>
    <p class="region-chip">${row.region ?? 'unknown region'}</p>
    <dl>${metrics.map(([key, label]) => `<div><dt>${label}</dt><dd>${metricText(row, key)}</dd></div>`).join('')}</dl>
  `);
}

function render() {
  const step = storySteps[state.activeStep];
  const { width, height } = chartSize();
  const svg = d3.select('#main-map').style('display', null);
  const dynamic = d3.select('#dynamic-chart').style('display', 'none');
  const legend = d3.select('#legend');
  const common = {
    rows: state.rows,
    width,
    height,
    selectedIds: state.brushedIds,
    pinnedId: state.pinned?.cell_id,
    onHover: showTooltip,
    onLeave: hideTooltip,
    onClick: pinRow
  };

  d3.select('#viz-title').text(step.title);
  d3.selectAll('.step').classed('active', (_, i) => i === state.activeStep);
  d3.selectAll('.toggle-group button').classed('active', (d) => d === state.activeToggle);
  d3.select('#season-mode').property('value', state.seasonMode);
  dynamic.selectAll('*').remove();
  svg.selectAll('*').remove();

  if (step.mode === 'overview') renderOverview({ svg, legend, ...common });
  if (step.mode === 'land') renderChoropleth({ svg, legend, ...common, key: 'land_conversion_change', title: 'Crop + pasture change', palette: ['#fff7bc', '#7f2704'] });
  if (step.mode === 'bivariate') renderBivariateMap({ svg, legend, ...common, warmingKey: state.seasonMode === 'annual' ? 'tas_change' : 'tasmax_change' });
  if (step.mode === 'smallMultiples') {
    svg.style('display', 'none');
    dynamic.style('display', null);
    renderSmallMultiples({ container: dynamic, legend, ...common });
  }
  if (step.mode === 'evaporation') renderChoropleth({ svg, legend, ...common, key: 'evspsbl_change', title: 'Evapotranspiration change', diverging: true });
  if (step.mode === 'scatter') {
    svg.style('display', 'none');
    dynamic.style('display', null);
    renderLinkedScatter({ container: dynamic, rows: state.rows, width, height, selectedIds: state.brushedIds, pinnedId: state.pinned?.cell_id, onHover: showTooltip, onLeave: hideTooltip, onClick: pinRow, onBrush: (ids) => { state.brushedIds = ids; render(); } });
    legend.html('<div class="legend-title">Scatter encodings</div><p class="legend-note">x = climate stress score, y = GPP or LAI change, color = land conversion, size = warming.</p>');
  }
  if (step.mode === 'risk') renderRiskMap({ svg, legend, ...common });
  updateDetail();
}

async function loadData() {
  const primary = '/data/amazon_cmip6_grid.json';
  const fallback = '/data/amazon_cmip6_grid.sample.json';
  try {
    const response = await fetch(primary);
    if (!response.ok) throw new Error(`Missing ${primary}`);
    return response.json();
  } catch (error) {
    console.warn(`${error.message}; loading sample data instead.`);
    const sample = await fetch(fallback);
    return sample.json();
  }
}

layout();
loadData().then((data) => {
  state.rows = prepareRows(data);
  render();
});
window.addEventListener('resize', () => render());
