// Progress modal: stacked C/W/N bars per subject, drill into per-strand bars.
// Uses d3 (lazy-loaded from CDN) for smooth transitions; falls back to CSS bars.

import * as store from './store.js?v=1789083176';

const COLOUR = { C: '#16a34a', W: '#f59e0b', N: '#dc2626' };
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let d3p = null;
function loadD3() {
  if (d3p) return d3p;
  d3p = new Promise((res) => {
    if (window.d3) return res(window.d3);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
    s.onload = () => res(window.d3 || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return d3p;
}

const pct = (d) => { const t = (d.C + d.W + d.N) || 1; return { C: d.C * 100 / t, W: d.W * 100 / t, N: d.N * 100 / t }; };

function render(container, d3, rows, onClick) {
  if (!d3) return renderPlain(container, rows, onClick);
  const RIGHT = 58, rowH = 16, gap = 30, top = 8;
  const W = container.clientWidth || 560;
  const chartW = Math.max(120, W - RIGHT);
  const height = rows.length * (rowH + gap) + top;
  const x = (p) => (p / 100) * chartW;
  const yBar = (i) => top + i * (rowH + gap) + 18;

  let svg = d3.select(container).select('svg');
  if (svg.empty()) svg = d3.select(container).append('svg');
  svg.attr('width', W).attr('viewBox', `0 0 ${W} ${height}`).transition().duration(400).attr('height', height);

  const sel = svg.selectAll('g.pg-row').data(rows, (d) => d.label);
  sel.exit().transition().duration(250).style('opacity', 0).remove();
  const enter = sel.enter().append('g').attr('class', 'pg-row').style('opacity', 0);
  enter.append('text').attr('class', 'pg-label');
  enter.append('rect').attr('class', 'pg-track').attr('rx', 3);
  enter.append('text').attr('class', 'pg-pct');
  enter.append('rect').attr('class', 'pg-hit').attr('fill', 'transparent');   // full-row click target
  const all = enter.merge(sel);
  all.transition().duration(400).style('opacity', 1);

  all.each(function (d, i) {
    const p = pct(d);
    const g = d3.select(this);
    g.select('text.pg-label').attr('x', 0).attr('y', yBar(i) - 6).text(d.label);
    g.select('rect.pg-track').attr('x', 0).attr('y', yBar(i)).attr('height', rowH).attr('width', chartW);
    g.select('text.pg-pct').attr('x', W).attr('y', yBar(i) + rowH - 3).attr('text-anchor', 'end').text(Math.round(p.C) + '%');
    g.select('rect.pg-hit').attr('x', 0).attr('y', yBar(i) - 22).attr('width', W).attr('height', rowH + 28);
    let acc = 0;
    const segs = ['C', 'W', 'N'].map((k) => { const s = { k, x0: acc, w: p[k] }; acc += p[k]; return s; });
    const rects = g.selectAll('rect.pg-seg').data(segs, (s) => s.k);
    rects.enter().append('rect').attr('class', 'pg-seg').attr('height', rowH).attr('y', yBar(i)).attr('x', (s) => x(s.x0)).attr('width', 0).attr('fill', (s) => COLOUR[s.k])
      .merge(rects).attr('y', yBar(i)).attr('height', rowH).attr('fill', (s) => COLOUR[s.k])
      .transition().duration(600).ease(d3.easeCubicOut).attr('x', (s) => x(s.x0)).attr('width', (s) => x(s.w));
  });

  all.style('cursor', onClick ? 'pointer' : 'default').on('click', null).on('mouseenter', null).on('mouseleave', null);
  if (onClick) {
    all.on('click', (_e, d) => onClick(d));
    all.on('mouseenter', function () { d3.select(this).select('.pg-track').classed('hot', true); });
    all.on('mouseleave', function () { d3.select(this).select('.pg-track').classed('hot', false); });
  }
}

function renderPlain(container, rows, onClick) {
  container.innerHTML = rows.map((d, i) => {
    const p = pct(d);
    return `<div class="pg-prow ${onClick ? 'click' : ''}" data-i="${i}">
      <div class="pg-plabel">${esc(d.label)} <span class="pg-ppct">${Math.round(p.C)}%</span></div>
      <div class="pg-pbar">
        <span style="width:${p.C}%;background:${COLOUR.C}"></span>
        <span style="width:${p.W}%;background:${COLOUR.W}"></span>
        <span style="width:${p.N}%;background:${COLOUR.N}"></span>
      </div></div>`;
  }).join('');
  if (onClick) container.querySelectorAll('.pg-prow').forEach((r) => r.onclick = () => onClick(rows[+r.dataset.i]));
}

export async function openProgress() {
  const modal = el(`<div class="modal-bg"><div class="modal progress-modal">
    <div class="pg-head">
      <button class="pg-back" hidden aria-label="Back">‹</button>
      <h2 id="pg-title">Progress</h2>
      <button class="btn ghost sm" data-x>Close</button>
    </div>
    <div class="pg-sub" id="pg-sub">
      <span id="pg-overall"></span>
      <span class="pg-hint" id="pg-hint">👆 Tap a subject to see its topics</span>
    </div>
    <div id="pg-chart" class="pg-chart"><p class="muted small" style="padding:20px 0">Loading…</p></div>
    <div class="pg-legend">
      <span><i style="background:${COLOUR.C}"></i>Confident</span>
      <span><i style="background:${COLOUR.W}"></i>Working</span>
      <span><i style="background:${COLOUR.N}"></i>Not started</span>
    </div>
  </div></div>`);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('[data-x]').onclick = () => modal.remove();
  document.body.appendChild(modal);

  const [d3, data] = await Promise.all([loadD3(), store.progress()]);
  const chart = modal.querySelector('#pg-chart');
  chart.innerHTML = '';

  const title = modal.querySelector('#pg-title');
  const sub = modal.querySelector('#pg-sub');
  const back = modal.querySelector('.pg-back');
  const overall = modal.querySelector('#pg-overall');

  const totalC = data.reduce((a, d) => a + d.totals.C, 0);
  const totalAll = data.reduce((a, d) => a + d.totals.C + d.totals.W + d.totals.N, 0) || 1;
  overall.textContent = `Overall Progress: ${Math.floor(totalC * 100 / totalAll)}%`;

  const showGeneral = () => {
    title.textContent = 'Progress';
    sub.hidden = false; back.hidden = true;
    render(chart, d3, data.map((d) => ({ label: d.name, C: d.totals.C, W: d.totals.W, N: d.totals.N, _s: d })), (row) => showSubject(row._s));
  };
  const showSubject = (s) => {
    title.textContent = s.name;
    sub.hidden = true; back.hidden = false;
    render(chart, d3, s.strands.map((x) => ({ label: x.label, C: x.C, W: x.W, N: x.N })), null);
  };
  back.onclick = showGeneral;
  showGeneral();
}
