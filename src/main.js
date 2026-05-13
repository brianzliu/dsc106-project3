import * as d3 from 'd3';
import './styles.css';
import { storySteps } from './storySteps.js';
import { prepareRows, finiteNumber } from './utils/dataTransforms.js';
import { renderOverview, renderChoropleth } from './charts/map.js';
import { renderBivariateMap } from './charts/bivariateMap.js';
import { renderSmallMultiples } from './charts/smallMultiples.js';
import { renderLinkedScatter } from './charts/scatter.js';
import { renderRiskMap } from './charts/riskMap.js';
import { renderSinkTransition } from './charts/sinkTransition.js';

const app = d3.select('#app');
const state = {
  rows: [],
  activeStep: 0,
  introVisible: true,
  /** True after grid + timeline load succeeded (viz can render). */
  dataReady: false,
  /** True if the initial dataset fetch failed; allows leaving the sink step. */
  initialLoadFailed: false,
  comparisonPeriods: {
    early: 'Earlier period',
    late: 'Later period'
  },
  pinnedId: null,
  hoveredId: null,
  brushedIds: new Set(),
  timeline: null,
  timelineByCell: new Map(),
  sinkRevealPhase: 2,
  sinkIntroReady: false,
  smallMultiplesSub: 0,
  applyFocus: false
};

let sinkRevealTimers = [];

const format = d3.format('.2f');

// ─── Step-aware tooltip configuration ──────────────────────────────
// Each entry describes what the tooltip should lead with for a given step mode.
const tooltipFocus = {
  sinkTransition: {
    focus: { key: 'timeline_change', label: 'Net biome production (NBP) change, 1850 → 2014', unit: 'kg C m⁻² yr⁻¹' },
    sparkline: true,
    related: [
      ['land_conversion_change', 'Land conversion'],
      ['tas_change', 'Mean warming (°C)'],
      ['nbp_change', 'Period-mean net biome production (NBP) shift']
    ]
  },
  land: {
    focus: { key: 'land_conversion_change', label: 'Crop + pasture change' },
    sparkline: false,
    related: [
      ['tas_change', 'Mean warming (°C)'],
      ['pr_dry_change', 'Dry-season precip.'],
      ['nbp_change', 'Net biome production (NBP) shift']
    ]
  },
  bivariate: {
    focusPair: [
      { key: 'land_conversion_change', label: 'Land conversion' },
      { key: 'tasmax_change', fallback: 'tas_change', label: 'Warming (°C)' }
    ],
    sparkline: false,
    related: [
      ['pr_dry_change', 'Dry precip.'],
      ['mrsos_dry_change', 'Dry soil moisture'],
      ['gpp_change', 'Gross primary production (GPP) shift']
    ]
  },
  smallMultiples: {
    // Resolved dynamically based on the active sub-step.
    dynamic: true,
    sparkline: false
  },
  evaporation: {
    focus: { key: 'evspsbl_change', label: 'Evapotranspiration change' },
    sparkline: false,
    related: [
      ['tas_change', 'Mean warming (°C)'],
      ['lai_change', 'Leaf-area index'],
      ['gpp_change', 'Gross primary production (GPP) shift']
    ]
  },
  scatter: {
    focusPair: [
      { key: 'climate_stress_score', label: 'Climate stress score (standardized warming + drying)' },
      { key: 'gpp_change', fallback: 'lai_change', label: 'GPP or leaf area index (LAI) shift' }
    ],
    sparkline: true,
    related: [
      ['tas_change', 'Mean warming (°C)'],
      ['mrsos_dry_change', 'Dry soil moisture'],
      ['nbp_change', 'Net biome production (NBP) shift']
    ]
  },
  risk: {
    focus: { key: 'carbon_fragility_score', label: 'Carbon fragility' },
    sparkline: true,
    related: [
      ['land_conversion_change', 'Land conversion'],
      ['tas_change', 'Mean warming (°C)'],
      ['gpp_change', 'Gross primary production (GPP) shift'],
      ['nbp_change', 'Net biome production (NBP) shift']
    ]
  }
};

