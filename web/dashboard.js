/**
 * The dashboard's script: asks for every target's state each step and draws
 * a tile per target, and a chart per target over the range chosen — the
 * smoke the spread of the pings, the median a line coloured by loss.
 *
 * Everything the server sends is put in as text, never as HTML.
 */
(function () {
  'use strict';

  const POLL_MS = 15000;
  const RANGE_KEY = 'connection-monitor.range';
  const SVG = 'http://www.w3.org/2000/svg';

  const ICONS = {
    router: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M10.5 16.5h.01"/><path d="M8.5 9.5a5 5 0 0 1 7 0M6 7a8.5 8.5 0 0 1 12 0"/><path d="M12 13v-1"/>',
    internet: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01"/>',
    device: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 18h4"/>',
  };

  /**
   * Smokeping's loss colours, quieter: none, a little, much, nearly all.
   * Under half a percent counts as none, as Smokeping rounds it: averaged
   * over hours, a single lost ping would otherwise colour a whole stretch.
   */
  const LOSS = [
    { upTo: 0.005, color: '#2e9e5b', label: 'no loss' },
    { upTo: 0.05, color: '#2f80ed', label: 'up to 5 %' },
    { upTo: 0.2, color: '#c9822a', label: 'up to 20 %' },
    { upTo: 0.99, color: '#d64545', label: 'more' },
    { upTo: 1, color: '#7d1f1f', label: 'no answer' },
  ];

  /** The time axis per range: a line every so often, and what it says. Midnight says the day. */
  const atMidnight = (d) => (d.getHours() === 0 && d.getMinutes() === 0 ? weekday(d) : time(d));
  const RANGE_TICKS = {
    '1h': { every: 600, label: atMidnight },
    '3h': { every: 1800, label: atMidnight },
    '12h': { every: 2 * 3600, label: atMidnight },
    '24h': { every: 3 * 3600, label: atMidnight },
    '7d': { every: 86400, label: (d) => weekday(d) },
    '30d': { every: 'week', label: (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) },
    '1y': { every: 'month', label: (d) => d.toLocaleDateString(undefined, { month: 'short' }) },
  };

  const tilesBox = document.getElementById('tiles');
  const chartsBox = document.getElementById('charts');
  let range = '24h';
  try {
    range = localStorage.getItem(RANGE_KEY) || range;
  } catch {
    // No storage, as in a private window: the last 24 hours.
  }
  // A range in the address, as #3h, for a bookmark, before the one chosen last.
  if (RANGE_TICKS[location.hash.slice(1)]) {
    range = location.hash.slice(1);
  }
  if (!RANGE_TICKS[range]) {
    // Also one of the ranges there were before, such as 30 hours.
    range = '24h';
  }
  /** When the charts were last drawn: they change each step, the tiles more often. */
  let chartsAt = 0;
  const CHARTS_MS = 60000;
  let status = null;
  /** The last chart data per target, to draw again when the window's width changes. */
  const drawn = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function svg(tag, attributes) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes || {})) {
      node.setAttribute(key, String(value));
    }
    return node;
  }

  function time(d) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function weekday(d) {
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  }

  function ms(value) {
    if (value === null || value === undefined) {
      return '–';
    }
    return value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : String(Math.round(value));
  }

  function percent(loss) {
    if (loss === null || loss === undefined) {
      return '–';
    }
    const value = loss * 100;
    return `${value === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} %`;
  }

  function lossColor(loss) {
    return (LOSS.find((step) => loss <= step.upTo) || LOSS[LOSS.length - 1]).color;
  }

  function icon(name) {
    const span = el('span', 'icon');
    span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.device}</svg>`;
    return span;
  }

  // ---------------------------------------------------------------- tiles

  function tile(target, step) {
    const last = target.last;
    const stale = !last || Date.now() / 1000 - last.t > Math.max(step, last.step) * 3 + 60;
    let kind = 'running';
    let state = 'Good';
    if (stale) {
      kind = 'stale';
      state = last ? 'Not measured lately' : 'No measurements yet';
    } else if (last.loss >= 1) {
      kind = 'trouble';
      state = 'No answer';
    } else if (last.loss > 0) {
      kind = 'busy';
      state = `${percent(last.loss)} loss`;
    }
    const node = el('div', `card tile ${kind}`);
    node.append(icon(target.icon), el('div', 'name', target.name));
    const value = el('div', 'value', stale || last.median === null ? '–' : ms(last.median));
    if (!stale && last.median !== null) {
      value.append(el('small', '', 'ms'));
    }
    node.append(value, el('div', 'state', state));
    const hour = target.hour;
    node.append(el('div', 'detail', hour ? `Last hour ${ms(hour.median)} ms · ${percent(hour.loss)} loss` : target.host));
    node.append(el('div', 'detail', target.host));
    return node;
  }

  function drawTiles() {
    tilesBox.replaceChildren(...status.targets.map((target) => tile(target, status.step)));
  }

  // ---------------------------------------------------------------- charts

  function chartCard(target) {
    let card = chartsBox.querySelector(`[data-target="${CSS.escape(target.name)}"]`);
    if (!card) {
      card = el('div', 'card chart');
      card.dataset.target = target.name;
      const head = el('div', 'head');
      const title = el('div', 'name', target.name);
      title.append(el('span', 'host', target.host));
      head.append(title, el('div', 'legend'));
      const plot = el('div', 'plot');
      const tip = el('div', 'tip');
      tip.hidden = true;
      plot.append(tip);
      card.append(head, plot);
    }
    return card;
  }

  /** Round numbers for the time axis: every so many minutes or hours, each day, Monday or month, in local time. */
  function ticks(from, to) {
    const rule = RANGE_TICKS[range];
    const out = [];
    if (rule.every === 'week') {
      const d = new Date(from * 1000);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      for (; d.getTime() / 1000 < to; d.setDate(d.getDate() + 7)) {
        out.push(d.getTime() / 1000);
      }
      return out;
    }
    if (rule.every === 'month') {
      const d = new Date(from * 1000);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      for (d.setMonth(d.getMonth() + 1); d.getTime() / 1000 < to; d.setMonth(d.getMonth() + 1)) {
        out.push(d.getTime() / 1000);
      }
      return out;
    }
    const offset = new Date(from * 1000).getTimezoneOffset() * 60;
    for (let t = Math.ceil((from - offset) / rule.every) * rule.every + offset; t < to; t += rule.every) {
      out.push(t);
    }
    return out;
  }

  /** A top for the scale that leaves out a few spikes: the 98th percentile of the 90 % lines, and some room. */
  function top(points) {
    const highs = points.filter((p) => p.smoke.length).map((p) => p.smoke[9]).sort((a, b) => a - b);
    if (highs.length === 0) {
      return 10;
    }
    const value = highs[Math.min(highs.length - 1, Math.floor(highs.length * 0.98))] * 1.25;
    const nice = [1, 2, 2.5, 5, 10];
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return nice.map((n) => n * magnitude).find((n) => n >= value) || value;
  }

  function legend(card, points) {
    const box = card.querySelector('.legend');
    const measured = points.filter((p) => p.median !== null);
    if (measured.length === 0) {
      box.textContent = points.some((p) => p.loss !== null) ? 'No answer · Loss 100 %' : 'Nothing measured in this time';
      return;
    }
    const medians = measured.map((p) => p.median).sort((a, b) => a - b);
    const withLoss = points.filter((p) => p.loss !== null);
    const loss = withLoss.reduce((sum, p) => sum + p.loss, 0) / withLoss.length;
    const middle = medians[Math.floor(medians.length / 2)];
    box.replaceChildren();
    const part = (label, value) => {
      const span = el('span', '', `${label} `);
      span.append(el('b', '', value));
      return span;
    };
    box.append(part('Median', `${ms(middle)} ms`), ' · ', part('best', `${ms(medians[0])}`), ' · ',
      part('worst', `${ms(medians[medians.length - 1])} ms`), ' · ', part('Loss', percent(loss)));
  }

  function draw(card, data) {
    const plot = card.querySelector('.plot');
    plot.querySelector('svg')?.remove();
    const width = plot.clientWidth || 600;
    const height = plot.clientHeight || 220;
    const left = 46;
    const right = 6;
    const bottom = 22;
    const inner = { w: width - left - right, h: height - bottom - 6 };
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Latency of ${data.target}` });
    const points = data.points;
    const yMax = top(points);
    const x = (t) => left + ((t - data.from) / (data.to - data.from)) * inner.w;
    const y = (value) => 6 + inner.h - (Math.min(value, yMax) / yMax) * inner.h;
    const slot = inner.w / points.length;

    // The ms scale: four lines.
    for (let i = 0; i <= 4; i++) {
      const value = (yMax / 4) * i;
      chart.append(svg('line', { class: 'grid', x1: left, x2: width - right, y1: y(value), y2: y(value) }));
      const label = svg('text', { class: 'axis', x: left - 6, y: y(value) + 4, 'text-anchor': 'end' });
      label.textContent = i === 4 ? `${ms(value)} ms` : ms(value);
      chart.append(label);
    }
    for (const t of ticks(data.from, data.to)) {
      chart.append(svg('line', { class: 'grid', x1: x(t), x2: x(t), y1: 6, y2: 6 + inner.h }));
      const label = svg('text', { class: 'axis', x: x(t), y: height - 6, 'text-anchor': 'middle' });
      label.textContent = RANGE_TICKS[range].label(new Date(t * 1000));
      chart.append(label);
    }

    // The smoke: the outer tenths faintest, the middle darkest.
    const smoke = svg('g', { class: 'smoke' });
    const pairs = [[0, 10, 0.07], [1, 9, 0.08], [2, 8, 0.1], [3, 7, 0.12], [4, 6, 0.16]];
    points.forEach((p, i) => {
      if (!p.smoke.length) {
        return;
      }
      for (const [low, high, opacity] of pairs) {
        const upper = y(p.smoke[high]);
        smoke.append(svg('rect', {
          x: left + i * slot, y: upper, width: slot + 0.4, height: Math.max(0.5, y(p.smoke[low]) - upper), 'fill-opacity': opacity,
        }));
      }
    });
    chart.append(smoke);

    // The median, a short line per point in its loss colour; all lost, a mark at the top.
    points.forEach((p, i) => {
      if (p.loss === null) {
        return;
      }
      if (p.median === null) {
        chart.append(svg('rect', { x: left + i * slot, y: 6, width: Math.max(slot, 1.5), height: 4, fill: lossColor(1) }));
        return;
      }
      chart.append(svg('line', {
        x1: left + i * slot, x2: left + (i + 1) * slot + 0.4, y1: y(p.median), y2: y(p.median),
        stroke: lossColor(p.loss), 'stroke-width': 2, 'stroke-linecap': 'butt',
      }));
    });

    if (!points.some((p) => p.loss !== null)) {
      const text = svg('text', { class: 'empty', x: left + inner.w / 2, y: 6 + inner.h / 2, 'text-anchor': 'middle' });
      text.textContent = 'Nothing measured in this time';
      chart.append(text);
    }

    const cursor = svg('line', { class: 'cursor', y1: 6, y2: 6 + inner.h, visibility: 'hidden' });
    chart.append(cursor);
    plot.prepend(chart);
    legend(card, points);
    hover(plot, chart, cursor, points, { left, slot, width });
  }

  function hover(plot, chart, cursor, points, { left, slot, width }) {
    const tip = plot.querySelector('.tip');
    chart.addEventListener('pointermove', (event) => {
      const box = chart.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      const i = Math.floor((px - left) / slot);
      const p = points[i];
      if (!p) {
        tip.hidden = true;
        cursor.setAttribute('visibility', 'hidden');
        return;
      }
      const cx = left + (i + 0.5) * slot;
      cursor.setAttribute('x1', cx);
      cursor.setAttribute('x2', cx);
      cursor.setAttribute('visibility', 'visible');
      const d = new Date(p.t * 1000);
      const when = `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time(d)}`;
      tip.replaceChildren(el('div', '', when));
      if (p.loss === null) {
        tip.append(el('div', '', 'Not measured'));
      } else {
        const line = (label, value) => {
          const row = el('div');
          row.append(el('span', '', `${label} `), value);
          return row;
        };
        tip.append(line('Median', `${ms(p.median)} ms`));
        if (p.smoke.length) {
          tip.append(line('Most', `${ms(p.smoke[1])}–${ms(p.smoke[9])} ms`));
        }
        tip.append(line('Loss', percent(p.loss)));
        if (p.step && p.step >= 300 && p.step !== status.step) {
          tip.append(el('span', '', p.step >= 3600 ? `from Smokeping, per ${p.step / 3600} h` : `from Smokeping, per ${p.step / 60} min`));
        }
      }
      tip.hidden = false;
      const x = event.clientX - plot.getBoundingClientRect().left;
      tip.style.left = `${Math.min(Math.max(0, x + 12), plot.clientWidth - tip.offsetWidth)}px`;
      tip.style.top = '4px';
    });
    chart.addEventListener('pointerleave', () => {
      tip.hidden = true;
      cursor.setAttribute('visibility', 'hidden');
    });
  }

  async function drawCharts() {
    chartsAt = Date.now();
    const cards = status.targets.map((target) => chartCard(target));
    chartsBox.replaceChildren(...cards);
    await Promise.all(status.targets.map(async (target, i) => {
      try {
        const response = await fetch(`api/series?target=${encodeURIComponent(target.name)}&range=${range}`);
        const data = await response.json();
        drawn.set(target.name, data);
        draw(cards[i], data);
      } catch {
        cards[i].querySelector('.legend').textContent = 'Could not be read.';
      }
    }));
  }

  function drawScale() {
    const box = document.getElementById('scale');
    box.replaceChildren(el('span', '', 'Loss:'));
    for (const step of LOSS) {
      const item = el('span');
      const swatch = el('i');
      swatch.style.background = step.color;
      item.append(swatch, step.label);
      box.append(item);
    }
    box.append(el('span', '', `· ${status.pings} pings every ${status.step} s; the shade is their spread.`));
  }

  function chooseRange(next) {
    range = next;
    try {
      localStorage.setItem(RANGE_KEY, next);
    } catch {
      // Kept for this visit only.
    }
    for (const button of document.querySelectorAll('[data-range]')) {
      button.setAttribute('aria-pressed', String(button.dataset.range === range));
    }
    if (status) {
      void drawCharts();
    }
  }

  async function refresh() {
    try {
      const response = await fetch('api/status', { cache: 'no-store' });
      status = await response.json();
    } catch {
      document.getElementById('updated').textContent = 'Connection Monitor cannot be reached.';
      return;
    }
    document.getElementById('version').textContent = `Version ${status.version}`;
    document.getElementById('updated').textContent = `Updated ${time(new Date())}`;
    const problems = document.getElementById('problems');
    problems.replaceChildren(...status.problems.map((text) => el('li', '', text)));
    problems.hidden = status.problems.length === 0;
    drawTiles();
    drawScale();
    if (Date.now() - chartsAt >= CHARTS_MS) {
      await drawCharts();
    }
  }

  for (const button of document.querySelectorAll('[data-range]')) {
    button.addEventListener('click', () => chooseRange(button.dataset.range));
  }
  chooseRange(range);
  let resizing;
  window.addEventListener('resize', () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      for (const card of chartsBox.children) {
        const data = drawn.get(card.dataset.target);
        if (data) {
          draw(card, data);
        }
      }
    }, 150);
  });
  void refresh();
  setInterval(refresh, POLL_MS);
})();
