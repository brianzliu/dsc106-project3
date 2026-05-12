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
  brushedIds: new Set(),
  sourceLabel: 'CMIP6 grid data'
};

const format = d3.format('.2f');
const metrics = [
  ['land_conversion_change', 'Land conversion'],
  ['tas_change', 'Mean warming'],
  ['tasmax_change', 'Max-temp warming'],
  ['pr_dry_change', 'Dry precip.'],
  ['mrsos_dry_change', 'Dry soil moisture'],
  ['evspsbl_change', 'Evapotranspiration'],
  ['lai_change', 'Leaf-area index'],
  ['gpp_change', 'GPP response'],
  ['nbp_change', 'NBP / carbon uptake'],
  ['climate_stress_score', 'Climate stress'],
  ['carbon_fragility_score', 'Carbon fragility']
];

function metricText(row, key) {
  const value = finiteNumber(row?.[key]);
  return value === null ? 'insufficient data' : format(value);
}

// ─── Navigation ────────────────────────────────────────────────

function goToStep(index) {
  const content = document.getElementById('narrative-content');
  if (!content) return;

  content.classList.add('fade-out');
  setTimeout(() => {
    state.activeStep = index;
    state.activeToggle = storySteps[index].toggle;
    updateNarrative();
    render();
    content.classList.remove('fade-out');
  }, 210);
}

function updateNarrative() {
  const step = storySteps[state.activeStep];
  const i = state.activeStep;
  const total = storySteps.length;

  d3.select('#step-counter').text(`STEP ${i + 1} OF ${total}`);

  d3.selectAll('.dot').attr('class', (d) =>
    d === i ? 'dot active' : d < i ? 'dot done' : 'dot inactive'
  );

  d3.select('#narrative-content').html(`
    <span class="step-badge">${String(i + 1).padStart(2, '0')}</span>
    <h2 class="step-title">${step.title}</h2>
    <div class="step-body">${step.body.map((p) => `<p>${p}</p>`).join('')}</div>
  `);

  const backBtn = document.getElementById('btn-back');
  const continueBtn = document.getElementById('btn-continue');

  backBtn.disabled = i === 0;

  if (i === total - 1) {
    continueBtn.textContent = 'Start over →';
    continueBtn.className = 'btn btn-continue is-final';
  } else {
    continueBtn.textContent = 'Continue →';
    continueBtn.className = 'btn btn-continue';
  }

  d3.selectAll('.toggle-group button').classed('active', (d) => d === state.activeToggle);
}

function updateSourceLabel() {
  d3.select('#header-eyebrow').text(state.sourceLabel);
}

// ─── Layout ────────────────────────────────────────────────────

function layout() {
  app.html(`
    <header class="app-header">
      <span class="header-eyebrow" id="header-eyebrow">CMIP6 grid data</span>
      <span class="header-title">Amazon land conversion, dry-season stress &amp; carbon-sink fragility</span>
    </header>
    <div class="walkthrough">

      <div class="narrative-panel" aria-label="Story narration">
        <div class="narrative-scroll">
          <div class="step-progress">
            <span class="step-counter" id="step-counter">STEP 1 OF ${storySteps.length}</span>
            <div class="step-dots" id="step-dots"></div>
          </div>
          <div class="narrative-content" id="narrative-content"></div>
        </div>
        <nav class="narrative-nav" aria-label="Step navigation">
          <button class="btn btn-back" id="btn-back" disabled aria-label="Previous step">← Back</button>
          <button class="btn btn-continue" id="btn-continue" aria-label="Continue to next step">Continue →</button>
        </nav>
      </div>

      <div class="viz-panel" aria-label="Visualization">
        <div class="viz-controls">
          <div class="toggle-group" role="group" aria-label="Jump to topic"></div>
          <label class="mode-switch">Season&nbsp;
            <select id="season-mode">
              <option value="dry">Dry season</option>
              <option value="annual">Annual (when available)</option>
            </select>
          </label>
        </div>
        <div class="viz-body">
          <div class="map-wrap">
            <svg id="main-map" role="img" aria-label="Amazon grid visualization"></svg>
            <div id="dynamic-chart"></div>
          </div>
          <div class="side-panel">
            <div id="legend" aria-label="Map legend"></div>
            <div id="detail-panel" aria-label="Cell detail"></div>
          </div>
        </div>
      </div>

    </div>
    <div id="tooltip" role="status" aria-live="polite"></div>
  `);

  // Step dots
  d3.select('#step-dots')
    .selectAll('.dot')
    .data(d3.range(storySteps.length))
    .join('span')
    .attr('class', 'dot inactive')
    .attr('title', (d) => storySteps[d].title)
    .on('click', (_, d) => goToStep(d));

  // Topic toggles
  d3.select('.toggle-group')
    .selectAll('button')
    .data(toggles)
    .join('button')
    .attr('type', 'button')
    .text((d) => d)
    .on('click', (_, d) => {
      const index = storySteps.findIndex((step) => step.toggle === d);
      if (index >= 0) goToStep(index);
    });

  // Season mode
  d3.select('#season-mode').on('change', (event) => {
    state.seasonMode = event.target.value;
    render();
  });

  // Back / Continue buttons
  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.activeStep > 0) goToStep(state.activeStep - 1);
  });

  document.getElementById('btn-continue').addEventListener('click', () => {
    const next = state.activeStep < storySteps.length - 1 ? state.activeStep + 1 : 0;
    goToStep(next);
  });

  updateNarrative();
  updateSourceLabel();
}

// ─── Chart sizing ───────────────────────────────────────────────