const smallMultiplesKeys = ['tas_change', 'pr_dry_change', 'mrsos_dry_change', 'hurs_dry_change'];
const smallMultiplesLabels = {
  tas_change: 'Mean dry-season temperature (°C)',
  pr_dry_change: 'Dry-season precipitation',
  mrsos_dry_change: 'Dry-season soil moisture',
  hurs_dry_change: 'Dry-season humidity'
};

function activeSubKey() {
  // Pick the first sub-key that actually exists in the data.
  const available = smallMultiplesKeys.filter((key) =>
    state.rows.some((row) => finiteNumber(row[key]) !== null)
  );
  if (!available.length) return null;
  return available[Math.min(state.smallMultiplesSub, available.length - 1)];
}

function summarizeYearRange(years, fallback) {
  if (!Array.isArray(years) || years.length === 0) return fallback;
  const numericYears = years.filter((year) => Number.isFinite(year));
  if (!numericYears.length) return fallback;
  return `${d3.min(numericYears)}-${d3.max(numericYears)}`;
}

function clearSinkRevealTimers() {
  sinkRevealTimers.forEach((timer) => window.clearTimeout(timer));
  sinkRevealTimers = [];
}

function startSinkReveal() {
  clearSinkRevealTimers();
  state.sinkIntroReady = false;
  state.sinkRevealPhase = 1;
  render();
  syncContinueAvailability();
  sinkRevealTimers.push(window.setTimeout(() => {
    state.sinkRevealPhase = 2;
    state.sinkIntroReady = true;
    render();
    syncContinueAvailability();
  }, 2200));
}

function pinnedRow() {
  return state.pinnedId ? state.rows.find((row) => row.cell_id === state.pinnedId) : null;
}

// ─── Navigation ────────────────────────────────────────────────

function goToStep(index) {
  const content = document.getElementById('narrative-content');
  if (!content) return;

  content.classList.add('fade-out');
  setTimeout(() => {
    if (state.activeStep !== index) clearSinkRevealTimers();
    if (index !== storySteps.length - 1) hideOutro();
    state.activeStep = index;
    state.smallMultiplesSub = 0; // reset sub-step on step change
    updateNarrative();
    state.applyFocus = true;
    const stepId = storySteps[index]?.id;
    if (!state.introVisible && stepId === 'sink-then-now' && !state.sinkIntroReady) {
      startSinkReveal();
    } else {
      render();
    }
    state.applyFocus = false;
    content.classList.remove('fade-out');
  }, 210);
}

function syncContinueAvailability() {
  const continueBtn = document.getElementById('btn-continue');
  if (!continueBtn) return;
  const step = storySteps[state.activeStep];
  const i = state.activeStep;
  const total = storySteps.length;
  const sinkAwaitingData =
    step?.id === 'sink-then-now' &&
    !state.dataReady &&
    !state.initialLoadFailed;
  const sinkAwaitingReveal =
    step?.id === 'sink-then-now' &&
    state.dataReady &&
    !state.initialLoadFailed &&
    !state.sinkIntroReady;

  if (sinkAwaitingData || sinkAwaitingReveal) {
    continueBtn.disabled = true;
    continueBtn.classList.add('is-pending');
    continueBtn.setAttribute('aria-label', sinkAwaitingData ? 'Loading data…' : 'Loading visualization…');
    return;
  }

  continueBtn.disabled = false;
  continueBtn.classList.remove('is-pending');
  if (i === total - 1) {
    continueBtn.setAttribute('aria-label', 'Open wrap-up overlay');
  } else {
    continueBtn.setAttribute('aria-label', 'Continue to next step');
  }
}

function updateNarrative() {
  const step = storySteps[state.activeStep];
  const i = state.activeStep;
  const total = storySteps.length;

  d3.selectAll('.dot').attr('class', (d) =>
    d === i ? 'dot active' : d < i ? 'dot done' : 'dot inactive'
  );

  d3.select('#narrative-content').html(`
    <h2 class="step-title">${step.title}</h2>
    <div class="step-body">${step.body.map((p) => `<p>${p}</p>`).join('')}</div>
  `);

  const backBtn = document.getElementById('btn-back');
  const continueBtn = document.getElementById('btn-continue');

  backBtn.disabled = i === 0;

  if (i === total - 1) {
    continueBtn.textContent = 'Next →';
    continueBtn.className = 'btn btn-continue';
    continueBtn.setAttribute('aria-label', 'Open wrap-up overlay');
  } else {
    continueBtn.textContent = 'Continue →';
    continueBtn.className = 'btn btn-continue';
    continueBtn.setAttribute('aria-label', 'Continue to next step');
  }

  syncContinueAvailability();
}

