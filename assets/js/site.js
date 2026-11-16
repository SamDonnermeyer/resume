/* Sam Donnermeyer · site interactions and charts. No dependencies. */
(function () {
  'use strict';

  var D = window.SITE_DATA;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Career timeline rows. The degree's bar runs Aug 2019 to May 2022; its tooltip shows years only. */
  var CAREER = [
    { lane: 'Schweitzer Engineering Laboratories', role: 'Product Hospital Intern', start: '2017-10', end: '2019-08' },
    { lane: 'Wilson Logistics', role: 'Marketing Intern', start: '2019-10', end: '2020-03' },
    { lane: 'Schweitzer Engineering Laboratories', role: 'Data Analyst Intern', start: '2020-05', end: '2020-08' },
    { lane: 'University of Montana', role: 'B.S. Management Information Systems', short: 'B.S. degree', start: '2019-08', end: '2022-05', edu: true, when: '2019 – 2022' },
    { lane: 'University of Montana', role: 'Technical Educator & Consultant', start: '2021-07', end: '2022-05' },
    { lane: 'Young Life', role: 'Data Analyst', start: '2022-05', end: null, current: true }
  ];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function svgText(parent, x, y, str, cls, anchor) {
    var t = svgEl('text', { x: x, y: y, 'class': cls || 'axis-text' }, parent);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    return t;
  }
  function lin(d0, d1, r0, r1) {
    var f = function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
    f.inv = function (p) { return d0 + (p - r0) / (r1 - r0) * (d1 - d0); };
    return f;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls, text, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function pathFrom(points) {
    var s = '';
    for (var i = 0; i < points.length; i++) s += (i ? 'L' : 'M') + points[i][0].toFixed(1) + ',' + points[i][1].toFixed(1);
    return s;
  }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function fmt1(v) { return (Math.round(v * 10 + 1e-6) / 10).toFixed(1); }
  function argMax(a) { var m = 0; for (var i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; }

  /* ---------- Dates for the snow water year ---------- */
  var start = D ? new Date(D.snow.start + 'T12:00:00') : null;
  function dayDate(i) { var d = new Date(start); d.setDate(d.getDate() + i); return d; }
  function fmtDay(i, withYear) {
    var d = dayDate(i);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + (withYear ? ', ' + d.getFullYear() : '');
  }
  function dayOf(iso) { return Math.round((new Date(iso + 'T12:00:00') - start) / 864e5); }
  var monthTicks = [];
  if (D) for (var mi = 0; mi < D.snow.days; mi++) { var md = dayDate(mi); if (md.getDate() === 1) monthTicks.push({ i: mi, m: md.getMonth() }); }
  function pctOfNormal(r) { return Math.round(100 * r.peak / r.medPeak); }

  /* ---------- Tooltip (values lead, names follow; textContent only) ---------- */
  var tip = el('div', 'tip', null, document.body);
  tip.setAttribute('aria-hidden', 'true');
  function tipOpen(build, x, y) {
    tip.replaceChildren();
    build(tip);
    tip.classList.add('is-on');
    var r = tip.getBoundingClientRect();
    var left = x + 16, top = y + 16;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 16;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function tipClose() { tip.classList.remove('is-on'); }
  function tipKeyRow(parent, color, label, value) {
    var r = el('div', 't-row', null, parent);
    var k = el('span', 't-key', null, r); k.style.background = color;
    el('span', null, label, r);
    el('b', null, value, r);
  }
  function tipRow(parent, label, value) {
    var r = el('div', 't-row', null, parent);
    el('span', 't-muted', label, r);
    el('b', null, value, r);
  }
  function svgPointToClient(svg, x, y) {
    var r = svg.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    return { x: r.left + x * r.width / vb.width, y: r.top + y * r.height / vb.height };
  }

  /* ---------- Hero: snowpack ridgeline with a peak-vs-normal dot strip ---------- */
  var ridgeState = { active: -1, day: 0, animated: false };
  function renderRidge() {
    var host = $('#ridge');
    if (!host || !D) return;
    var W = Math.round(host.clientWidth), H = Math.round(host.clientHeight);
    if (!W || !H) return;
    var narrow = W < 520;
    var R = D.snow.ridges, N = R.length, days = D.snow.days;

    // Layout: ridgeline on the left, a narrow dot strip on the right sharing its rows
    var stripW = narrow ? 58 : 92, gap = narrow ? 12 : 20, nsW = 12;
    var RW = W - stripW - gap - nsW;
    var sx0 = RW + gap, sx1 = W - nsW;
    var topPad = 44, axisH = 24, rise = narrow ? 8 : 10.5;
    var step = (H - topPad - axisH) / (N - 1 + rise);
    var amp = step * rise;
    var maxV = Math.max.apply(null, R.map(function (r) { return r.peak; }));
    var maxPct = Math.max(100, Math.ceil(Math.max.apply(null, R.map(pctOfNormal)) / 10) * 10);
    var x = lin(0, days - 1, 0, RW);
    var sx = lin(0, maxPct, sx0, sx1);
    function base(i) { return topPad + amp + i * step; }
    function yv(i, tenths) { return base(i) - (tenths / 10) / maxV * amp; }

    host.replaceChildren();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' }, host);
    var clipId = 'ridge-clip';
    var clip = svgEl('clipPath', { id: clipId }, svgEl('defs', null, svg));
    var drawn = ridgeState.animated || reduceMotion;
    var clipRect = svgEl('rect', { x: 0, y: 0, width: drawn ? RW : 0, height: H }, clip);

    var m0 = dayOf('2026-03-01'), m1 = dayOf('2026-03-31');
    var normalPeak = argMax(D.snow.statewide.med);
    var feature = argMax(R.map(function (r) { return r.peak; }));

    // Ridges
    var ridgesG = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' }, svg);
    var groups = [];
    R.forEach(function (r, i) {
      var pts = r.v.map(function (v, k) { return [x(k), yv(i, v)]; });
      var line = pathFrom(pts);
      var area = line + 'L' + x(days - 1).toFixed(1) + ',' + base(i).toFixed(1) + 'L' + x(0).toFixed(1) + ',' + base(i).toFixed(1) + 'Z';
      var g = svgEl('g', { 'class': 'ridge-g' + (i === feature ? ' is-feature' : '') }, ridgesG);
      svgEl('path', { d: area, 'class': 'ridge-fill' }, g);
      svgEl('path', { d: area, 'class': 'ridge-wash' }, g);
      svgEl('path', { d: line, 'class': 'ridge-line' }, g);
      groups.push(g);
    });

    // March band and the normal peak date, laid over the ridges
    var axisY = H - axisH + 6;
    var bandG = svgEl('g', { 'class': 'ridge-ann', 'pointer-events': 'none' }, svg);
    svgEl('rect', { x: x(m0), y: topPad - 2, width: x(m1) - x(m0), height: axisY - topPad + 2, 'class': 'band' }, bandG);
    svgEl('line', { x1: x(normalPeak), x2: x(normalPeak), y1: topPad - 16, y2: axisY, 'class': 'ref-line' }, bandG);

    // Time axis
    svgEl('line', { x1: 0, x2: RW, y1: axisY, y2: axisY, 'class': 'axis-line' }, svg);
    monthTicks.forEach(function (t, n) {
      if (narrow && n % 2) return;
      var roomy = x(30) > 58;   // enough width per month to carry a year on the label
      var label = MONTHS[t.m] + (t.m === 0 && roomy ? ' 2026' : t.m === 9 && (narrow || roomy) ? ' 2025' : '');
      svgText(svg, x(t.i) + 2, H - 2, label, 'axis-text');
    });

    // Scale: how tall 10 inches of snow water is on every ridge
    var s10 = 10 / maxV * amp;
    svgEl('path', { d: 'M5,' + base(0).toFixed(1) + 'h6M8,' + base(0).toFixed(1) + 'v' + (-s10).toFixed(1) + 'M5,' + (base(0) - s10).toFixed(1) + 'h6', 'class': 'scale-bar' }, svg);
    svgText(svg, 16, base(0) - s10 + 9, narrow ? '10 in' : '10 in of snow water', 'ann-text halo');

    // Dot strip: each station's peak as a share of its normal peak
    var stripG = svgEl('g', null, svg);
    var smid = (sx0 + sx1) / 2;
    svgText(stripG, smid, base(0) - 30, 'Peak vs.', 'ann-text', 'middle');
    svgText(stripG, smid, base(0) - 16, 'normal', 'ann-text', 'middle');
    svgEl('line', { x1: sx(0), x2: sx(0), y1: base(0) - 8, y2: axisY, 'class': 'grid-line' }, stripG);
    if (!narrow) svgEl('line', { x1: sx(50), x2: sx(50), y1: base(0) - 8, y2: axisY, 'class': 'grid-line' }, stripG);
    svgEl('line', { x1: sx(100), x2: sx(100), y1: base(0) - 8, y2: axisY, 'class': 'axis-line' }, stripG);
    svgText(stripG, sx(0), H - 2, '0', 'axis-text', 'middle');
    if (!narrow) svgText(stripG, sx(50), H - 2, '50', 'axis-text', 'middle');
    svgText(stripG, sx(100), H - 2, '100%', 'axis-text', 'middle');
    svgText(stripG, W, base(0) + 4, 'N', 'axis-text', 'end');
    svgText(stripG, W, base(N - 1) + 4, 'S', 'axis-text', 'end');
    var rows = [];
    R.forEach(function (r, i) {
      var g = svgEl('g', { 'class': 'strip-row' + (i === feature ? ' is-feature' : '') }, stripG);
      svgEl('line', { x1: sx(0), x2: sx(pctOfNormal(r)), y1: base(i), y2: base(i), 'class': 'strip-stem' }, g);
      svgEl('circle', { cx: sx(pctOfNormal(r)), cy: base(i), r: narrow ? 3 : 3.6, 'class': 'strip-dot' }, g);
      rows.push(g);
    });

    // Annotations (selective: the band, the normal peak date and the tallest peak)
    var annG = svgEl('g', { 'class': 'ridge-ann', 'pointer-events': 'none' }, svg);
    svgText(annG, x(m0) + 4, topPad - 24, 'Record-hot March', 'ann-text halo');
    svgText(annG, x(normalPeak) + 6, topPad - 8, narrow ? 'Normal peak' : 'Normal peak, ' + fmtDay(normalPeak), 'ann-text halo');
    var fr = R[feature], fx = x(fr.peakDay), fy = yv(feature, Math.round(fr.peak * 10));
    svgEl('circle', { cx: fx, cy: fy, r: 4, 'class': 'dot-s1', style: 'stroke: var(--bg)' }, annG);
    var rest = narrow ? ', ' + fr.peak.toFixed(1) + ' in' : ' peaked at ' + fr.peak.toFixed(1) + ' in on ' + fmtDay(fr.peakDay);
    var estW = (fr.name.length + rest.length) * 6.4;
    var lbl = svgText(annG, Math.max(fx - 10, estW + 2), fy - 10, '', 'ann-text halo', 'end');
    var t1 = svgEl('tspan', { 'class': 'ann-strong' }, lbl); t1.textContent = fr.name;
    var t2 = svgEl('tspan', null, lbl); t2.textContent = rest;

    var hoverDot = svgEl('circle', { r: 4, 'class': 'dot-s1', style: 'stroke: var(--bg); display:none' }, svg);

    function setActive(i, k, clientX, clientY) {
      if (i === ridgeState.active && k === ridgeState.day && clientX == null) return;
      ridgeState.active = i; ridgeState.day = k;
      host.classList.toggle('has-active', i >= 0);
      groups.forEach(function (g, n) { g.classList.toggle('is-active', n === i); });
      rows.forEach(function (g, n) { g.classList.toggle('is-active', n === i); });
      if (i < 0) { hoverDot.style.display = 'none'; tipClose(); return; }
      var r = R[i], v = r.v[k];
      var cx = x(k), cy = yv(i, v);
      hoverDot.setAttribute('cx', cx); hoverDot.setAttribute('cy', cy); hoverDot.style.display = '';
      var p = clientX != null ? { x: clientX, y: clientY } : svgPointToClient(svg, cx, cy);
      tipOpen(function (t) {
        el('div', 't-val', (v / 10).toFixed(1) + ' in of snow water', t);
        el('div', 't-name', r.name, t);
        el('div', 't-muted', r.elev.toLocaleString() + ' ft · ' + fmtDay(k, true), t);
        tipRow(t, 'Season peak', r.peak.toFixed(1) + ' in, ' + fmtDay(r.peakDay));
        tipRow(t, 'Normal peak', r.medPeak.toFixed(1) + ' in, ' + fmtDay(r.medPeakDay));
        tipRow(t, 'Peak vs. normal', pctOfNormal(r) + '%');
      }, p.x, p.y);
    }
    function pick(px, py) {
      var row = clamp(Math.round((py - base(0)) / step), 0, N - 1);
      if (px > RW + gap / 2) return { i: row, k: R[row].peakDay };     // over the dot strip
      var k = clamp(Math.round(x.inv(px)), 0, days - 1);
      for (var i = N - 1; i >= 0; i--) {                                // frontmost ridge under the pointer
        var top = yv(i, R[i].v[k]);
        if (py >= top - 3 && py <= base(i) + 1) return { i: i, k: k };
      }
      return { i: row, k: k };
    }
    svg.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect();
      var px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * H / r.height;
      if (py > axisY) { setActive(-1, 0); return; }
      var h = pick(px, py);
      setActive(h.i, h.k, e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', function () { setActive(-1, 0); });

    host.onkeydown = function (e) {
      var i = ridgeState.active, k = ridgeState.day;
      if (i < 0) { i = feature; k = R[feature].peakDay; }
      if (e.key === 'ArrowDown') i = Math.min(N - 1, i + 1);
      else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight') k = Math.min(days - 1, k + 7);
      else if (e.key === 'ArrowLeft') k = Math.max(0, k - 7);
      else if (e.key === 'Escape') { setActive(-1, 0); return; }
      else return;
      e.preventDefault();
      ridgeState.active = -2;
      setActive(i, k);
    };
    host.onblur = function () { setActive(-1, 0); };

    // Draw-in: the season unfolds left to right, then the dots land north to south
    if (!drawn) {
      ridgeState.animated = true;
      annG.style.opacity = 0; bandG.style.opacity = 0;
      rows.forEach(function (g) { g.style.opacity = 0; });
      var t0 = null, dur = 2400;
      var tick = function (ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        clipRect.setAttribute('width', (RW * easeInOut(p)).toFixed(1));
        if (p < 1) { requestAnimationFrame(tick); return; }
        annG.style.transition = bandG.style.transition = 'opacity .6s ease';
        annG.style.opacity = 1; bandG.style.opacity = 1;
        rows.forEach(function (g, n) { g.style.transitionDelay = (n * 28) + 'ms'; g.style.opacity = 1; });
      };
      requestAnimationFrame(tick);
    }
    ridgeState.animated = true;
  }

  function buildRidgeTable() {
    var tb = $('#ridge-table tbody');
    if (!tb || !D) return;
    D.snow.ridges.forEach(function (r) {
      var tr = el('tr', null, null, tb);
      el('td', null, r.name, tr);
      el('td', 'num', r.elev.toLocaleString(), tr);
      el('td', 'num', r.peak.toFixed(1), tr);
      el('td', null, fmtDay(r.peakDay, true), tr);
      el('td', null, fmtDay(r.medPeakDay), tr);
      el('td', 'num', pctOfNormal(r) + '%', tr);
    });
  }

  /* ---------- Hunt Command card: this winter's snowpack against normal ---------- */
  function renderStatewide() {
    var host = $('#statewide');
    if (!host || !D) return;
    var W = Math.round(host.clientWidth);
    if (!W) return;
    var narrow = W < 460;
    var H = narrow ? 250 : 280;
    var S = D.snow.statewide, days = D.snow.days;
    var padL = 30, padR = 12, padT = 28, padB = 24;
    var x = lin(0, days - 1, padL, W - padR);
    var y = lin(0, 17, H - padB, padT);
    host.replaceChildren();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true' }, host);

    var m0 = dayOf('2026-03-01'), m1 = dayOf('2026-03-31');
    svgEl('rect', { x: x(m0), y: padT - 8, width: x(m1) - x(m0), height: H - padB - padT + 8, 'class': 'band' }, svg);
    [5, 10, 15].forEach(function (v) {
      svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), 'class': 'grid-line' }, svg);
      svgText(svg, padL - 6, y(v) + 4, v === 15 ? '15 in' : String(v), 'axis-text', 'end');
    });
    svgEl('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), 'class': 'axis-line' }, svg);
    svgText(svg, padL - 6, y(0) + 4, '0', 'axis-text', 'end');
    monthTicks.forEach(function (t, n) {
      if (narrow && n % 2) return;
      svgText(svg, x(t.i), H - 6, MONTHS[t.m], 'axis-text', n === 0 ? 'start' : 'middle');
    });

    var medPts = S.med.map(function (v, k) { return [x(k), y(v)]; });
    var avgPts = S.avg.map(function (v, k) { return [x(k), y(v)]; });
    svgEl('path', { d: pathFrom(medPts), 'class': 'line-de' }, svg);
    svgEl('path', { d: pathFrom(avgPts) + 'L' + x(days - 1) + ',' + y(0) + 'L' + x(0) + ',' + y(0) + 'Z', 'class': 'area-s1' }, svg);
    var avgPath = svgEl('path', { d: pathFrom(avgPts), 'class': 'line-s1' }, svg);

    var pk = argMax(S.avg), mpk = argMax(S.med);

    // The gap between the two peaks, drawn: how many days early this winter topped out
    var gy = y(11);
    svgEl('path', {
      d: 'M' + x(pk) + ',' + (y(S.avg[pk]) - 7) + 'V' + gy + 'H' + x(mpk) + 'V' + (y(S.med[mpk]) + 7),
      fill: 'none', 'class': 'ref-line'
    }, svg);
    svgText(svg, (x(pk) + x(mpk)) / 2, gy + 14, (mpk - pk) + ' days early', 'ann-text ann-strong halo', 'middle');

    // Direct labels: the two series, then the two peaks
    var nl = Math.round(days * 0.34);
    svgText(svg, x(nl) - 8, y(S.med[nl]) - 8, narrow ? 'Normal' : 'Normal (median)', 'ann-text halo', 'end');
    var wl = Math.round(days * 0.45);
    svgText(svg, x(wl), y(S.avg[wl] * 0.4), 'This winter', 'ann-text', 'middle');
    svgEl('circle', { cx: x(mpk), cy: y(S.med[mpk]), r: 4, 'class': 'dot-de' }, svg);
    svgText(svg, x(mpk), y(S.med[mpk]) - 10, fmtDay(mpk) + ' · ' + fmt1(S.med[mpk]) + ' in', 'ann-text halo', 'middle');
    svgEl('circle', { cx: x(pk), cy: y(S.avg[pk]), r: 4, 'class': 'dot-s1' }, svg);
    svgText(svg, x(pk) + 9, y(S.avg[pk]) + 4, fmtDay(pk) + ' · ' + fmt1(S.avg[pk]) + ' in', 'ann-text halo');

    // Draw this winter's line when it scrolls into view
    if (!reduceMotion && !host.dataset.drawn) {
      var len = avgPath.getTotalLength();
      avgPath.style.strokeDasharray = len; avgPath.style.strokeDashoffset = len;
      onVisible(host, function () {
        avgPath.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1)';
        avgPath.style.strokeDashoffset = 0;
      });
    }
    host.dataset.drawn = '1';

    var cross = svgEl('line', { y1: padT - 4, y2: y(0), 'class': 'crosshair', style: 'display:none' }, svg);
    var dA = svgEl('circle', { r: 4, 'class': 'dot-s1', style: 'display:none' }, svg);
    var dM = svgEl('circle', { r: 4, 'class': 'dot-de', style: 'display:none' }, svg);
    var current = -1;
    function show(k, cx, cy) {
      current = k;
      cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.style.display = '';
      dA.setAttribute('cx', x(k)); dA.setAttribute('cy', y(S.avg[k])); dA.style.display = '';
      dM.setAttribute('cx', x(k)); dM.setAttribute('cy', y(S.med[k])); dM.style.display = '';
      if (cx == null) { var p = svgPointToClient(svg, x(k), y(Math.max(S.avg[k], S.med[k]))); cx = p.x; cy = p.y; }
      tipOpen(function (t) {
        var pct = S.med[k] > 0.3 ? Math.round(100 * S.avg[k] / S.med[k]) + '% of normal' : 'little snow either way';
        el('div', 't-val', pct, t);
        el('div', 't-muted', fmtDay(k, true), t);
        tipKeyRow(t, 'var(--s1)', 'This winter', fmt1(S.avg[k]) + ' in');
        tipKeyRow(t, 'var(--de)', 'Normal', fmt1(S.med[k]) + ' in');
      }, cx, cy);
    }
    function hide() { current = -1; cross.style.display = dA.style.display = dM.style.display = 'none'; tipClose(); }
    svg.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect();
      var px = (e.clientX - r.left) * W / r.width;
      if (px < padL - 4 || px > W - padR + 4) { hide(); return; }
      show(clamp(Math.round(x.inv(px)), 0, days - 1), e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', hide);
    host.onkeydown = function (e) {
      var k = current < 0 ? pk : current;
      if (e.key === 'ArrowRight') k = Math.min(days - 1, k + 7);
      else if (e.key === 'ArrowLeft') k = Math.max(0, k - 7);
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      show(k);
    };
    host.onblur = hide;
  }

  function buildStatewideTable() {
    var tb = $('#statewide-table tbody');
    if (!tb || !D) return;
    var S = D.snow.statewide;
    monthTicks.forEach(function (t) {
      var tr = el('tr', null, null, tb);
      el('td', null, fmtDay(t.i, true), tr);
      el('td', 'num', fmt1(S.avg[t.i]), tr);
      el('td', 'num', fmt1(S.med[t.i]), tr);
      el('td', 'num', S.med[t.i] > 0.3 ? Math.round(100 * S.avg[t.i] / S.med[t.i]) + '%' : '–', tr);
    });
  }

  /* ---------- Experience: career timeline ---------- */
  function monthIndex(s) { var p = s.split('-'); return +p[0] * 12 + (+p[1] - 1); }
  function fmtMonth(s) { var p = s.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function fmtSpan(m) {
    var y = Math.floor(m / 12), mo = m % 12, out = [];
    if (y) out.push(y + (y === 1 ? ' yr' : ' yrs'));
    if (mo) out.push(mo + ' mo');
    return out.join(' ');
  }
  function renderCareer() {
    var host = $('#career');
    if (!host) return;
    var W = Math.round(host.clientWidth);
    if (!W) return;
    var narrow = W < 600;
    var C = CAREER, today = new Date();
    var nowM = today.getFullYear() * 12 + today.getMonth();
    var lanes = [];
    C.forEach(function (c) { if (lanes.indexOf(c.lane) < 0) lanes.push(c.lane); });
    var labelW = narrow ? 0 : 250, laneH = narrow ? 68 : 52, topPad = 26, axisH = 26;
    var H = topPad + lanes.length * laneH + axisH;
    var m0 = monthIndex('2017-07'), m1 = (today.getFullYear() + 1) * 12;
    var x = lin(m0, m1, labelW, W - 4);
    host.replaceChildren();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'group', 'aria-label': 'Career timeline, 2017 to present' }, host);

    for (var yr = 2018; yr <= today.getFullYear(); yr++) {
      var gx = x(yr * 12);
      svgEl('line', { x1: gx, x2: gx, y1: topPad - 6, y2: H - axisH, 'class': 'grid-line' }, svg);
      if (!narrow || yr % 2 === 0) svgText(svg, gx, H - 6, String(yr), 'axis-text', 'middle');
    }
    svgEl('line', { x1: labelW, x2: W, y1: H - axisH, y2: H - axisH, 'class': 'axis-line' }, svg);

    lanes.forEach(function (lane, li) {
      var y0 = topPad + li * laneH;
      if (!narrow) { svgText(svg, 0, y0 + laneH / 2 + 4, lane, 'lane-text'); return; }
      // Narrow screens: name the roles under the employer, since bars are too short to label
      svgText(svg, 0, y0 + 14, lane, 'lane-text');
      var roles = C.filter(function (c) { return c.lane === lane; }).map(function (c) { return c.short || c.role; });
      svgText(svg, 0, y0 + 30, roles.join(' · '), 'role-text');
    });

    var nx = x(nowM + 0.5);
    svgEl('line', { x1: nx, x2: nx, y1: topPad - 10, y2: H - axisH, stroke: 'var(--s1)', 'stroke-width': 1 }, svg);
    svgText(svg, nx, topPad - 14, 'Now', 'now-text', 'middle');

    C.forEach(function (c, ci) {
      var li = lanes.indexOf(c.lane), y0 = topPad + li * laneH;
      var cy = narrow ? y0 + 50 : y0 + laneH / 2;
      var s = monthIndex(c.start), e = c.end ? monthIndex(c.end) + 1 : nowM + 1;
      var bx = x(s), bw = Math.max(6, x(e) - x(s)), bh = 14;
      var when = c.when || (fmtMonth(c.start) + ' – ' + (c.end ? fmtMonth(c.end) : 'Present'));
      var label = c.role + ', ' + c.lane + ', ' + when.replace(' – ', ' to ');
      var g = svgEl('g', { 'class': 'bar-g', tabindex: 0, role: 'img', 'aria-label': label }, svg);
      svgEl('rect', { x: bx - 2, y: cy - 14, width: bw + 4, height: 28, 'class': 'bar-hit' }, g);
      var kind = c.current ? 'bar-now' : c.edu ? 'bar-edu' : 'bar-past';
      var bar = svgEl('rect', { x: bx, y: cy - bh / 2, width: bw, height: bh, rx: 4, 'class': kind + ' grow' }, g);
      bar.style.transitionDelay = (ci * 0.1) + 's';

      // Role label above the bar, only when it fits before the next bar in the lane
      if (!narrow) {
        var text = c.short || c.role;
        var next = C.filter(function (o) { return o.lane === c.lane && monthIndex(o.start) > s; })
          .map(function (o) { return x(monthIndex(o.start)); })[0];
        var room = (next != null ? next : W) - bx - 8;
        if (text.length * 6.4 < room) svgText(g, bx, cy - bh / 2 - 6, text, 'role-text');
      }

      function show(px, py) {
        tipOpen(function (t) {
          el('div', 't-val', c.role, t);
          el('div', 't-name', c.lane, t);
          el('div', 't-muted', c.when ? c.when : when + ' · ' + fmtSpan(e - s), t);
        }, px, py);
      }
      g.addEventListener('pointermove', function (ev) { show(ev.clientX, ev.clientY); });
      g.addEventListener('pointerleave', tipClose);
      g.addEventListener('focus', function () { var p = svgPointToClient(svg, bx + bw / 2, cy); show(p.x, p.y); });
      g.addEventListener('blur', tipClose);
    });
  }

  /* ---------- Scroll: reveal and nav state ---------- */
  var visibleCallbacks = [];
  // Fire as soon as an element's top edge is a little way into the viewport, so tall cards don't wait
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      visibleCallbacks = visibleCallbacks.filter(function (cb) {
        if (cb.el === en.target || en.target.contains(cb.el)) { cb.fn(); return false; }
        return true;
      });
      io.unobserve(en.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -6% 0px' }) : null;

  function onVisible(node, fn) {
    if (!io || reduceMotion) { fn(); return; }
    var r = node.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.94 && r.bottom > 0) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); return; }
    visibleCallbacks.push({ el: node, fn: fn });
    io.observe(node);
  }

  function initReveal() {
    var targets = $$('.reveal, .career-chart');
    if (!io || reduceMotion) { targets.forEach(function (t) { t.classList.add('is-in'); }); return; }
    targets.forEach(function (t) { io.observe(t); });
  }

  function initNav() {
    var links = $$('.topbar nav a');
    var bar = $('.topbar');
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    if ('IntersectionObserver' in window) {
      var navIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && map[en.target.id]) {
            links.forEach(function (a) { a.classList.remove('is-active'); });
            map[en.target.id].classList.add('is-active');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) navIO.observe(s); });
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        if (bar) bar.classList.toggle('is-scrolled', document.documentElement.scrollTop > 8);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initTheme() {
    var btn = $('.theme-toggle');
    if (!btn) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function current() { return document.documentElement.dataset.theme || (mq.matches ? 'dark' : 'light'); }
    function label() { btn.setAttribute('aria-label', current() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); }
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
      label();
    });
    label();
  }

  /* ---------- Boot ---------- */
  function renderAll() { renderRidge(); renderStatewide(); renderCareer(); }
  function init() {
    var year = $('#year');
    if (year) year.textContent = new Date().getFullYear();
    initTheme();
    initNav();
    initReveal();
    buildRidgeTable();
    buildStatewideTable();
    renderAll();
    var lastW = window.innerWidth, timer = null;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(function () { tipClose(); renderAll(); }, 150);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