function chartSize() {
  const wrap = document.querySelector('.map-wrap');
  const w = Math.max(320, wrap?.clientWidth ?? 720);
  const h = Math.max(360, wrap?.clientHeight ?? 520);
  return { width: w, height: h };
}

// ─── Tooltip / detail ──────────────────────────────────────────

function showTooltip(event, row) {
  state.hovered = row;
  d3.select('#tooltip')
    .style('opacity', 1)
    .style('transform', `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`)
    .html(`
      <strong>${row.cell_id}</strong><br>
      ${row.region ?? 'unknown region'}<br>
      Land conv.: ${metricText(row, 'land_conversion_change')}<br>
      Warming: ${metricText(row, 'tas_change')}<br>
      Dry precip.: ${metricText(row, 'pr_dry_change')}<br>
      Fragility: ${metricText(row, 'carbon_fragility_score')}
    `);
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
    panel.html('<h3>Cell details</h3><p>Hover or click a grid cell to inspect linked land, climate, and carbon metrics. Click again to unpin.</p>');
    return;
  }
  panel.html(`
    <h3>${state.pinned ? 'Pinned' : 'Hovered'}: ${row.cell_id}</h3>
    <p class="region-chip">${row.region ?? 'unknown'}</p>
    <dl>${metrics.map(([key, label]) => `<div><dt>${label}</dt><dd>${metricText(row, key)}</dd></div>`).join('')}</dl>
  `);
}

// ─── Render ────────────────────────────────────────────────────

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

  d3.selectAll('.toggle-group button').classed('active', (d) => d === state.activeToggle);
  d3.select('#season-mode').property('value', state.seasonMode);

  dynamic.selectAll('*').remove();
  svg.selectAll('*').remove();

  if (step.mode === 'overview') {
    renderOverview({ svg, legend, ...common });
  }
  if (step.mode === 'land') {
    renderChoropleth({ svg, legend, ...common, key: 'land_conversion_change', title: 'Crop + pasture change', palette: ['#fff7bc', '#7f2704'] });
  }
  if (step.mode === 'bivariate') {
    const hasTasmax = state.rows.some((row) => finiteNumber(row.tasmax_change) !== null);
    const warmingKey = state.seasonMode === 'annual' || !hasTasmax ? 'tas_change' : 'tasmax_change';
    renderBivariateMap({ svg, legend, ...common, warmingKey });
  }
  if (step.mode === 'smallMultiples') {
    svg.style('display', 'none');
    dynamic.style('display', 'block');
    renderSmallMultiples({ container: dynamic, legend, ...common });
  }
  if (step.mode === 'evaporation') {
    renderChoropleth({ svg, legend, ...common, key: 'evspsbl_change', title: 'Evapotranspiration change', diverging: true });
  }
  if (step.mode === 'scatter') {
    svg.style('display', 'none');
    dynamic.style('display', 'block');
    renderLinkedScatter({
      container: dynamic,
      rows: state.rows,
      width,
      height,
      selectedIds: state.brushedIds,
      pinnedId: state.pinned?.cell_id,
      onHover: showTooltip,
      onLeave: hideTooltip,
      onClick: pinRow,
      onBrush: (ids) => { state.brushedIds = ids; render(); }
    });
    legend.html('<div class="legend-title">Scatter encodings</div><p class="legend-note">x = climate stress · y = GPP/LAI change · color = land conversion · size = warming</p>');
  }
  if (step.mode === 'risk') {
    renderRiskMap({ svg, legend, ...common });
  }

  updateDetail();
}

// ─── Bootstrap ─────────────────────────────────────────────────

async function loadData() {
  const candidates = [
    '/data/amazon_cmip6_grid.cesm2.json',
    '/data/amazon_cmip6_grid.hybrid.json',
    '/data/amazon_cmip6_grid.json',
    '/data/amazon_cmip6_grid.sample.json'
  ];

  for (const path of candidates) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Missing ${path}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        throw new Error(`Expected JSON at ${path}, got ${contentType || 'unknown content type'}.`);
      }
      const rows = await response.json();
      let meta = null;
      try {
        const metaResponse = await fetch(`${path}.meta.json`);
        if (metaResponse.ok) {
          const metaType = metaResponse.headers.get('content-type') ?? '';
          if (metaType.includes('json')) {
            meta = await metaResponse.json();
          }
        }
      } catch (error) {
        console.warn(`Missing ${path}.meta.json`);
      }
      return { rows, path, meta };
    } catch (error) {
      console.warn(error.message);
    }
  }

  throw new Error('No Amazon grid dataset could be loaded.');
}

layout();
loadData().then(({ rows, path, meta }) => {
  state.rows = prepareRows(rows);
  if (meta?.model) {
    state.sourceLabel = `CMIP6 ${meta.model} native grid`;
  } else if (path.includes('hybrid')) {
    state.sourceLabel = 'CMIP6 hybrid grid';
  } else if (path.includes('sample')) {
    state.sourceLabel = 'Sample grid data';
  } else {
    state.sourceLabel = 'CMIP6 story grid';
  }
  updateSourceLabel();
  render();
}).catch((error) => {
  console.error(error);
  d3.select('#detail-panel').html(`
    <h3>Data failed to load</h3>
    <p>${error.message}</p>
    <p>If this is deployed on Vercel, check that rewrites are not intercepting <code>/data/*.json</code>.</p>
  `);
  d3.select('#legend').html('<div class="legend-title">Load error</div><p class="legend-note">The app shell loaded, but the dataset request did not return JSON.</p>');
});
window.addEventListener('resize', () => render());