function showOutro() {
  const overlay = document.getElementById('outro-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-hidden');
  overlay.classList.add('is-visible');
  overlay.setAttribute('aria-hidden', 'false');
  const back = document.getElementById('outro-back');
  if (back) back.focus({ preventScroll: true });
}

function hideOutro() {
  const overlay = document.getElementById('outro-overlay');
  if (!overlay) return;
  overlay.classList.add('is-hidden');
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  const continueBtn = document.getElementById('btn-continue');
  if (continueBtn) continueBtn.focus({ preventScroll: true });
}

function updateIntroState() {
  const overlay = document.getElementById('intro-overlay');
  const narration = document.querySelector('.narration-panel');
  if (!overlay) return;

  overlay.classList.toggle('is-hidden', !state.introVisible);
  overlay.setAttribute('aria-hidden', String(!state.introVisible));
  if (narration) narration.setAttribute('aria-hidden', String(state.introVisible));
}

// ─── Layout ────────────────────────────────────────────────────

function layout() {
  app.html(`
    <div class="walkthrough">
      <aside class="narration-panel" aria-label="Story narration">
        <div class="narration-scroll">
          <div class="narrative-wrapper">
            <div class="step-progress">
              <div class="step-dots" id="step-dots"></div>
            </div>
            <div class="narrative-content" id="narrative-content"></div>
          </div>
        </div>
        <section class="legend-section" aria-label="Legend and methods">
          <div id="legend" aria-label="Map legend"></div>
        </section>
        <nav class="narration-nav" aria-label="Step navigation">
          <button class="btn btn-back" id="btn-back" disabled aria-label="Previous step">← Back</button>
          <button class="btn btn-continue" id="btn-continue" aria-label="Continue to next step">Continue →</button>
        </nav>
      </aside>
      <div class="viz-panel" aria-label="Visualization">
        <div class="map-wrap">
          <svg id="main-map" role="img" aria-label="Amazon grid visualization"></svg>
          <div id="dynamic-chart"></div>
          <aside id="map-annotation" class="map-annotation is-hidden" aria-hidden="true"></aside>
        </div>
      </div>
    </div>
    <div class="intro-overlay intro-phase-context" id="intro-overlay" aria-hidden="false">
      <div class="intro-phase-context-panel">
        <div class="intro-context-group">
          <p class="intro-context intro-context-definition">
            <span class="intro-context-chunk intro-context-chunk--1">
              A <span class="intro-highlight intro-highlight-sink">carbon sink</span> absorbs more CO₂ from the atmosphere than it releases.
            </span>
            <span class="intro-context-chunk intro-context-chunk--2">
              A <span class="intro-highlight intro-highlight-source">carbon source</span> does the opposite — it sends more CO₂ into the air than it takes in.
            </span>
          </p>
          <p class="intro-context intro-context-stats">
            <span class="intro-context-chunk intro-context-chunk--3">
              For centuries the intact Amazon absorbed an estimated <strong>~2 billion tonnes of CO₂</strong> each year.
            </span>
            <span class="intro-context-chunk intro-context-chunk--4">
              Recently, heavily deforested parts of the eastern Amazon have been releasing roughly <strong>1.1 billion tonnes</strong> annually.
            </span>
          </p>
        </div>
        <button type="button" class="intro-next-button" id="intro-next" aria-label="Continue to headline">Next</button>
      </div>
      <div class="intro-copy">
        <p class="intro-line intro-line-first">We think of the Amazon as a <span class="intro-highlight intro-highlight-sink">carbon sink</span>.</p>
        <p class="intro-line intro-line-second">Parts of it are starting to behave like a <span class="intro-highlight intro-highlight-source">carbon source</span>.</p>
        <button class="intro-button" id="intro-enter" type="button">Enter the visualization</button>
      </div>
    </div>
    <div class="outro-overlay is-hidden" id="outro-overlay" aria-hidden="true" role="dialog" aria-labelledby="outro-tagline">
      <div class="outro-copy">
        <p class="outro-line outro-tagline" id="outro-tagline">
          These places — the brightest cells on the map — are where the Amazon is most likely to flip from <span class="outro-highlight outro-highlight-sink">sink</span> to <span class="outro-highlight outro-highlight-source">source</span> next.
        </p>
        <p class="outro-line outro-detail">
          Every stressor we walked through — clearing, warming, dry-season drought, weakened forest cooling — overlaps here. Without intervention, this is where the carbon balance breaks first.
        </p>
        <div class="outro-actions">
          <button type="button" class="outro-button outro-button-back" id="outro-back" aria-label="Return to the story">← Back to story</button>
          <button type="button" class="outro-button outro-button-restart" id="outro-restart" aria-label="Restart the story from the beginning">Start over ↺</button>
        </div>
      </div>
      <a class="outro-reference" id="outro-reference"
         href="https://www.nature.com/articles/s41586-021-03629-6"
         target="_blank" rel="noopener noreferrer"
         aria-label="Open the Gatti 2021 Nature paper in a new tab">
        Reference paper ↗
      </a>
    </div>
    <div id="tooltip" role="status" aria-live="polite"></div>
  `);

  d3.select('#step-dots')
    .selectAll('.dot')
    .data(d3.range(storySteps.length))
    .join('span')
    .attr('class', 'dot inactive')
    .attr('title', (d) => storySteps[d].title)
    .on('click', (_, d) => goToStep(d));

  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.activeStep > 0) goToStep(state.activeStep - 1);
  });

  document.getElementById('btn-continue').addEventListener('click', () => {
    if (state.activeStep >= storySteps.length - 1) {
      showOutro();
      return;
    }
    goToStep(state.activeStep + 1);
  });

  document.getElementById('outro-back').addEventListener('click', () => {
    hideOutro();
  });

  document.getElementById('outro-restart').addEventListener('click', () => {
    hideOutro();
    goToStep(0);
  });

  document.getElementById('outro-overlay').addEventListener('click', (event) => {
    if (event.target.id === 'outro-overlay') hideOutro();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const overlay = document.getElementById('outro-overlay');
    if (overlay && !overlay.classList.contains('is-hidden')) hideOutro();
  });

  document.getElementById('intro-next').addEventListener('click', () => {
    const el = document.getElementById('intro-overlay');
    if (!el || !el.classList.contains('intro-phase-context')) return;
    el.classList.remove('intro-phase-context');
    el.classList.add('intro-phase-tagline');
    const enter = document.getElementById('intro-enter');
    if (enter) enter.focus({ preventScroll: true });
  });

  document.getElementById('intro-enter').addEventListener('click', () => {
    state.introVisible = false;
    updateIntroState();
    const stepId = storySteps[state.activeStep]?.id;
    if (stepId === 'sink-then-now') {
      startSinkReveal();
    } else {
      render();
    }
  });

  updateNarrative();
  updateIntroState();
}

