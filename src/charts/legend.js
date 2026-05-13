import * as d3 from 'd3';

// Shared, body-anchored tooltip node. Using position: fixed on a body child
// avoids clipping by .legend-section (overflow-y: auto) and .narration-panel
// (overflow: hidden), which would otherwise crop the calculation explainer.
let sharedTooltipEl = null;
let activeBtnEl = null;

function getSharedTooltip() {
  if (sharedTooltipEl && document.body.contains(sharedTooltipEl)) {
    return sharedTooltipEl;
  }
  const el = document.createElement('div');
  el.className = 'legend-info-tooltip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  sharedTooltipEl = el;
  return el;
}

function positionTooltip(btn) {
  const tip = getSharedTooltip();
  const btnRect = btn.getBoundingClientRect();
  const margin = 8;
  const viewportW = window.innerWidth;
  // Measure after content is set; ensure visibility for measurement.
  tip.style.visibility = 'hidden';
  tip.style.opacity = '0';
  tip.style.display = 'block';
  tip.style.left = '0px';
  tip.style.top = '0px';
  const tipRect = tip.getBoundingClientRect();
  const tipW = tipRect.width;
  const tipH = tipRect.height;
  // Prefer centered below the button, clamp inside viewport.
  let left = btnRect.left + btnRect.width / 2 - tipW / 2;
  left = Math.max(margin, Math.min(left, viewportW - tipW - margin));
  let top = btnRect.bottom + 6;
  if (top + tipH + margin > window.innerHeight) {
    // Flip above the button if there's no room below.
    top = Math.max(margin, btnRect.top - tipH - 6);
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function showTooltip(btn, text) {
  const tip = getSharedTooltip();
  tip.textContent = text;
  activeBtnEl = btn;
  positionTooltip(btn);
  tip.style.visibility = 'visible';
  tip.style.opacity = '1';
}

function hideTooltip(btn) {
  if (activeBtnEl && activeBtnEl !== btn) return;
  const tip = sharedTooltipEl;
  activeBtnEl = null;
  if (!tip) return;
  tip.style.opacity = '0';
  tip.style.visibility = 'hidden';
}

if (typeof window !== 'undefined' && !window.__legendInfoTooltipBound) {
  window.__legendInfoTooltipBound = true;
  const reposition = () => {
    if (activeBtnEl && document.body.contains(activeBtnEl)) {
      positionTooltip(activeBtnEl);
    } else {
      hideTooltip();
    }
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
}

function renderTitleRow(container, title, calculation) {
  const titleRow = container.append('div').attr('class', 'legend-title-row');
  titleRow.append('span').attr('class', 'legend-title').text(title ?? 'Legend');
  if (calculation) {
    const text = `Calculated as: ${calculation}`;
    const btn = titleRow.append('button')
      .attr('class', 'legend-info-btn')
      .attr('type', 'button')
      .attr('aria-label', 'How this is calculated')
      .attr('aria-describedby', 'legend-info-tooltip')
      .text('\u24D8');
    const node = btn.node();
    const onEnter = () => showTooltip(node, text);
    const onLeave = () => hideTooltip(node);
    node.addEventListener('mouseenter', onEnter);
    node.addEventListener('mouseleave', onLeave);
    node.addEventListener('focus', onEnter);
    node.addEventListener('blur', onLeave);
  }
}

export function renderLegend(container, { title, type = 'sequential', scale, colors, labels, note, calculation, axisLabels } = {}) {
  container.selectAll('*').remove();
  container.attr('class', 'legend').attr('aria-label', title ?? 'Map legend');
  renderTitleRow(container, title, calculation);

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
    return;
  }

  const innerW = 200;
  const height = 14;
  const svgH = 44;
  const domain = scale?.domain ? scale.domain() : null;
  const isDiverging = Array.isArray(domain) && domain.length === 3;
  const binCount = colors?.length ?? (isDiverging ? 5 : 7);
  const d0 = domain ? domain[0] : 0;
  const dN = domain ? domain[domain.length - 1] : 1;

  const svg = container.append('svg')
    .attr('viewBox', `0 0 ${innerW} ${svgH}`)
    .attr('preserveAspectRatio', 'xMinYMin meet')
    .attr('width', '100%')
    .attr('height', null)
    .attr('role', 'img');

  const swatchW = innerW / binCount;
  for (let i = 0; i < binCount; i += 1) {
    const t = (i + 0.5) / binCount;
    const value = d0 + (dN - d0) * t;
    let fill;
    if (colors && colors.length) {
      fill = colors[i] ?? colors[colors.length - 1];
    } else if (scale) {
      fill = scale(value);
    } else {
      fill = '#ccc';
    }
    svg.append('rect')
      .attr('x', i * swatchW)
      .attr('y', 0)
      .attr('width', swatchW)
      .attr('height', height)
      .style('fill', fill)
      .style('shape-rendering', 'crispEdges');
  }

  if (domain) {
    const fmt = d3.format('.2~f');
    const midValue = isDiverging ? domain[1] : (d0 + dN) / 2;
    svg.append('text').attr('x', 0).attr('y', 30).attr('class', 'legend-tick').text(fmt(d0));
    svg.append('text').attr('x', innerW / 2).attr('y', 30).attr('text-anchor', 'middle').attr('class', 'legend-tick').text(fmt(midValue));
    svg.append('text').attr('x', innerW).attr('y', 30).attr('text-anchor', 'end').attr('class', 'legend-tick').text(fmt(dN));
  }
  if (note) {
    container.append('div').attr('class', 'legend-note legend-definition').text(note);
  }
}
