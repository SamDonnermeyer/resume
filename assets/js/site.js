/* Sam Donnermeyer · site interactions and charts. No dependencies. */
(function () {
  'use strict';

  var D = window.SITE_DATA;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  /* ---------- Hero: snowpack ridgeline ---------- */
  var ridgeState = { active: -1, day: 0, animated: false };
  function renderRidge() {
    var host = $('#ridge');
    if (!host || !D) return;
    var W = Math.round(host.clientWidth);
    if (!W) return;
    var narrow = W < 640;
    var H = narrow ? 300 : 440;
    var R = D.snow.ridges, N = R.length, days = D.snow.days;
    var topPad = narrow ? 30 : 34, axisH = 24, rise = narrow ? 8 : 10.5;
    var step = (H - topPad - axisH) / (N - 1 + rise);
    var amp = step * rise;
    var maxV = Math.max.apply(null, R.map(function (r) { return r.peak; }));
    var x = lin(0, days - 1, 0, W);
    function base(i) { return topPad + amp + i * step; }
    function yv(i, tenths) { return base(i) - (tenths / 10) / maxV * amp; }

    host.replaceChildren();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true' }, host);
    var clipId = 'ridge-clip';
    var clip = svgEl('clipPath', { id: clipId }, svgEl('defs', null, svg));
    var clipRect = svgEl('rect', { x: 0, y: 0, width: ridgeState.animated || reduceMotion ? W : 0, height: H }, clip);

    var m0 = dayOf('2026-03-01'), m1 = dayOf('2026-03-31');
    var ridgesG = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' }, svg);
    var feature = 0;
    R.forEach(function (r, i) { if (r.peak > R[feature].peak) feature = i; });
    var groups = [];
    R.forEach(function (r, i) {
      var pts = r.v.map(function (v, k) { return [x(k), yv(i, v)]; });
      var line = pathFrom(pts);
      var area = line + 'L' + x(days - 1).toFixed(1) + ',' + base(i).toFixed(1) + 'L' + x(0).toFixed(1) + ',' + base(i).toFixed(1) + 'Z';
      var g = svgEl('g', { 'class': 'ridge-g' + (i === feature ? ' is-feature' : '') }, ridgesG);
      g.style.setProperty('--depth', (0.38 + 0.42 * i / (N - 1)).toFixed(3));
      svgEl('path', { d: area, 'class': 'ridge-fill' }, g);
      svgEl('path', { d: area, 'class': 'ridge-wash' }, g);
      svgEl('path', { d: line, 'class': 'ridge-line' }, g);
      groups.push(g);
    });

    // March 2026 band, laid over the ridges as a translucent wash
    var bandG = svgEl('g', { 'class': 'ridge-ann', 'pointer-events': 'none' }, svg);
    svgEl('rect', { x: x(m0), y: topPad - 8, width: x(m1) - x(m0), height: H - axisH - topPad + 14, 'class': 'band' }, bandG);

    // Axis
    var axisY = H - axisH + 6;
    svgEl('line', { x1: 0, x2: W, y1: axisY, y2: axisY, 'class': 'axis-line' }, svg);
    monthTicks.forEach(function (t, n) {
      if (narrow && n % 2) return;
      var label = MONTHS[t.m] + (t.m === 0 ? ' 2026' : t.m === 9 ? ' 2025' : '');
      svgText(svg, x(t.i) + 2, H - 2, label, 'axis-text');
    });

    // Annotations (selective: the band and the tallest peak)
    var annG = svgEl('g', { 'class': 'ridge-ann' }, svg);
    svgText(annG, x(m1) + 6, topPad - 12, narrow ? '← Record-hot March' : '← March 2026: record heat, early melt', 'ann-text halo');
    var fr = R[feature], fx = x(fr.peakDay), fy = yv(feature, Math.round(fr.peak * 10));
    svgEl('circle', { cx: fx, cy: fy, r: 4, 'class': 'dot-s1', style: 'stroke: var(--bg)' }, annG);
    var rest = narrow ? ', ' + fr.peak.toFixed(1) + ' in' : ' peaked at ' + fr.peak.toFixed(1) + ' in on ' + fmtDay(fr.peakDay);
    var estW = (fr.name.length + rest.length) * 6.4;
    var lbl = svgText(annG, Math.max(fx - 10, estW + 2), fy - 10, '', 'ann-text halo', 'end');
    var t1 = svgEl('tspan', { 'class': 'ann-strong' }, lbl); t1.textContent = fr.name;
    var t2 = svgEl('tspan', null, lbl); t2.textContent = rest;

    var hoverDot = svgEl('circle', { r: 4, 'class': 'dot-s1', style: 'stroke: var(--bg); display:none' }, svg);

    function setActive(i, k, clientX, clientY) {
      if (i === ridgeState.active && k === ridgeState.day && !clientX) return;
      ridgeState.active = i; ridgeState.day = k;
      host.classList.toggle('has-active', i >= 0);
      groups.forEach(function (g, n) { g.classList.toggle('is-active', n === i); });
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
        tipRow(t, 'vs. median peak', Math.round(100 * r.peak / r.medPeak) + '%');
      }, p.x, p.y);
    }
    function pick(px, py) {
      var k = clamp(Math.round(x.inv(px)), 0, days - 1);
      for (var i = N - 1; i >= 0; i--) {
        var top = yv(i, R[i].v[k]);
        if (py >= top - 3 && py <= base(i) + 1) return { i: i, k: k };
      }
      return { i: clamp(Math.round((py - topPad - amp) / step), 0, N - 1), k: k };
    }
    svg.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect();
      var px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * H / r.height;
      if (py > H - axisH + 6) { setActive(-1, 0); return; }
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

    // Draw-in: the season unfolds left to right
    if (!ridgeState.animated && !reduceMotion) {
      ridgeState.animated = true;
      annG.style.opacity = 0; bandG.style.opacity = 0;
      var t0 = null, dur = 2600;
      var tick = function (ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        clipRect.setAttribute('width', (W * easeInOut(p)).toFixed(1));
        if (p < 1) requestAnimationFrame(tick);
        else { annG.style.transition = bandG.style.transition = 'opacity .6s ease'; annG.style.opacity = 1; bandG.style.opacity = 1; }
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
      el('td', 'num', Math.round(100 * r.peak / r.medPeak) + '%', tr);
    });
  }

  /* ---------- Hunt Command card: statewide snowpack vs median ---------- */
  function renderStatewide() {
    var host = $('#statewide');
    if (!host || !D) return;
    var W = Math.round(host.clientWidth);
    if (!W) return;
    var narrow = W < 460;
    var H = narrow ? 220 : 250;
    var S = D.snow.statewide, days = D.snow.days;
    var padL = 30, padR = 10, padT = 22, padB = 24;
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
      if (n % 2) return;
      svgText(svg, x(t.i), H - 6, MONTHS[t.m], 'axis-text', n === 0 ? 'start' : 'middle');
    });

    var medPts = S.med.map(function (v, k) { return [x(k), y(v)]; });
    var avgPts = S.avg.map(function (v, k) { return [x(k), y(v)]; });
    svgEl('path', { d: pathFrom(medPts), 'class': 'line-de' }, svg);
    svgEl('path', { d: pathFrom(avgPts) + 'L' + x(days - 1) + ',' + y(0) + 'L' + x(0) + ',' + y(0) + 'Z', 'class': 'area-s1' }, svg);
    var avgPath = svgEl('path', { d: pathFrom(avgPts), 'class': 'line-s1' }, svg);

    var pk = 0, mpk = 0;
    S.avg.forEach(function (v, k) { if (v > S.avg[pk]) pk = k; });
    S.med.forEach(function (v, k) { if (v > S.med[mpk]) mpk = k; });
    svgEl('circle', { cx: x(mpk), cy: y(S.med[mpk]), r: 4, 'class': 'dot-de' }, svg);
    svgText(svg, x(mpk), y(S.med[mpk]) - 10, 'Median peak, ' + fmtDay(mpk), 'ann-text halo', 'middle');
    svgEl('circle', { cx: x(pk), cy: y(S.avg[pk]), r: 4, 'class': 'dot-s1' }, svg);
    svgText(svg, x(pk) - 8, y(S.avg[pk]) - 10, '2026 peak, ' + fmtDay(pk), 'ann-text halo', 'end');

    // Draw the 2026 line when it scrolls into view
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
    function show(k, cx, cy) {
      cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.style.display = '';
      dA.setAttribute('cx', x(k)); dA.setAttribute('cy', y(S.avg[k])); dA.style.display = '';
      dM.setAttribute('cx', x(k)); dM.setAttribute('cy', y(S.med[k])); dM.style.display = '';
      tipOpen(function (t) {
        var pct = S.med[k] > 0.3 ? Math.round(100 * S.avg[k] / S.med[k]) + '% of median' : 'little snow either way';
        el('div', 't-val', pct, t);
        el('div', 't-muted', fmtDay(k, true), t);
        tipKeyRow(t, 'var(--s1)', 'Water year 2026', S.avg[k].toFixed(1) + ' in');
        tipKeyRow(t, 'var(--de)', 'Median', S.med[k].toFixed(1) + ' in');
      }, cx, cy);
    }
    function hide() { cross.style.display = dA.style.display = dM.style.display = 'none'; tipClose(); }
    svg.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect();
      var px = (e.clientX - r.left) * W / r.width;
      if (px < padL - 4 || px > W - padR + 4) { hide(); return; }
      show(clamp(Math.round(x.inv(px)), 0, days - 1), e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', hide);
  }

  function buildStatewideTable() {
    var tb = $('#statewide-table tbody');
    if (!tb || !D) return;
    var S = D.snow.statewide;
    monthTicks.forEach(function (t) {
      var tr = el('tr', null, null, tb);
      el('td', null, fmtDay(t.i, true), tr);
      el('td', 'num', S.avg[t.i].toFixed(1), tr);
      el('td', 'num', S.med[t.i].toFixed(1), tr);
      el('td', 'num', S.med[t.i] > 0.3 ? Math.round(100 * S.avg[t.i] / S.med[t.i]) + '%' : '–', tr);
    });
  }

  /* ---------- CNN card: training curve ---------- */
  function renderCNN() {
    var host = $('#cnn');
    if (!host || !D) return;
    var W = Math.round(host.clientWidth);
    if (!W) return;
    var H = 160, padL = 34, padR = 14, padT = 22, padB = 22;
    var C = D.cnn, n = C.epochs.length;
    var x = lin(1, n, padL, W - padR), y = lin(0.3, 1.0, H - padB, padT);
    host.replaceChildren();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true' }, host);
    svgEl('line', { x1: padL, x2: W - padR, y1: y(0.3), y2: y(0.3), 'class': 'axis-line' }, svg);
    [0.4, 0.6, 0.8, 1.0].forEach(function (v) {
      svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), 'class': 'grid-line' }, svg);
      svgText(svg, padL - 6, y(v) + 4, Math.round(v * 100) + '%', 'axis-text', 'end');
    });
    [1, 5, 10].forEach(function (e) { svgText(svg, x(e), H - 4, e === 1 ? 'Epoch 1' : String(e), 'axis-text', e === 1 ? 'start' : 'middle'); });
    var tr = svgEl('path', { d: pathFrom(C.train.map(function (v, i) { return [x(i + 1), y(v)]; })), 'class': 'line-s2' }, svg);
    var va = svgEl('path', { d: pathFrom(C.val.map(function (v, i) { return [x(i + 1), y(v)]; })), 'class': 'line-s1' }, svg);
    svgEl('circle', { cx: x(n), cy: y(C.val[n - 1]), r: 4, 'class': 'dot-s1' }, svg);
    svgText(svg, x(n) - 8, y(C.val[n - 1]) - 9, (C.val[n - 1] * 100).toFixed(1) + '% on the validation/test set, 28 letters', 'ann-text halo', 'end');

    if (!reduceMotion && !host.dataset.drawn) {
      [tr, va].forEach(function (p, idx) {
        var len = p.getTotalLength();
        p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
        onVisible(host, function () {
          p.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1) ' + (idx * 0.15) + 's';
          p.style.strokeDashoffset = 0;
        });
      });
    }
    host.dataset.drawn = '1';

    var cross = svgEl('line', { y1: padT - 6, y2: y(0.3), 'class': 'crosshair', style: 'display:none' }, svg);
    var dV = svgEl('circle', { r: 4, 'class': 'dot-s1', style: 'display:none' }, svg);
    var dT = svgEl('circle', { r: 4, 'class': 'dot-s2', style: 'display:none' }, svg);
    svg.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect();
      var ep = clamp(Math.round(x.inv((e.clientX - r.left) * W / r.width)), 1, n);
      cross.setAttribute('x1', x(ep)); cross.setAttribute('x2', x(ep)); cross.style.display = '';
      dV.setAttribute('cx', x(ep)); dV.setAttribute('cy', y(C.val[ep - 1])); dV.style.display = '';
      dT.setAttribute('cx', x(ep)); dT.setAttribute('cy', y(C.train[ep - 1])); dT.style.display = '';
      tipOpen(function (t) {
        el('div', 't-val', 'Epoch ' + ep, t);
        tipKeyRow(t, 'var(--s1)', 'Validation / test', (C.val[ep - 1] * 100).toFixed(1) + '%');
        tipKeyRow(t, 'var(--s2)', 'Training set', (C.train[ep - 1] * 100).toFixed(1) + '%');
      }, e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', function () { cross.style.display = dV.style.display = dT.style.display = 'none'; tipClose(); });
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
    if (!host || !D) return;
    var W = Math.round(host.clientWidth);
    if (!W) return;
    var narrow = W < 600;
    var C = D.career, nowM = monthIndex(D.now);
    var lanes = [];
    C.forEach(function (c) { if (lanes.indexOf(c.lane) < 0) lanes.push(c.lane); });
    var labelW = narrow ? 0 : 230, laneH = narrow ? 58 : 52, topPad = 26, axisH = 26;
    var H = topPad + lanes.length * laneH + axisH;
    var m0 = monthIndex('2017-07'), m1 = monthIndex('2027-01');
    var x = lin(m0, m1, labelW, W - 4);
    host.replaceChildren();
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'group', 'aria-label': 'Career timeline, 2017 to present' }, host);

    for (var yr = 2018; yr <= 2026; yr++) {
      var gx = x(yr * 12);
      svgEl('line', { x1: gx, x2: gx, y1: topPad - 6, y2: H - axisH, 'class': 'grid-line' }, svg);
      if (!narrow || yr % 2 === 0) svgText(svg, gx, H - 6, String(yr), 'axis-text', 'middle');
    }
    svgEl('line', { x1: labelW, x2: W, y1: H - axisH, y2: H - axisH, 'class': 'axis-line' }, svg);

    lanes.forEach(function (lane, li) {
      var y0 = topPad + li * laneH;
      if (narrow) svgText(svg, 0, y0 + 14, lane, 'lane-text');
      else svgText(svg, 0, y0 + laneH / 2 + 4, lane, 'lane-text');
    });

    var nx = x(nowM + 0.5);
    svgEl('line', { x1: nx, x2: nx, y1: topPad - 10, y2: H - axisH, stroke: 'var(--s1)', 'stroke-width': 1 }, svg);
    svgText(svg, nx, topPad - 14, 'Now', 'now-text', 'middle');

    C.forEach(function (c, ci) {
      var li = lanes.indexOf(c.lane), y0 = topPad + li * laneH;
      var cy = narrow ? y0 + 38 : y0 + laneH / 2 + (c.current ? 0 : 0);
      var s = monthIndex(c.start), e = c.end ? monthIndex(c.end) + 1 : nowM + 1;
      var bx = x(s), bw = Math.max(6, x(e) - x(s)), bh = 14;
      var label = c.role + ', ' + c.lane + ', ' + fmtMonth(c.start) + ' to ' + (c.end ? fmtMonth(c.end) : 'present');
      var g = svgEl('g', { 'class': 'bar-g', tabindex: 0, role: 'img', 'aria-label': label }, svg);
      svgEl('rect', { x: bx - 2, y: cy - 14, width: bw + 4, height: 28, 'class': 'bar-hit' }, g);
      var bar = svgEl('rect', { x: bx, y: cy - bh / 2, width: bw, height: bh, rx: 4, 'class': (c.current ? 'bar-now' : 'bar-past') + ' grow' }, g);
      bar.style.transitionDelay = (ci * 0.12) + 's';

      // Role label above the bar, only when it fits before the next bar in the lane
      var next = C.filter(function (o) { return o.lane === c.lane && monthIndex(o.start) > s; })
        .map(function (o) { return x(monthIndex(o.start)); })[0];
      var room = (next != null ? next : W) - bx - 8;
      var est = c.role.length * 6.4;
      if (!narrow && est < room) svgText(g, bx, cy - bh / 2 - 6, c.role, 'role-text');
      else if (narrow && c.current && est < W - bx) svgText(g, Math.min(bx, W - est), cy - bh / 2 - 6, c.role, 'role-text');

      function show(px, py) {
        tipOpen(function (t) {
          el('div', 't-val', c.role, t);
          el('div', 't-name', c.lane, t);
          el('div', 't-muted', fmtMonth(c.start) + ' – ' + (c.end ? fmtMonth(c.end) : 'Present') + ' · ' + fmtSpan(e - s), t);
        }, px, py);
      }
      g.addEventListener('pointermove', function (ev) { show(ev.clientX, ev.clientY); });
      g.addEventListener('pointerleave', tipClose);
      g.addEventListener('focus', function () { var p = svgPointToClient(svg, bx + bw / 2, cy); show(p.x, p.y); });
      g.addEventListener('blur', tipClose);
    });
  }

  /* ---------- Scroll: reveal, nav state, progress ---------- */
  var visibleCallbacks = [];
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
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }) : null;

  function onVisible(node, fn) {
    if (!io || reduceMotion) { fn(); return; }
    var r = node.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92 && r.bottom > 0) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); return; }
    visibleCallbacks.push({ el: node, fn: fn });
    io.observe(node);
  }

  function initReveal() {
    var targets = $$('.reveal, .skill-area, .career-chart, .pipeline');
    if (!io || reduceMotion) { targets.forEach(function (t) { t.classList.add('is-in'); }); return; }
    targets.forEach(function (t) { io.observe(t); });
  }

  function initNav() {
    var links = $$('.topbar nav a');
    var bar = $('.topbar'), prog = $('.progress');
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
        var h = document.documentElement;
        var p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
        if (prog) prog.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        if (bar) bar.classList.toggle('is-scrolled', h.scrollTop > 8);
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
  function renderAll() { renderRidge(); renderStatewide(); renderCNN(); renderCareer(); }
  function init() {
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