// ─── Chart sizing ───────────────────────────────────────────────

function chartSize() {
  const wrap = document.querySelector('.map-wrap');
  const w = Math.max(320, wrap?.clientWidth ?? 720);
  const h = Math.max(360, wrap?.clientHeight ?? 520);
  return { width: w, height: h };
}

// ─── Tooltip / detail ──────────────────────────────────────────

function percentileText(row, key) {
  const values = state.rows.map((r) => finiteNumber(r[key])).filter((v) => v !== null);
  const value = finiteNumber(row?.[key]);
  if (value === null || values.length < 4) return null;
  const rank = values.filter((v) => v <= value).length / values.length;
  const pct = Math.round(rank * 100);
  if (pct >= 95) return `top ${100 - pct + 1}% basin-wide`;
  if (pct >= 75) return `top ${100 - pct}% basin-wide`;
  if (pct <= 5) return `bottom ${pct + 1}% basin-wide`;
  if (pct <= 25) return `bottom ${pct}% basin-wide`;
  return `near the basin median`;
}

function sparklineSVG(cellId, { width = 124, height = 32 } = {}) {
  const cell = state.timelineByCell.get(cellId);
  if (!cell || !state.timeline?.years) return '';
  const values = cell.values;
  const validCount = values.reduce((n, v) => n + (finiteNumber(v) === null ? 0 : 1), 0);
  if (validCount < 2) return '';

  const years = state.timeline.years;
  const xs = d3.scaleLinear().domain([0, years.length - 1]).range([3, width - 3]);
  const cleanValues = values.map((v) => finiteNumber(v)).filter((v) => v !== null);
  const yDomain = d3.extent(cleanValues);
  if (yDomain[0] === yDomain[1]) {
    yDomain[0] -= 0.001;
    yDomain[1] += 0.001;
  }
  const ys = d3.scaleLinear().domain(yDomain).range([height - 4, 4]);

  const line = d3.line()
    .defined((_, i) => finiteNumber(values[i]) !== null)
    .x((_, i) => xs(i))
    .y((v) => ys(finiteNumber(v) ?? 0))
    .curve(d3.curveMonotoneX);
  const area = d3.area()
    .defined((_, i) => finiteNumber(values[i]) !== null)
    .x((_, i) => xs(i))
    .y0(height - 2)
    .y1((v) => ys(finiteNumber(v) ?? 0))
    .curve(d3.curveMonotoneX);

  const zeroLine = (yDomain[0] < 0 && yDomain[1] > 0)
    ? `<line x1="2" x2="${width - 2}" y1="${ys(0)}" y2="${ys(0)}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="2 3"/>`
    : '';
  const yearStart = years[0];
  const yearEnd = years[years.length - 1];

  return `
    <div class="tt-spark-wrap">
      <div class="tt-spark-meta">
        <span>NBP trajectory</span>
        <span class="tt-spark-years">${yearStart}–${yearEnd}</span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="tt-spark">
        ${zeroLine}
        <path d="${area(values)}" fill="rgba(255, 183, 137, 0.18)"></path>
        <path d="${line(values)}" fill="none" stroke="#ffb789" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </div>
  `;
}

function focusKeyForCurrent() {
  const step = storySteps[state.activeStep];
  const cfg = tooltipFocus[step.mode];
  if (cfg?.dynamic && step.mode === 'smallMultiples') {
    const key = activeSubKey();
    return key ? { key, label: smallMultiplesLabels[key] ?? key } : null;
  }
  return cfg?.focus ?? null;
}

function focusPairForCurrent() {
  const step = storySteps[state.activeStep];
  const cfg = tooltipFocus[step.mode];
  if (!cfg?.focusPair) return null;
  return cfg.focusPair.map((entry) => {
    const key = finiteNumber(state.rows[0]?.[entry.key]) === null && entry.fallback
      ? entry.fallback : entry.key;
    return { key, label: entry.label };
  });
}

function relatedKeysForCurrent() {
  const step = storySteps[state.activeStep];
  const cfg = tooltipFocus[step.mode];
  if (!cfg) return [];
  if (cfg.dynamic && step.mode === 'smallMultiples') {
    const focus = activeSubKey();
    return smallMultiplesKeys
      .filter((key) => key !== focus && state.rows.some((row) => finiteNumber(row[key]) !== null))
      .map((key) => [key, smallMultiplesLabels[key] ?? key]);
  }
  return cfg.related ?? [];
}

function renderFocusBlock(row, focus) {
  const value = finiteNumber(row[focus.key]);
  const numericText = value === null ? '—' : format(value);
  const unit = focus.unit ? ` <span class="tt-focus-unit">${focus.unit}</span>` : '';
  const percentile = percentileText(row, focus.key);
  return `
    <div class="tt-focus">
      <div class="tt-focus-label">${focus.label}</div>
      <div class="tt-focus-value">${numericText}${unit}</div>
      ${percentile ? `<div class="tt-focus-context">${percentile}</div>` : ''}
    </div>
  `;
}

function tooltipMarkup(row) {
  const step = storySteps[state.activeStep];
  const cfg = tooltipFocus[step.mode] ?? {};
  const focus = focusKeyForCurrent();
  const pair = focusPairForCurrent();
  const related = relatedKeysForCurrent();
  const spark = cfg.sparkline ? sparklineSVG(row.cell_id) : '';

  const focusBlock = pair
    ? pair.map((entry) => renderFocusBlock(row, entry)).join('')
    : focus ? renderFocusBlock(row, focus) : '';

  const relatedBlock = related.length ? `
    <dl class="tt-metrics">
      ${related.map(([key, label]) => {
        const value = finiteNumber(row[key]);
        return `<div><dt>${label}</dt><dd>${value === null ? '—' : format(value)}</dd></div>`;
      }).join('')}
    </dl>
  ` : '';

  return `
    <div class="tt-header">
      <strong>${row.cell_id}</strong>
      <span class="tt-region">${row.region ?? 'unknown region'}</span>
    </div>
    ${spark}
    <div class="tt-focus-stack">${focusBlock}</div>
    ${relatedBlock}
  `;
}

function positionTooltip(event) {
  const tooltip = d3.select('#tooltip');
  const node = tooltip.node();
  if (!node) return;
  const bounds = node.getBoundingClientRect();
  const offset = 18;
  const x = Math.max(12, Math.min(window.innerWidth - bounds.width - 12, event.clientX - bounds.width / 2));
  const y = Math.max(12, event.clientY - bounds.height - offset);
  tooltip.style('transform', `translate(${x}px, ${y}px)`);
}

function showTooltip(event, row) {
  state.hoveredId = row?.cell_id ?? null;
  d3.select('#tooltip')
    .style('opacity', 1)
    .html(tooltipMarkup(row));
  positionTooltip(event);
}

function hideTooltip() {
  state.hoveredId = null;
  d3.select('#tooltip').style('opacity', 0);
}

function pinRow(row) {
  state.pinnedId = state.pinnedId === row.cell_id ? null : row.cell_id;
  render();
}

function mapPaddingForLayout() {
  return window.innerWidth <= 860 ? 18 : 28;
}

// ─── Render ────────────────────────────────────────────────────

function updateAnnotation(step) {
  const node = document.getElementById('map-annotation');
  if (!node) return;
  node.classList.add('is-hidden');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = '';
}

function render() {
  const step = storySteps[state.activeStep];
  const { width, height } = chartSize();
  const svg = d3.select('#main-map').style('display', null);
  const dynamic = d3.select('#dynamic-chart').style('display', 'none');
  const legend = d3.select('#legend');
  d3.select('.map-wrap').selectAll('.map-overview-panel').remove();

  updateAnnotation(step);

  const common = {
    rows: state.rows,
    width,
    height,
    mapPadding: mapPaddingForLayout(),
    comparisonPeriods: state.comparisonPeriods,
    selectedIds: state.brushedIds,
    pinnedId: state.pinnedId,
    focus: step.focus ?? null,
    applyFocus: state.applyFocus,
    onHover: showTooltip,
    onLeave: hideTooltip,
    onClick: pinRow
  };

  dynamic.selectAll('*').remove();
  svg.selectAll('*').remove();

  if (step.mode === 'sinkTransition') {
    svg.style('display', 'none');
    dynamic.style('display', 'block');
    renderSinkTransition({ container: dynamic, legend, timeline: state.timeline, revealPhase: state.sinkRevealPhase, ...common });
  }
  if (step.mode === 'overview') {
    renderOverview({ svg, legend, ...common });
  }
  if (step.mode === 'land') {
    renderChoropleth({
      svg,
      legend,
      ...common,
      key: 'land_conversion_change',
      title: 'Crop + pasture change',
      palette: ['#f5efe2', '#7a3a14'],
      note: 'Where the land surface has shifted most strongly toward agriculture and pasture.',
      calculation: 'Crop-change value plus pasture-change value for each grid cell.'
    });
  }
  if (step.mode === 'bivariate') {
    const hasTasmax = state.rows.some((row) => finiteNumber(row.tasmax_change) !== null);
    const warmingKey = hasTasmax ? 'tasmax_change' : 'tas_change';
    renderBivariateMap({ svg, legend, ...common, warmingKey });
  }
  if (step.mode === 'smallMultiples') {
    svg.style('display', 'none');
    dynamic.style('display', 'block');
    renderSmallMultiples({
      container: dynamic,
      legend,
      ...common,
      activeStressorIndex: state.smallMultiplesSub,
      onSelectStressor: (index) => {
        state.smallMultiplesSub = index;
        state.applyFocus = true;
        render();
        state.applyFocus = false;
      }
    });
  }
  if (step.mode === 'evaporation') {
    renderChoropleth({
      svg,
      legend,
      ...common,
      key: 'evspsbl_change',
      title: 'Evapotranspiration change',
      diverging: true,
      note: 'Whether each grid cell is returning more or less moisture to the atmosphere over time.',
      calculation: `${state.comparisonPeriods.late} evapotranspiration minus ${state.comparisonPeriods.early} evapotranspiration for each grid cell.`
    });
  }
  if (step.mode === 'scatter') {
    svg.style('display', 'none');
    dynamic.style('display', 'block');
    renderLinkedScatter({
      container: dynamic,
      legend,
      rows: state.rows,
      width,
      height,
      selectedIds: state.brushedIds,
      pinnedId: state.pinnedId,
      onHover: showTooltip,
      onLeave: hideTooltip,
      onClick: pinRow,
      onBrush: (ids) => { state.brushedIds = ids; }
    });
  }
  if (step.mode === 'risk') {
    renderRiskMap({ svg, legend, ...common });
  }

  const legendSection = document.querySelector('.legend-section');
  if (legendSection) {
    const legendEl = document.getElementById('legend');
    const isEmpty = !legendEl || legendEl.innerHTML.trim() === '';
    legendSection.classList.toggle('legend-empty', isEmpty);
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────

async function parseJsonResponse(response, path) {
  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) {
    throw new Error(`Expected JSON at ${path}, got HTML instead.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON at ${path}, but the response could not be parsed.`);
  }
}

async function loadData() {
  const base = import.meta.env.BASE_URL;
  const candidates = [
    `${base}data/amazon_cmip6_grid.cesm2.json`,
    `${base}data/amazon_cmip6_grid.hybrid.json`,
    `${base}data/amazon_cmip6_grid.json`,
    `${base}data/amazon_cmip6_grid.sample.json`
  ];

  for (const path of candidates) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Missing ${path}`);
      const rows = await parseJsonResponse(response, path);
      let meta = null;
      try {
        const metaResponse = await fetch(`${path}.meta.json`);
        if (metaResponse.ok) {
          meta = await parseJsonResponse(metaResponse, `${path}.meta.json`);
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

async function loadTimelineData() {
  const base = import.meta.env.BASE_URL;
  const path = `${base}data/amazon_nbp_timeline.cesm2.json`;
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Missing ${path}`);
  return parseJsonResponse(response, path);
}

let resizeTimer = null;
function scheduleResizeRender() {
  if (resizeTimer) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null;
    render();
  }, 120);
}

layout();
Promise.all([
  loadData(),
  loadTimelineData().catch((error) => {
    console.warn(error.message);
    return null;
  })
]).then(([dataset, timeline]) => {
  const { rows, meta } = dataset;
  state.rows = prepareRows(rows);
  state.timeline = timeline;
  state.timelineByCell = new Map();
  if (timeline?.cells) {
    for (const cell of timeline.cells) {
      state.timelineByCell.set(cell.cell_id, cell);
    }
  }
  state.comparisonPeriods = {
    early: summarizeYearRange(meta?.early_years, 'Earlier period'),
    late: summarizeYearRange(meta?.late_years, 'Later period')
  };
  state.dataReady = true;
  render();
  syncContinueAvailability();
}).catch((error) => {
  console.error(error);
  state.initialLoadFailed = true;
  d3.select('#narrative-content').html(`
    <h2 class="step-title">Data failed to load</h2>
    <div class="step-body">
      <p>${error.message}</p>
      <p>If this is deployed on Vercel, check that rewrites are not intercepting <code>/data/*.json</code>.</p>
    </div>
  `);
  d3.select('#legend').html('<div class="legend-title">Load error</div><p class="legend-note">The app shell loaded, but the dataset request did not return JSON.</p>');
  syncContinueAvailability();
});
window.addEventListener('resize', scheduleResizeRender);
