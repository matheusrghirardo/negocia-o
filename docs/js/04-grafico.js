'use strict';
/* ============================================================================
   INTERFACE (parte 1): estado, laço principal, gráfico-túnel, régua, barra do dia
   ============================================================================ */
const $ = id => document.getElementById(id);
const DT = CONFIG.simStepSec;
const FONT = '"Geist Variable",system-ui,-apple-system,"Segoe UI",sans-serif';
const LOCK = '<svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true" style="vertical-align:-1px"><rect x="1" y="4.4" width="7" height="5.2" rx="1" fill="currentColor"/><path d="M2.6 4.6V3.2a1.9 1.9 0 0 1 3.8 0v1.4" stroke="currentColor" fill="none" stroke-width="1.3"/></svg>';

const UI = {
  E: null, seed: 0, focus: null, speed: 'normal', paused: false, slowmo: true, slowActive: false,
  intensity: 'normal', tab: 'grafico', mapView: 'blocos', feedFilter: 'todos', btab: 'feed', mobile: false, compact: false, lesGrp: null,
  matchFlash: [], bookTtSeen: 0, bookTtTicker: null,
  chart: { zoom: 300, day: false, live: true, viewEnd: 0, full: false, ymin: NaN, ymax: NaN, yTk: null, hover: null, drag: null,
    margin: null, pw: 1, span: 300, t0: 0, t1: 0, padT: 34, show: { ult: true, med: true, est: true, rej: true, prot: true } },
  pal: {}, patterns: {}, reduced: false, ff: null, lastFeedId: 0, sparks: [], parts: [], lights: {},
  gate: { v: 0 }, reg: { base: null }, own: [], bol: { side: 1, type: 0, qtyMode: 0, pT: null }, blocks: {},
  lastUi: 0, acc: 0, lastT: 0, summaryShown: false, cbMin: false, panelKey: null, lastPart: 0, tipKey: '',
  vis: { map: true, focus: true, rail: true, trades: true, events: true }, tourAsked: false  // partes da página à vista
};

/* ----------------------------- cores ----------------------------- */
function readPalette() {
  const cs = getComputedStyle(document.documentElement), P = {};
  for (const k of ['bg', 'panel', 'panel2', 'line', 'line2', 'text', 'muted', 'faint', 'up', 'down', 'amber', 'amber2', 'violet', 'rasp', 'cyan', 'gray', 'accent', 'brown', 'blue', 'ink', 'wall', 'onamb', 'onacc'])
    P[k] = cs.getPropertyValue('--' + k).trim() || '#888888';
  UI.pal = P; UI.patterns = {}; UI._rgba = {};
}
function rgba(hex, a) {
  const key = hex + a; const c = UI._rgba[key]; if (c) return c;
  let h = String(hex).replace('#', '').trim(); if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const n = parseInt(h, 16); const s = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  UI._rgba[key] = s; return s;
}
function hatch(ctx, color, alpha, dpr) {
  const key = color + alpha + dpr; if (UI.patterns[key]) return UI.patterns[key];
  const s = 7, d = Math.round(s * dpr), c = document.createElement('canvas'); c.width = c.height = d;
  const x = c.getContext('2d'); x.strokeStyle = rgba(color, alpha); x.lineWidth = Math.max(1, dpr);
  x.beginPath(); x.moveTo(0, d); x.lineTo(d, 0); x.moveTo(-d / 2, d / 2); x.lineTo(d / 2, -d / 2); x.moveTo(d / 2, d * 1.5); x.lineTo(d * 1.5, d / 2); x.stroke();
  const p = ctx.createPattern(c, 'repeat');
  try { p.setTransform(new DOMMatrix().scale(1 / dpr)); } catch (e) { /* navegador antigo: padrão um pouco maior */ }
  UI.patterns[key] = p; return p;
}

/* ----------------------------- tipos de leilão: nome, cor e ícone -----------------------------
   Um vocabulário só para o gráfico, o painel, o mapa, a linha do tempo e o guia. Leilões de negócio têm cor
   própria (laranja, índigo, cinza, laranja); calls ficam em azul, com borda tracejada. Ícones 16×16, só traço. */
const AUC_KIND = {
  ult:        { n: 'Último preço', full: 'Leilão por último preço', col: 'amber', call: false,
                ico: 'M1.5 4h13M1.5 12h13M8 14.5v-9M5 8.5l3-3 3 3', how: 'o negócio sairia fora do tubo laranja' },
  med:        { n: 'Preço médio', full: 'Leilão por preço médio', col: 'violet', call: false,
                ico: 'M1.5 4.5h2.5M6.7 4.5h2.6M12 4.5h2.5M1.5 11.5h2.5M6.7 11.5h2.6M12 11.5h2.5M2.5 8.8l3.6-2.4 3 3 4.4-3.4', how: 'o negócio se afastaria da média dos últimos negócios' },
  est:        { n: 'Estático', full: 'Leilão pelo túnel estático', col: 'gray', call: false,
                ico: 'M2 4.5h.01M5.4 4.5h.01M8.7 4.5h.01M12 4.5h.01M14 4.5h.01M2 11.5h.01M5.4 11.5h.01M8.7 11.5h.01M12 11.5h.01M14 11.5h.01M8 6.5v3', how: 'o negócio passaria do limite fixo do dia' },
  qtd:        { n: 'Quantidade', full: 'Leilão por quantidade', col: 'brown', call: false,
                ico: 'M2 3.5h12M2 8h8.5M2 12.5h5', how: 'a oferta é grande demais, seja qual for o preço' },
  call_open:  { n: 'Call de abertura', full: 'Call de abertura', col: 'blue', call: true,
                ico: 'M1.5 12.5h13M4 12.5a4 4 0 0 1 8 0M8 3v2.2M3.2 6.2l1.5 1.5M12.8 6.2l-1.5 1.5', how: 'as ofertas se acumulam antes da abertura' },
  call_close: { n: 'Call de fechamento', full: 'Call de fechamento', col: 'blue', call: true,
                ico: 'M4 14V2.5M4 3.5h8l-2 2.6 2 2.6H4', how: 'o preço de fechamento sai deste leilão' },
  reopen:     { n: 'Reabertura', full: 'Call de reabertura (circuit breaker)', col: 'blue', call: true,
                ico: 'M13.5 8a5.5 5.5 0 1 1-1.8-4.1M13.5 2.5v3.6h-3.6', how: 'o mercado volta de uma parada geral' }
};
const PRORR_KIND = { prot_preco: 'prot', prot_qtd: 'prot', alt60: 'alt', alt30: 'alt', alt15: 'alt', sem_teorico: 'none' };
const PRORR_STYLE = {
  prot: { col: 'cyan', n: 'proteção', ico: 'M8 1.5l5.5 2v4.2c0 3.2-2.4 5.6-5.5 6.8-3.1-1.2-5.5-3.6-5.5-6.8V3.5z' },
  alt:  { col: 'amber', n: 'alteração', ico: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z' },
  none: { col: 'gray', n: 'sem teórico', ico: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM4 12L12 4' }
};
const aucKey = a => a.kind === 'auction' ? a.trig.kind : a.kind;
const prorrSty = code => PRORR_STYLE[PRORR_KIND[code] || 'none'];
const icoSVG = (d, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
const _P2D = {};
function drawIco(ctx, d, cx, cy, s, color, lw) {
  const q = _P2D[d] || (_P2D[d] = new Path2D(d));
  ctx.save(); ctx.translate(cx - s / 2, cy - s / 2); ctx.scale(s / 16, s / 16);
  ctx.strokeStyle = color; ctx.lineWidth = (lw || 1.6) * 16 / s; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.stroke(q); ctx.restore();
}
/* pílula com ícone (fg: texto, bg: fundo, ic: cor do ícone) */
function kindPill(ctx, x, y, d, text, fg, bg, ic, align) {
  ctx.font = '600 11px ' + FONT; const w = ctx.measureText(text).width + 26, h = 17, xa = align === 'right' ? x - w : x;
  ctx.fillStyle = bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(xa, y, w, h, 5); else ctx.rect(xa, y, w, h); ctx.fill();
  drawIco(ctx, d, xa + 10, y + h / 2, 11, ic, 1.5);
  ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, xa + 18, y + h / 2 + 0.5);
  return w;
}

/* ----------------------------- canvas ----------------------------- */
function mkCanvas(id) {
  const cv = $(id), c = { cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  c.fit = () => {
    const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    if (w === c.w && h === c.h && dpr === c.dpr) return;
    c.w = w; c.h = h; c.dpr = dpr; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
  };
  try { new ResizeObserver(() => c.fit()).observe(cv.parentElement); } catch (e) { window.addEventListener('resize', c.fit); }
  c.fit(); return c;
}
function fitSmall(cv) {
  const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
  if (cv._w !== w || cv._h !== h || cv._d !== dpr) { cv._w = w; cv._h = h; cv._d = dpr; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

/* ----------------------------- formatação auxiliar ----------------------------- */
function chgText(i, p) {
  if (p == null) return '—';
  if (i.cur === '%') { const d = (p - i.prevCloseT) * i.tick; return (d > 0 ? '+' : d < 0 ? '−' : '') + fnum(Math.abs(d), 3) + ' p.p.'; }
  return fpct(p / i.prevCloseT - 1, 2);
}
function chgCls(i, p) { if (p == null) return 'flat'; return p > i.prevCloseT ? 'up' : (p < i.prevCloseT ? 'down' : 'flat'); }
function distLbl(i, v, base) {
  if (i.cur === '%') { const d = (v - base) * i.tick; return (d > 0 ? '+' : d < 0 ? '−' : '') + fnum(Math.abs(d), 2) + ' p.p.'; }
  return fpct(v / base - 1, Math.abs(v / base - 1) < 0.1 ? 1 : 0);
}
function niceStep(range, n) {
  const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function stepDec(i, step) { if (i.tick >= 1) return 0; return clamp(Math.ceil(-Math.log10(step) - 1e-9), 0, i.dec); }
function inAuctionLike(i) { return (i.state === ST.AUC || i.state === ST.CALL) && i.auction; }
function dispPriceT(i) { const a = i.auction; return inAuctionLike(i) && a.theo != null ? a.theo : i.refT(); }
function baseMethodName(i) {
  if (i.isOpt) return 'referência Black-Scholes (assíncrono)';
  const m = { CLAST: 'C-LAST', LTP: 'LTP', MOSTRECENT: 'most recent' }[i.g.priceBase] || i.g.priceBase;
  return i.g.stepped ? m + ', centro em degraus' : m;
}
function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

/* ----------------------------- séries: varredura e agregação por pixel ----------------------------- */
function forSeg(S, t0, t1, tNow, cb) {
  const T = S.t, n = T.length; if (!n) return;
  let i = S.idx(t0); if (i < 0) i = 0;
  for (; i < n; i++) {
    const a = T[i]; if (a > t1) break;
    const b = i + 1 < n ? T[i + 1] : tNow;
    if (b <= t0 || b <= a) continue;
    cb(a < t0 ? t0 : a, b > t1 ? t1 : b, i);
  }
}
function buckets(S, k, t0, t1, tNow, X, x0, n) {
  const f = new Float64Array(n), mn = new Float64Array(n), mx = new Float64Array(n), l = new Float64Array(n), has = new Uint8Array(n);
  const V = S.v[k];
  forSeg(S, t0, t1, tNow, (a, b, j) => {
    const v = V[j]; if (v !== v) return;
    let c0 = Math.floor(X(a) - x0), c1 = Math.ceil(X(b) - x0) - 1; if (c1 < c0) c1 = c0;
    if (c0 < 0) c0 = 0; if (c1 > n - 1) c1 = n - 1;
    for (let c = c0; c <= c1; c++) {
      if (!has[c]) { has[c] = 1; f[c] = mn[c] = mx[c] = l[c] = v; }
      else { if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; l[c] = v; }
    }
  });
  return { f, mn, mx, l, has, n };
}
function lineB(ctx, B, x0, Y, mul) {
  ctx.beginPath(); let pen = false;
  for (let c = 0; c < B.n; c++) {
    if (!B.has[c]) { pen = false; continue; }
    const x = x0 + c, yf = Y(B.f[c] * mul);
    if (!pen) { ctx.moveTo(x, yf); pen = true; } else ctx.lineTo(x, yf);
    if (B.mn[c] !== B.mx[c]) { ctx.lineTo(x, Y(B.mn[c] * mul)); ctx.lineTo(x, Y(B.mx[c] * mul)); }
    const yl = Y(B.l[c] * mul); ctx.lineTo(x, yl); ctx.lineTo(x + 1, yl);
  }
  ctx.stroke();
}
function fillBand(ctx, Blo, Bhi, x0, Y, mul) {
  let rs = -1, y1 = 0, y2 = 0;
  const flush = c => { if (rs >= 0) { ctx.fillRect(x0 + rs, y1, c - rs, y2 - y1); rs = -1; } };
  for (let c = 0; c < Blo.n; c++) {
    if (!Blo.has[c] || !Bhi.has[c]) { flush(c); continue; }
    const a = Math.round(Y(Bhi.mx[c] * mul)), b = Math.round(Y(Blo.mn[c] * mul));
    if (rs >= 0 && a === y1 && b === y2) continue;
    flush(c); rs = c; y1 = a; y2 = b;
  }
  flush(Blo.n);
}
function fillBeyond(ctx, B, x0, Y, mul, edge, above) {
  let rs = -1, ry = 0;
  const flush = c => { if (rs < 0) return; if (above) ctx.fillRect(x0 + rs, edge, c - rs, ry - edge); else ctx.fillRect(x0 + rs, ry, c - rs, edge - ry); rs = -1; };
  for (let c = 0; c < B.n; c++) {
    if (!B.has[c]) { flush(c); continue; }
    const y = Math.round(Y((above ? B.mx[c] : B.mn[c]) * mul));
    if (rs >= 0 && y === ry) continue;
    flush(c); rs = c; ry = y;
  }
  flush(B.n);
}
function pill(ctx, x, y, text, fg, bg, align) {
  ctx.font = '600 11px ' + FONT; const w = ctx.measureText(text).width + 10, h = 17;
  const xa = align === 'right' ? x - w : x;
  ctx.fillStyle = bg; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(xa, y, w, h, 5); else ctx.rect(xa, y, w, h);
  ctx.fill(); ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, xa + 5, y + h / 2 + 0.5);
  return w;
}

/* ----------------------------- laço principal ----------------------------- */
function effSpeed() {
  const base = CONFIG.speeds[UI.speed], E = UI.E; let slow = false;
  if (UI.slowmo && !UI.ff) {
    const f = UI.focus;
    if (f && f.state === ST.AUC) slow = true;
    else for (const i of E.insts) { const a = i.auction; if (a && i.state === ST.CALL && a.plannedEnd - E.t <= 60) { slow = true; break; } }
  }
  UI.slowActive = slow && base > CONFIG.speeds.lento;
  return UI.slowActive ? CONFIG.speeds.lento : base;
}
function frame(now) {
  requestAnimationFrame(frame);
  const E = UI.E; if (!E) return;
  const realDt = Math.min(0.1, Math.max(0, (now - (UI.lastT || now)) / 1000)); UI.lastT = now;
  const t0 = performance.now();
  try {
    if (UI.ff) runFF(t0);
    else if (!UI.paused && !E.ended) {
      const sp = effSpeed(); UI.acc += realDt * sp; let n = 0;
      while (UI.acc >= DT && n < CONFIG.maxStepsPerFrame) {
        E.step(DT); UI.acc -= DT; n++;
        if (UI.paused || UI.ff) break;               // a aula pode pausar no meio do lote
        if ((n & 7) === 0) {
          if (performance.now() - t0 > CONFIG.frameBudgetMs) { UI.acc = Math.min(UI.acc, DT * 8); break; }
          if (effSpeed() < sp) { UI.acc = Math.min(UI.acc, DT); break; }
        }
      }
      if (n >= CONFIG.maxStepsPerFrame) UI.acc = Math.min(UI.acc, DT * 8);
    }
    lesAfterFrame();
    drainEvents();
    if (UI.vis.focus) { drawChart(); drawRegua(); if (!$('miniWrap').hidden) drawMini(); }
    if (now - UI.lastUi > CONFIG.uiRefreshMs) { UI.lastUi = now; refreshDOM(false); }
    if (E.ended && !UI.summaryShown && !UI.ff) { UI.summaryShown = true; refreshDOM(true); showSummary(); }
  } catch (err) { console.error(err); }
}
function runFF(t0) {
  const E = UI.E, f = UI.ff;
  while (E.t < f.target - 1e-9 && !E.ended && performance.now() - t0 < 32) E.step(Math.min(CONFIG.ffStepSec, f.target - E.t));
  if (E.t >= f.target - 1e-6 || E.ended) {
    UI.ff = null; E.silent = false; E.events.length = 0; UI.acc = 0; hideToast();
    UI.chart.live = true; UI.chart.ymin = NaN;
    if (f.after) f.after();
  } else {
    const k = (E.t - f.start) / Math.max(1, f.target - f.start);
    showToast(`${f.msg} ${Math.round(k * 100)}%`, 0);
  }
}
function jumpTo(target, msg, after) {
  const E = UI.E;
  if (E.t >= target) { if (after) after(); return false; }
  UI.ff = { target, start: E.t, msg: msg || `Avançando até ${hm(target)}…`, after };
  E.silent = true; UI.parts = []; UI.sparks = [];
  return true;
}

/* ----------------------------- eventos do motor → animações ----------------------------- */
function drainEvents() {
  const E = UI.E, ev = E.events; if (!ev.length) return;
  const now = performance.now(), ftk = UI.focus.ticker;
  for (const e of ev) {
    switch (e.k) {
      case 'order': if (e.tk === ftk) spawnParticle(e, now); break;
      case 'rej': pulseBlock(e.tk); if (e.tk === ftk) spawnSpark(e, now); break;
      case 'fact': UI.lights[e.f] = now; break;
      case 'aucStart': if (e.tk === ftk) UI.gate.flash = now; break;
      case 'aucEnd': if (e.tk === ftk) UI.reg.recenter = now; break;
      case 'own': UI.ownDirty = true; break;
      case 'cb': UI.cbMin = false; break;
    }
  }
  ev.length = 0;
}
function spawnParticle(e, now) {
  const P = UI.parts, important = e.out === 'rej' || e.out === 'trig' || e.own;
  if (UI.reduced && !important) return;
  if (!important) { if (P.length >= 34 || now - UI.lastPart < 55) return; UI.lastPart = now; }
  else if (P.length >= 40) { const k = P.findIndex(p => p.out !== 'rej' && p.out !== 'trig' && !p.own); if (k >= 0) P.splice(k, 1); else P.shift(); }
  P.push({ born: now, side: e.side, p: e.p, out: e.out, own: e.own, bound: e.bound });
}
function spawnSpark(e, now) {
  UI.sparks.push({ born: now, t: UI.E.t, p: e.p, side: e.side, bound: e.bound });
  if (UI.sparks.length > 10) UI.sparks.shift();
}
function pulseBlock(tk) {
  const B = UI.blocks[tk]; if (!B) return;
  const now = performance.now(); if (now - (B.lastPulse || 0) < 300) return; B.lastPulse = now;
  B.pz.classList.remove('go'); void B.pz.offsetWidth; B.pz.classList.add('go');
}

/* ============================ GRÁFICO-TÚNEL ============================ */
function liveMarginTarget(i, span) {
  const a = i.auction;
  if (a) return clamp(a.plannedEnd - UI.E.t + span * 0.05, span * 0.06, span * 0.62);
  return span * 0.06;
}
function animEnd(a) {
  if (a._de == null || UI.reduced) a._de = a.plannedEnd; else a._de += (a.plannedEnd - a._de) * 0.12;
  if (Math.abs(a._de - a.plannedEnd) < 0.05) a._de = a.plannedEnd;
  return a._de;
}
function yRange(i, t0, t1, tNow) {
  const tick = i.tick, sh = UI.chart.show, full = UI.chart.full, h = i.hist;
  let mn = Infinity, mx = -Infinity;
  const scan = (S, k, a, b, now) => { const V = S.v[k]; forSeg(S, a, b, now, (x, y, j) => { const v = V[j]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }); };
  scan(h.price, 0, t0, t1, tNow);
  if (sh.ult) { scan(h.ult, 0, t0, t1, tNow); scan(h.ult, 1, t0, t1, tNow); }
  if (full) {
    if (sh.med) { scan(h.med, 0, t0, t1, tNow); scan(h.med, 1, t0, t1, tNow); }
    if (sh.est) { scan(h.est, 0, t0, t1, tNow); scan(h.est, 1, t0, t1, tNow); }
    if (sh.rej) { scan(h.rej, 0, t0, t1, tNow); scan(h.rej, 1, t0, t1, tNow); }
  }
  for (const a of i.auctions) {
    const end = a.ended ? a.t1 : tNow; if (end < t0 || a.t0 > t1) continue;
    scan(a.theoS, 0, Math.max(t0, a.t0), Math.min(t1, end), end);
    if (sh.prot && (a.kind === 'auction' || full)) { mn = Math.min(mn, a.prot.lo); mx = Math.max(mx, a.prot.hi); }
    if (a.ended && a.price != null) { mn = Math.min(mn, a.price); mx = Math.max(mx, a.price); }
  }
  if (!isFinite(mn)) { const r = i.refT(); mn = mx = r; if (i.tun.ult && sh.ult) { mn = i.tun.ult.lo; mx = i.tun.ult.hi; } }
  let lo = mn * tick, hi = mx * tick;
  const pad = Math.max((hi - lo) * 0.08, tick * 2); lo -= pad; hi += pad;
  const minSpan = tick * 10; if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  return { min: lo, max: hi };
}
function drawChart() {
  const C = UI.cc; if (!C || C.w < 50 || C.h < 60) return;
  const E = UI.E, i = UI.focus, P = UI.pal, ch = UI.chart, ctx = C.ctx, W = C.w, H = C.h, tick = i.tick;
  ctx.setTransform(C.dpr, 0, 0, C.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const padL = 4, padR = UI.mobile ? 50 : 60, padT = ch.padT, padB = 36;
  const pw = W - padL - padR, ph = H - padT - padB; if (pw < 40 || ph < 30) return;
  const x0 = padL, n = Math.max(1, Math.floor(pw)), now = E.t;
  let t0, t1;
  if (ch.day) { t0 = E.T.fPre; t1 = DAY('18:30'); }
  else {
    const span = ch.zoom, tm = liveMarginTarget(i, span);
    ch.margin = ch.margin == null || UI.reduced ? tm : ch.margin + (tm - ch.margin) * 0.1;
    if (ch.live) ch.viewEnd = now + ch.margin;
    t1 = ch.viewEnd; t0 = t1 - span;
  }
  const span = t1 - t0; ch.pw = pw; ch.span = span; ch.t0 = t0; ch.t1 = t1; ch.x0 = x0; ch.padR = padR; ch.ph = ph;
  const X = t => x0 + (t - t0) / span * pw;
  const yr = yRange(i, t0, Math.min(t1, now), now);
  if (ch.yTk !== i.ticker || !isFinite(ch.ymin)) { ch.ymin = yr.min; ch.ymax = yr.max; ch.yTk = i.ticker; }
  else { const k = UI.reduced ? 1 : 0.14; ch.ymin += (yr.min - ch.ymin) * k; ch.ymax += (yr.max - ch.ymax) * k; }
  const ymin = ch.ymin, ymax = ch.ymax, Y = p => padT + (1 - (p - ymin) / (ymax - ymin)) * ph;
  ch.ylo = ymin; ch.yhi = ymax;

  // grade
  ctx.font = '11px ' + FONT; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
  const step = niceStep(ymax - ymin, Math.max(3, ph / 46)), dec = stepDec(i, step);
  ctx.strokeStyle = rgba(P.line2, 0.45); ctx.setLineDash([2, 4]); ctx.fillStyle = P.faint; ctx.textAlign = 'left';
  for (let v = Math.ceil(ymin / step) * step; v <= ymax; v += step) {
    const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke();
    ctx.fillText(fnum(v, dec), x0 + pw + 6, y);
  }
  ctx.setLineDash([]);
  const tstep = span <= 420 ? 60 : span <= 2400 ? 300 : (pw > 760 ? 1800 : 3600);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let t = Math.ceil(t0 / tstep) * tstep; t <= t1; t += tstep) {
    const x = Math.round(X(t)) + 0.5; ctx.strokeStyle = rgba(P.line2, 0.25);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
    ctx.fillStyle = P.faint; ctx.fillText(hm(t), x, padT + ph + 20);
  }
  // referência: fechamento anterior / ajuste
  const refP = i.prevCloseT * tick;
  if (refP > ymin && refP < ymax) {
    const y = Math.round(Y(refP)) + 0.5; ctx.strokeStyle = rgba(P.muted, 0.55); ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = P.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(i.isDeriv ? 'ref. anterior' : 'fech. anterior', x0 + 4, y - 2);
  }

  ctx.save(); ctx.beginPath(); ctx.rect(x0, padT, pw, ph); ctx.clip();
  const sh = ch.show, h = i.hist;
  // futuro (à direita do agora)
  const xn = X(now);
  if (xn < x0 + pw) { ctx.fillStyle = rgba(P.panel2, 0.5); ctx.fillRect(xn, padT, x0 + pw - xn, ph); }
  // túneis em camadas, como na régua: corredor livre → zona de leilão (laranja) → rejeição (cinza hachurado)
  const rLo = sh.rej ? buckets(h.rej, 0, t0, t1, now, X, x0, n) : null, rHi = sh.rej ? buckets(h.rej, 1, t0, t1, now, X, x0, n) : null;
  const uLo = sh.ult ? buckets(h.ult, 0, t0, t1, now, X, x0, n) : null, uHi = sh.ult ? buckets(h.ult, 1, t0, t1, now, X, x0, n) : null;
  if (sh.ult) {
    ctx.fillStyle = rgba(P.accent, 0.045); fillBand(ctx, uLo, uHi, x0, Y, tick);
    ctx.fillStyle = rgba(P.amber, 0.10);
    if (sh.rej) { fillBand(ctx, uHi, rHi, x0, Y, tick); fillBand(ctx, rLo, uLo, x0, Y, tick); }
    else { fillBeyond(ctx, uHi, x0, Y, tick, padT, true); fillBeyond(ctx, uLo, x0, Y, tick, padT + ph, false); }
  }
  // rejeição: área além do túnel hachurada
  if (sh.rej) {
    ctx.fillStyle = rgba(P.wall, 0.07);
    fillBeyond(ctx, rHi, x0, Y, tick, padT, true); fillBeyond(ctx, rLo, x0, Y, tick, padT + ph, false);
    ctx.fillStyle = hatch(ctx, P.wall, 0.4, C.dpr);
    fillBeyond(ctx, rHi, x0, Y, tick, padT, true); fillBeyond(ctx, rLo, x0, Y, tick, padT + ph, false);
    ctx.strokeStyle = P.wall; ctx.lineWidth = 2; lineB(ctx, rHi, x0, Y, tick); lineB(ctx, rLo, x0, Y, tick);
  }
  if (sh.est) {
    ctx.strokeStyle = P.gray; ctx.lineWidth = 2; ctx.setLineDash([1.5, 3.5]); ctx.lineCap = 'round';
    lineB(ctx, buckets(h.est, 0, t0, t1, now, X, x0, n), x0, Y, tick); lineB(ctx, buckets(h.est, 1, t0, t1, now, X, x0, n), x0, Y, tick);
    ctx.setLineDash([]); ctx.lineCap = 'butt';
  }
  if (sh.med) {
    ctx.strokeStyle = P.violet; ctx.lineWidth = 1.8; ctx.setLineDash([6, 4]);
    lineB(ctx, buckets(h.med, 0, t0, t1, now, X, x0, n), x0, Y, tick); lineB(ctx, buckets(h.med, 1, t0, t1, now, X, x0, n), x0, Y, tick);
    ctx.setLineDash([]);
  }
  if (sh.ult) {
    ctx.strokeStyle = P.amber; ctx.lineWidth = 2.6; lineB(ctx, uHi, x0, Y, tick); lineB(ctx, uLo, x0, Y, tick);
  }
  drawAuctions(ctx, i, t0, t1, X, Y, padT, ph, now, x0, n, x0 + pw);
  // preço (degraus)
  ctx.strokeStyle = P.text; ctx.lineWidth = 1.7; ctx.lineJoin = 'round'; ctx.shadowColor = rgba(P.text, 0.35); ctx.shadowBlur = 7;
  lineB(ctx, buckets(h.price, 0, t0, t1, now, X, x0, n), x0, Y, tick); ctx.shadowBlur = 0;
  // agora
  if (xn > x0 && xn < x0 + pw) { ctx.strokeStyle = rgba(P.muted, 0.6); ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(Math.round(xn) + 0.5, padT); ctx.lineTo(Math.round(xn) + 0.5, padT + ph); ctx.stroke(); ctx.setLineDash([]); }
  drawSparks(ctx, i, X, Y, padT, ph, x0, pw, now);
  drawTunnelTags(ctx, i, X, Y, x0, pw, padT, ph, now);
  // boleta: nível digitado
  if (UI.bol.pT != null && UI.bol.type === LMT) {
    const y = Y(UI.bol.pT * tick);
    if (y > padT && y < padT + ph) { ctx.strokeStyle = P.blue; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke(); ctx.setLineDash([]); }
  }
  ctx.restore();

  // estado fora do horário
  if (i.state === ST.PRE || (i.state === ST.CLOSED && !i.hist.price.length)) {
    ctx.fillStyle = P.muted; ctx.font = '500 13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(i.state === ST.PRE ? (i.isFut ? 'Aguardando a pré-abertura dos futuros' : 'Aguardando a pré-abertura (09:45)') : 'Sem negócios', x0 + pw / 2, padT + ph * 0.3);
  }
  // último preço na escala
  const lp = dispPriceT(i);
  if (lp != null) {
    const y = clamp(Y(lp * tick), padT + 8, padT + ph - 8), inA = inAuctionLike(i) && i.auction.theo != null;
    pill(ctx, x0 + pw + 2, y - 8.5, fp(i, lp), inA ? P.onamb : P.panel, inA ? P.amber : P.text, 'left');
  }
  drawMarkers(ctx, i, t0, t1, X, padT + ph + 2, x0, pw);
  drawEdgeTags(ctx, i, ymin, ymax, x0, pw, padT, ph);
  // mira
  const hv = ch.hover;
  if (hv && hv.x >= x0 && hv.x <= x0 + pw && hv.y >= padT && hv.y <= padT + ph && !ch.drag) {
    ctx.strokeStyle = rgba(P.muted, 0.85); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(Math.round(hv.x) + 0.5, padT); ctx.lineTo(Math.round(hv.x) + 0.5, padT + ph); ctx.moveTo(x0, Math.round(hv.y) + 0.5); ctx.lineTo(x0 + pw, Math.round(hv.y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    const tt = t0 + (hv.x - x0) / pw * span, pp = ymin + (1 - (hv.y - padT) / ph) * (ymax - ymin);
    pill(ctx, x0 + pw + 2, hv.y - 8.5, fnum(pp, Math.max(dec, i.tick < 1 ? Math.min(i.dec, 2) : 0)), P.panel, P.muted, 'left');
    showTip(i, tt, hv.x, hv.y, W, H);
  } else hideTip();
}
function drawAuctions(ctx, i, t0, t1, X, Y, padT, ph, now, x0, n, xr) {
  const P = UI.pal, tick = i.tick, sh = UI.chart.show, dpr = UI.cc.dpr;
  for (const a of i.auctions) {
    const endT = a.ended ? a.t1 : animEnd(a);
    if (endT < t0 || a.t0 > t1) continue;
    const key = aucKey(a), K = AUC_KIND[key], col = P[K.col], isCall = K.call;
    const xa = X(a.t0), xb = Math.max(X(endT), xa + 2), xn = X(now);
    // bloco na cor do tipo; call = hachurado e tracejado
    ctx.fillStyle = rgba(col, isCall ? 0.05 : 0.10); ctx.fillRect(xa, padT, xb - xa, ph);
    if (isCall) { ctx.fillStyle = hatch(ctx, col, 0.13, dpr); ctx.fillRect(xa, padT, xb - xa, ph); }
    // janela de alteração (fase crítica) do fim previsto: uma alteração aqui prorroga
    if (!a.ended && a.ladder < a.rule.ladder.length) {
      const w = a.rule.ladder[a.ladder], xw = Math.max(xa, X(endT - w));
      if (xb - xw > 3) {
        ctx.fillStyle = hatch(ctx, col, 0.3, dpr); ctx.fillRect(xw, padT + 16, xb - xw, ph - 16);
        ctx.strokeStyle = rgba(col, 0.75); ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(Math.round(xw) + 0.5, padT + 16); ctx.lineTo(Math.round(xw) + 0.5, padT + ph); ctx.stroke(); ctx.setLineDash([]);
        if (xb - xw > 46) { ctx.font = '600 10px ' + FONT; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('janela ' + w + ' s', (xw + xb) / 2, padT + ph - 4); }
      }
    }
    // linha do tempo do leilão no topo do bloco: duração prevista na cor do tipo; cada prorrogação na cor da causa
    const lbl = K.n + (isCall ? '' : ' · ' + fadd(Math.round(a.dur0)));
    const bar = (xs0, xe, c, ico, text) => {
      const xs = Math.max(xs0, x0); if (xe <= xs) return;
      ctx.fillStyle = c; ctx.fillRect(xs, padT, xe - xs, 15); ctx.fillStyle = P.panel; ctx.fillRect(xs0 - 0.5 > x0 ? xs0 - 0.5 : xs, padT, 1, 15);
      const w = xe - xs; let tx = xs + 4;
      if (w > 22) { drawIco(ctx, ico, xs + 11, padT + 7.5, 11, P.onamb, 1.5); tx = xs + 20; }
      ctx.font = '600 10.5px ' + FONT;
      if (text && w - (tx - xs) > ctx.measureText(text).width + 6) { ctx.fillStyle = P.onamb; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, tx, padT + 8); }
    };
    bar(xa, X(Math.min(endT, a.t0 + a.dur0)), rgba(col, 0.96), K.ico, lbl);
    for (const p of a.prorr) { const st = prorrSty(p.code); bar(X(p.prevEnd), X(Math.min(endT, p.newEnd)), rgba(P[st.col], 0.96), st.ico, '+' + fadd(p.add || 60)); }
    if (!a.ended && xn < xb) { ctx.fillStyle = rgba(P.panel, 0.5); ctx.fillRect(Math.max(xa, xn), padT, xb - Math.max(xa, xn), 15); }
    // bordas do bloco
    ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 1.2;
    ctx.setLineDash(isCall ? [4, 3] : []); ctx.beginPath(); ctx.moveTo(Math.round(xa) + 0.5, padT); ctx.lineTo(Math.round(xa) + 0.5, padT + ph); ctx.stroke();
    ctx.setLineDash(a.ended ? (isCall ? [4, 3] : []) : [3, 3]); ctx.beginPath(); ctx.moveTo(Math.round(xb) - 0.5, padT); ctx.lineTo(Math.round(xb) - 0.5, padT + ph); ctx.stroke(); ctx.setLineDash([]);
    // faixa de proteção
    if (sh.prot) {
      const y1 = Y(a.prot.hi * tick), y2 = Y(a.prot.lo * tick);
      ctx.fillStyle = rgba(P.cyan, isCall ? 0.06 : 0.14); ctx.fillRect(xa, y1, xb - xa, y2 - y1);
      ctx.strokeStyle = rgba(P.cyan, 0.85); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xa, Math.round(y1) + 0.5); ctx.lineTo(xb, Math.round(y1) + 0.5); ctx.moveTo(xa, Math.round(y2) + 0.5); ctx.lineTo(xb, Math.round(y2) + 0.5); ctx.stroke();
    }
    // preço teórico
    const tEnd = a.ended ? a.t1 : now;
    if (a.theoS.length) {
      ctx.strokeStyle = P.amber; ctx.lineWidth = 1.6; ctx.setLineDash([2, 3]);
      lineB(ctx, buckets(a.theoS, 0, Math.max(t0, a.t0), Math.min(t1, tEnd), tEnd, X, x0, n), x0, Y, tick); ctx.setLineDash([]);
    }
    if (!a.ended && a.theo != null) {
      const x = X(now), y = Y(a.theo * tick), r = UI.reduced ? 4 : 4 + 2 * Math.sin(performance.now() / 170);
      ctx.fillStyle = rgba(P.amber, 0.25); ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.fill();
      ctx.fillStyle = P.amber; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
    }
    // prorrogações: linha tracejada e etiqueta na cor da causa
    a.prorr.forEach((p, k) => {
      const x = X(p.prevEnd); if (x < X(t0) - 1 || x > X(t1) + 1) return;
      const st = prorrSty(p.code), c = P[st.col];
      ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, padT + 15); ctx.lineTo(Math.round(x) + 0.5, padT + ph); ctx.stroke(); ctx.setLineDash([]);
      const ptx = '+' + fadd(p.add || 60) + ': ' + PRORR_SHORT[p.code]; ctx.font = '600 11px ' + FONT;
      if (x + 3 + ctx.measureText(ptx).width + 26 > xr) kindPill(ctx, x - 3, padT + 22 + (k % 3) * 20, st.ico, ptx, c, rgba(P.panel, 0.93), c, 'right');   // sem espaço à direita: a etiqueta vai para a esquerda da linha
      else kindPill(ctx, x + 3, padT + 22 + (k % 3) * 20, st.ico, ptx, c, rgba(P.panel, 0.93), c);
    });
    // resultado: losango no preço do leilão, com quantidade e variação sobre o último negócio antes dele
    if (a.ended && a.price != null) {
      const y = Y(a.price * tick);
      ctx.fillStyle = col; ctx.strokeStyle = P.panel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xb, y - 6.5); ctx.lineTo(xb + 6.5, y); ctx.lineTo(xb, y + 6.5); ctx.lineTo(xb - 6.5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      const tx = `${fp(i, a.price)} × ${fqShort(a.qty)}` + (a.refT != null && a.refT !== a.price ? ' · ' + distLbl(i, a.price, a.refT) : ''); ctx.font = '600 11px ' + FONT; const tw = ctx.measureText(tx).width + 10;
      if (xb + 9 + tw > xr) pill(ctx, xb - 9, y - 8.5, tx, col, rgba(P.panel, 0.93), 'right'); else pill(ctx, xb + 9, y - 8.5, tx, col, rgba(P.panel, 0.93));
    }
  }
}
// rótulos diretos na ponta de cada túnel (no "agora"), para ler o limite sem depender da legenda
function drawTunnelTags(ctx, i, X, Y, x0, pw, padT, ph, now) {
  const P = UI.pal, t = i.tun, sh = UI.chart.show, tick = i.tick, xn = X(now);
  if (xn < x0 + 150 || xn > x0 + pw + 1) return;
  const live = i.state === ST.CONT, after = i.state === ST.AFTER, anyB = i.state !== ST.PRE && i.state !== ST.CLOSED, L = [];
  const add = (on, b, name, col, strong) => {
    if (!on || !b) return;
    for (const [v, up] of [[b.hi, 1], [b.lo, -1]]) {
      if (v == null) continue; const y = Y(v * tick); if (y < padT + 2 || y > padT + ph - 2) continue;
      L.push({ y, ty: y - up * 11, txt: `${name} ${fp(i, v)}`, col, strong });
    }
  };
  if (anyB) add(sh.rej, t.rej, after ? 'After ±2%' : 'Rejeição', P.wall);
  if (anyB && !after) add(sh.est, t.est, 'Estático', P.gray);
  if (live) { add(sh.med, t.med, 'Preço médio', P.violet); add(sh.ult, t.ult, 'Túnel de leilão', P.amber, true); }
  if (inAuctionLike(i)) add(sh.prot, i.auction.prot, 'Proteção', P.cyan, true);
  if (!L.length) return;
  for (const l of L) {
    ctx.fillStyle = P.panel; ctx.beginPath(); ctx.arc(xn, l.y, 4.5, 0, 7); ctx.fill();
    ctx.fillStyle = l.col; ctx.beginPath(); ctx.arc(xn, l.y, l.strong ? 3.4 : 2.7, 0, 7); ctx.fill();
  }
  L.sort((a, b) => a.ty - b.ty);
  const gap = 20, minY = padT + 10, maxY = padT + ph - 10;
  L[0].ty = Math.max(minY, L[0].ty);
  for (let k = 1; k < L.length; k++) if (L[k].ty - L[k - 1].ty < gap) L[k].ty = L[k - 1].ty + gap;
  if (L[L.length - 1].ty > maxY) { L[L.length - 1].ty = maxY; for (let k = L.length - 2; k >= 0; k--) if (L[k + 1].ty - L[k].ty < gap) L[k].ty = L[k + 1].ty - gap; }
  const xr = xn - 9;
  for (const l of L) {
    const y = l.ty - 8.5;
    const w = l.strong ? pill(ctx, xr, y, l.txt, P.onamb, rgba(l.col, 0.95), 'right')
                       : pill(ctx, xr, y, l.txt, l.col, rgba(P.panel, 0.95), 'right');
    if (!l.strong) {
      ctx.strokeStyle = rgba(l.col, 0.5); ctx.lineWidth = 1; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(xr - w + 0.5, y + 0.5, w - 1, 16, 5); else ctx.rect(xr - w + 0.5, y + 0.5, w - 1, 16);
      ctx.stroke();
    }
  }
}
function drawSparks(ctx, i, X, Y, padT, ph, x0, pw, now) {
  const P = UI.pal, rnow = performance.now(), tick = i.tick; const keep = [];
  for (const s of UI.sparks) {
    const age = rnow - s.born; if (age > 1100) continue; keep.push(s);
    const x = clamp(X(s.t), x0 + 8, x0 + pw - 8);
    const yP = s.p != null ? clamp(Y(s.p * tick), padT + 4, padT + ph - 4) : padT + ph / 2;
    const yB = s.bound != null ? clamp(Y(s.bound * tick), padT + 4, padT + ph - 4) : yP;
    const k = Math.min(1, age / 450), y = yP + (yB - yP) * easeOut(k), fade = age < 450 ? 1 : 1 - (age - 450) / 650;
    ctx.strokeStyle = rgba(P.rasp, Math.max(0, fade)); ctx.fillStyle = rgba(P.rasp, Math.max(0, fade)); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    if (age >= 450 && !UI.reduced) {
      const r = 4 + (age - 450) / 40;
      for (let a = 0; a < 6; a++) { const an = a * Math.PI / 3 + 0.3; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r * 0.5, y + Math.sin(an) * r * 0.5); ctx.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); ctx.stroke(); }
    }
  }
  UI.sparks = keep;
}
function drawMarkers(ctx, i, t0, t1, X, y, x0, pw) {
  const P = UI.pal; const inside = x => x >= x0 && x <= x0 + pw;
  ctx.lineWidth = 1.4;
  const R = i.rejMarks; let k = R.length - 1;
  ctx.strokeStyle = P.rasp;
  for (; k >= 0 && R[k].t >= t0; k--) { if (R[k].t > t1) continue; const x = X(R[k].t); if (!inside(x)) continue; ctx.beginPath(); ctx.moveTo(x - 3, y + 2); ctx.lineTo(x + 3, y + 8); ctx.moveTo(x + 3, y + 2); ctx.lineTo(x - 3, y + 8); ctx.stroke(); }
  for (const a of i.auctions) {
    const end = a.ended ? a.t1 : a.plannedEnd; if (end < t0 || a.t0 > t1) continue;
    let x = X(a.t0);
    if (inside(x)) { ctx.fillStyle = P[AUC_KIND[aucKey(a)].col]; ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 4.5, y + 9); ctx.lineTo(x - 4.5, y + 9); ctx.closePath(); ctx.fill(); }
    for (const p of a.prorr) { x = X(p.prevEnd); if (!inside(x)) continue; ctx.strokeStyle = P[prorrSty(p.code).col]; ctx.beginPath(); ctx.moveTo(x - 4, y + 5); ctx.lineTo(x + 4, y + 5); ctx.moveTo(x, y + 1); ctx.lineTo(x, y + 9); ctx.stroke(); }
    if (a.ended) { x = X(a.t1); if (inside(x)) { ctx.fillStyle = P.up; ctx.beginPath(); ctx.arc(x, y + 5, 3.6, 0, 7); ctx.fill(); } }
  }
}
function drawEdgeTags(ctx, i, ymin, ymax, x0, pw, padT, ph) {
  const P = UI.pal, t = i.tun, sh = UI.chart.show, tick = i.tick, top = [], bot = [];
  const add = (on, v, name, col) => { if (!on || v == null) return; const p = v * tick; if (p > ymax) top.push({ v, name, col }); else if (p < ymin) bot.push({ v, name, col }); };
  const live = i.state === ST.CONT, anyB = i.state !== ST.PRE && i.state !== ST.CLOSED;
  if (anyB) {
    add(sh.rej, t.rej && t.rej.hi, i.state === ST.AFTER ? 'After ±2%' : 'Rejeição', P.muted); add(sh.rej, t.rej && t.rej.lo, i.state === ST.AFTER ? 'After ±2%' : 'Rejeição', P.muted);
    add(sh.est && i.state !== ST.AFTER, t.est && t.est.hi, 'Estático', P.gray); add(sh.est && i.state !== ST.AFTER, t.est && t.est.lo, 'Estático', P.gray);
  }
  if (live) { add(sh.med, t.med && t.med.hi, 'Preço médio', P.violet); add(sh.med, t.med && t.med.lo, 'Preço médio', P.violet); add(sh.ult, t.ult && t.ult.hi, 'Leilão', P.amber); add(sh.ult, t.ult && t.ult.lo, 'Leilão', P.amber); }
  if (i.auction && sh.prot) { add(true, i.auction.prot.hi, 'Proteção', P.cyan); add(true, i.auction.prot.lo, 'Proteção', P.cyan); }
  let xr = x0 + pw - 4;
  for (const g of top) { const w = pill(ctx, xr, padT + 3, `▲ ${g.name} ${fp(i, g.v)}`, g.col, rgba(UI.pal.panel, 0.94), 'right'); xr -= w + 4; }
  xr = x0 + pw - 4;
  for (const g of bot) { const w = pill(ctx, xr, padT + ph - 20, `▼ ${g.name} ${fp(i, g.v)}`, g.col, rgba(UI.pal.panel, 0.94), 'right'); xr -= w + 4; }
}
function hideTip() { const el = $('ctip'); if (!el.hidden) el.hidden = true; }
function showTip(i, t, x, y, W, H) {
  const E = UI.E, P = UI.pal, tt = Math.min(t, E.t), h = i.hist, el = $('ctip');
  const key = i.ticker + Math.floor(tt) + '|' + Math.round(x) + '|' + Math.round(y);
  if (key !== UI.tipKey) {
    UI.tipKey = key;
    const price = h.price.at(tt), rows = [];
    const row = (col, name, S, sub, add) => {
      const j = S.idx(tt); if (j < 0) return; const lo = S.v[0][j], hi = S.v[1][j], c = S.v[2][j]; if (lo !== lo) return;
      rows.push(`<div class="r"><i style="background:${col}"></i><span>${name}</span><span>${fp(i, lo)} a ${fp(i, hi)}</span><em>${distLbl(i, lo, c)} / ${distLbl(i, hi, c)} sobre ${fp(i, c)} (${sub})</em></div>`);
    };
    row(P.amber, 'Leilão: último preço', h.ult, baseMethodName(i));
    row(P.violet, 'Leilão: preço médio', h.med, `média de ${vwSecOf(i)} s`);
    row(P.gray, 'Estático', h.est, 'fechamento anterior');
    row(P.wall, 'Rejeição', h.rej, i.isOpt ? 'referência, choque alto' : baseMethodName(i));
    const a = i.auctions.find(a => a.t0 <= tt && (a.ended ? a.t1 >= tt : true));
    if (a) {
      const th = a.theoS.at(tt);
      rows.push(`<div class="r"><i style="background:${P.cyan}"></i><span>Proteção</span><span>${fp(i, a.prot.lo)} a ${fp(i, a.prot.hi)}</span><em>sobre ${fp(i, a.prot.c)}, último negócio antes do ${a.kind === 'auction' ? 'leilão' : 'call'}</em></div>`);
      rows.push(`<div class="r"><i style="background:${P.amber}"></i><span>Preço teórico</span><span>${th === th ? fp(i, th) : '—'}</span></div>`);
    }
    el.innerHTML = `<div class="h"><span>${hms(tt)}</span><span>${price === price ? fpr(i, price) : 'sem negócio'}</span></div>${rows.join('') || '<div class="r"><i></i><span>Sem túnel ativo neste instante</span><span></span></div>'}`;
  }
  el.hidden = false;
  const bw = el.offsetWidth || 240, bh = el.offsetHeight || 120;
  let lx = x + 14, ly = y + 14; if (lx + bw > W - 4) lx = x - bw - 14; if (ly + bh > H - 4) ly = y - bh - 14;
  el.style.left = Math.max(4, lx) + 'px'; el.style.top = Math.max(4, ly) + 'px';
}
function drawMini() {
  const C = UI.mc; if (!C || C.w < 50) return;
  const E = UI.E, i = UI.focus; if (!i.isOpt) return;
  const u = E.by[i.underlying], P = UI.pal, ch = UI.chart, ctx = C.ctx, W = C.w, H = C.h, tick = u.tick;
  ctx.setTransform(C.dpr, 0, 0, C.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const x0 = ch.x0 || 4, pw = ch.pw, t0 = ch.t0, t1 = ch.t1, span = t1 - t0, n = Math.max(1, Math.floor(pw)), padT = 18, ph = H - padT - 6;
  const X = t => x0 + (t - t0) / span * pw, now = E.t;
  let mn = Infinity, mx = -Infinity;
  for (const S of [u.hist.price]) forSeg(S, t0, Math.min(t1, now), now, (a, b, j) => { const v = S.v[0][j]; if (v === v) { mn = Math.min(mn, v); mx = Math.max(mx, v); } });
  forSeg(u.hist.ult, t0, Math.min(t1, now), now, (a, b, j) => { const lo = u.hist.ult.v[0][j], hi = u.hist.ult.v[1][j]; if (lo === lo) { mn = Math.min(mn, lo); mx = Math.max(mx, hi); } });
  if (!isFinite(mn)) { mn = mx = u.refT(); }
  let lo = mn * tick, hi = mx * tick; const pad = Math.max((hi - lo) * 0.1, tick * 2); lo -= pad; hi += pad;
  const Y = p => padT + (1 - (p - lo) / (hi - lo)) * ph;
  for (const a of u.auctions) { const e = a.ended ? a.t1 : now; if (e < t0 || a.t0 > t1) continue; ctx.fillStyle = rgba(P.amber, 0.13); ctx.fillRect(X(a.t0), padT, X(e) - X(a.t0), ph); }
  const blo = buckets(u.hist.ult, 0, t0, t1, now, X, x0, n), bhi = buckets(u.hist.ult, 1, t0, t1, now, X, x0, n);
  ctx.fillStyle = rgba(P.amber, 0.12); fillBand(ctx, blo, bhi, x0, Y, tick);
  ctx.strokeStyle = rgba(P.amber, 0.8); ctx.lineWidth = 1; lineB(ctx, bhi, x0, Y, tick); lineB(ctx, blo, x0, Y, tick);
  ctx.strokeStyle = P.text; ctx.lineWidth = 1.3; lineB(ctx, buckets(u.hist.price, 0, t0, t1, now, X, x0, n), x0, Y, tick);
  ctx.fillStyle = P.muted; ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(fp(u, u.refT()), x0 + pw + 6, clamp(Y(u.refT() * tick), padT + 6, padT + ph - 6));
}

/* ============================ RÉGUA DE TÚNEIS ============================ */
function drawRegua() {
  const C = UI.rc; if (!C || C.w < 30 || C.h < 80) return;
  const E = UI.E, i = UI.focus, P = UI.pal, ctx = C.ctx, W = C.w, H = C.h, t = i.tun, tick = i.tick;
  ctx.setTransform(C.dpr, 0, 0, C.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const U = t.ult || t.med, UC = t.ult ? P.amber : P.violet;   // DI1: o portão é o túnel de preço médio
  if (!U || !t.rej) return;
  const rnow = performance.now(), inA = inAuctionLike(i), after = i.state === ST.AFTER, small = W < 90;
  // base animada (recentraliza após o leilão)
  const baseT = after ? i.afterBand.c : U.c;
  if (UI.reg.base == null || UI.reduced || UI.reg.tk !== i.ticker) { UI.reg.base = baseT; UI.reg.tk = i.ticker; }
  else UI.reg.base += (baseT - UI.reg.base) * 0.08;
  const base = UI.reg.base * tick, pct = v => v * tick / base - 1;
  const gU = after ? 1e-4 : Math.max(1e-5, pct(U.hi)), gD = after ? 1e-4 : Math.max(1e-5, -pct(U.lo));
  const wU = Math.max(gU * 1.25, pct(t.rej.hi)), wD = Math.max(gD * 1.25, -pct(t.rej.lo));
  const RU = wU * 1.4, RD = wD * 1.4, top = 22, bot = H - 14, mid = (top + bot) / 2, hU = mid - top, hD = bot - mid;
  const fz = after ? [0.02, 0.8] : [0.46, 0.84];
  const Yp = x => {
    const up = x >= 0, v = Math.abs(x), g = up ? gU : gD, w = up ? wU : wD, R = up ? RU : RD;
    const f = v <= g ? v / g * fz[0] : (v <= w ? fz[0] + (v - g) / (w - g) * (fz[1] - fz[0]) : fz[1] + Math.min(1, (v - w) / (R - w)) * (1 - fz[1]));
    return up ? mid - f * hU : mid + f * hD;
  };
  const Yv = v => Yp(pct(v));
  const yGu = Yv(U.hi), yGd = Yv(U.lo), yWu = Yv(t.rej.hi), yWd = Yv(t.rej.lo);
  // zonas
  ctx.fillStyle = hatch(ctx, P.wall, 0.4, C.dpr); ctx.fillRect(0, 0, W, yWu); ctx.fillRect(0, yWd, W, H - yWd);
  if (!after) { ctx.fillStyle = rgba(UC, 0.09); ctx.fillRect(0, yWu, W, yGu - yWu); ctx.fillRect(0, yGd, W, yWd - yGd); }
  // paredes de rejeição
  ctx.fillStyle = P.wall; ctx.fillRect(0, yWu - 1.5, W, 3); ctx.fillRect(0, yWd - 1.5, W, 3);
  // portão laranja (túnel de leilão): abre/fecha
  const gateTarget = inA ? 1 : 0; UI.gate.v += (gateTarget - UI.gate.v) * (UI.reduced ? 1 : 0.12);
  if (!after) {
    ctx.strokeStyle = UC; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, Math.round(yGu) + 0.5); ctx.lineTo(W, Math.round(yGu) + 0.5); ctx.moveTo(0, Math.round(yGd) + 0.5); ctx.lineTo(W, Math.round(yGd) + 0.5); ctx.stroke();
    const gv = UI.gate.v, flash = UI.gate.flash && rnow - UI.gate.flash < 900 ? 1 - (rnow - UI.gate.flash) / 900 : 0;
    if (gv > 0.02) {
      ctx.fillStyle = UC; const gw = W * gv / 2;
      ctx.fillRect(0, yGu - 3, gw, 6); ctx.fillRect(W - gw, yGu - 3, gw, 6);
      ctx.fillRect(0, yGd - 3, gw, 6); ctx.fillRect(W - gw, yGd - 3, gw, 6);
      ctx.fillStyle = rgba(UC, 0.07 * gv); ctx.fillRect(0, yGu, W, yGd - yGu);
    }
    if (flash > 0) { ctx.fillStyle = rgba(P.amber, 0.35 * flash); ctx.fillRect(0, 0, W, H); }
  }
  // preço médio e estático (marcas curtas na borda)
  const tickMark = (v, col, dash) => { if (v == null) return; const y = Yv(v); if (y < 2 || y > H - 2) return; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(small ? 12 : 18, y); ctx.stroke(); ctx.setLineDash([]); };
  if (i.state === ST.CONT) { if (t.med && UI.chart.show.med) { tickMark(t.med.hi, P.violet, [3, 2]); tickMark(t.med.lo, P.violet, [3, 2]); } }
  if (t.est && UI.chart.show.est && !after) { tickMark(t.est.hi, P.gray, [1, 2]); tickMark(t.est.lo, P.gray, [1, 2]); }
  // rótulos
  ctx.font = (small ? '10px ' : '11px ') + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  const lab = (v, y, col, above) => { ctx.fillStyle = col; ctx.fillText(distLbl(i, v, UI.reg.base), W - 3, y + (above ? -7 : 7)); };
  if (!after) { lab(U.hi, yGu, UC, true); lab(U.lo, yGd, UC, false); }
  lab(t.rej.hi, yWu, P.muted, true); lab(t.rej.lo, yWd, P.muted, false);
  // proteção e teórico no leilão
  if (inA) {
    const a = i.auction, y1 = Yv(a.prot.hi), y2 = Yv(a.prot.lo);
    ctx.fillStyle = rgba(P.cyan, 0.2); ctx.fillRect(small ? 14 : 20, y1, W - (small ? 14 : 20), y2 - y1);
    ctx.strokeStyle = P.cyan; ctx.lineWidth = 1; ctx.strokeRect((small ? 14 : 20) + 0.5, Math.round(y1) + 0.5, W - (small ? 15 : 21), Math.round(y2 - y1));
    if (a.theo != null) {
      const y = Yv(a.theo); ctx.strokeStyle = P.amber; ctx.lineWidth = 2; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
      if (!small) { ctx.fillStyle = P.amber; ctx.textAlign = 'left'; ctx.fillText('teórico', 3, y - 7); }
    }
  }
  // último, melhor compra e melhor venda
  const L = i.refT(), yL = Yv(L);
  ctx.strokeStyle = P.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(small ? 12 : 16, yL); ctx.lineTo(W, yL); ctx.stroke();
  ctx.fillStyle = P.text; ctx.textAlign = 'left'; if (!inA) ctx.fillText('último', small ? 13 : 20, yL - 7);
  const bb = i.bb(), ba = i.ba();
  const tri = (v, col, dir) => { if (v == null) return; const y = Yv(v); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(W - 1, y); ctx.lineTo(W - 9, y - 4.5 * dir); ctx.lineTo(W - 9, y + 4.5 * dir); ctx.closePath(); ctx.fill(); };
  if (!inA) { tri(bb, P.up, 1); tri(ba, P.down, 1); }
  // nível digitado na boleta
  if (UI.bol.pT != null && UI.bol.type === LMT) {
    const y = clamp(Yv(UI.bol.pT), 3, H - 3); ctx.strokeStyle = P.blue; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = P.blue; ctx.textAlign = 'left'; ctx.fillText(small ? 'você' : 'sua oferta', 3, y + 8);
  }
  // título do estado
  ctx.textAlign = 'center'; ctx.font = '600 ' + (small ? '10px ' : '11px ') + FONT;
  const stTxt = inA ? (i.state === ST.CALL ? 'Em call' : 'Em leilão') : (after ? 'After ±2%' : (i.state === ST.CONT ? 'Contínuo' : (i.state === ST.HALT ? 'Parado' : (i.state === ST.PRE ? 'Aguardando' : 'Encerrado'))));
  ctx.fillStyle = inA ? P.amber : P.muted; ctx.fillText(stTxt, W / 2, 9);
  // partículas: ofertas chegando pela direita
  drawParticles(ctx, i, W, H, Yv, yGu, yGd, yWu, yWd, rnow, small);
}
function drawParticles(ctx, i, W, H, Yv, yGu, yGd, yWu, yWd, rnow, small) {
  const P = UI.pal, keep = [], sx = small ? 16 : 24, fly = UI.reduced ? 1 : 620, tail = 700;
  const y0 = Yv(i.refT());
  ctx.font = '600 ' + (small ? '9px ' : '10px ') + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const p of UI.parts) {
    const age = rnow - p.born; if (age > fly + tail) continue; keep.push(p);
    const col = p.side > 0 ? P.up : P.down;
    let ty = clamp(Yv(p.p != null ? p.p : i.refT()), 3, H - 3);
    let wall = null, wcol = null, label = null;
    if (p.out === 'rej') { wall = p.side > 0 ? yWu : yWd; if (p.bound == null) wall = null; wcol = P.rasp; label = 'Rejeitada'; if (wall == null) wall = ty; }
    if (p.out === 'trig') { wall = p.side > 0 ? yGu : yGd; wcol = P.amber; label = 'Leilão'; }
    if (wall != null) ty = p.side > 0 ? Math.max(ty, wall) : Math.min(ty, wall);
    const k = Math.min(1, age / fly), e = easeOut(k);
    let x = W + 4 - (W + 4 - sx) * e, y = y0 + (ty - y0) * e;
    if (age <= fly) {
      ctx.fillStyle = p.own ? P.blue : col; ctx.beginPath(); ctx.arc(x, y, p.own ? 4 : 3, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(p.own ? P.blue : col, 0.35); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 10, y + (y0 - ty) * 0.06); ctx.lineTo(x, y); ctx.stroke();
    } else {
      const f = 1 - (age - fly) / tail;
      if (label) {
        const bx = sx + (age - fly) / tail * (W * 0.45), by = ty + (p.side > 0 ? 1 : -1) * (age - fly) / tail * 10;
        ctx.fillStyle = rgba(wcol, f); ctx.beginPath(); ctx.arc(bx, by, 3, 0, 7); ctx.fill();
        if (!small || p.out === 'rej') { ctx.fillStyle = rgba(wcol, f); ctx.fillText(label, 4, ty + (p.side > 0 ? 9 : -9)); }
      } else if (p.out === 'auc') {
        ctx.fillStyle = rgba(P.amber, f); ctx.beginPath(); ctx.arc(sx, ty, 3, 0, 7); ctx.fill();
      } else {
        ctx.strokeStyle = rgba(p.own ? P.blue : col, f); ctx.lineWidth = p.out === 'trade' ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(sx - 6, ty); ctx.lineTo(sx + (p.out === 'trade' ? 12 : 6), ty); ctx.stroke();
      }
    }
  }
  UI.parts = keep;
}

/* ============================ BARRA DO DIA E LINHA DO TEMPO ============================ */
function drawDaybar() {
  const C = UI.dc; if (!C || C.w < 40) return; C.fit();
  const E = UI.E, T = E.T, P = UI.pal, ctx = C.ctx, W = C.w, H = C.h;
  ctx.setTransform(C.dpr, 0, 0, C.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const a = T.fPre, b = DAY('18:30'), X = t => 1 + (t - a) / (b - a) * (W - 2), by = H - 11, bh = 8;
  const segs = [[T.fPre, T.fOpen, 'call'], [T.fOpen, T.preOpen, 'deriv'], [T.preOpen, T.open, 'call'], [T.open, T.closeCall, 'cont'], [T.closeCall, T.close, 'call'],
    [T.close, T.afterStart, 'closed'], [T.afterStart, T.afterEnd, CONFIG.schedule.afterMarket.enabled ? 'after' : 'closed'], [T.afterEnd, T.fClose, 'deriv'], [T.fClose, b, 'closed']];
  const col = { call: P.blue, deriv: P.faint, cont: P.up, closed: P.line2, after: P.gray };
  for (const s of segs) { ctx.fillStyle = rgba(col[s[2]], s[2] === 'closed' ? 0.8 : 0.55); ctx.fillRect(X(s[0]), by, Math.max(1, X(s[1]) - X(s[0]) - 1), bh); }
  for (const c of (E.cbLog || [])) { const e1 = c.t1 != null ? c.t1 : E.t; ctx.fillStyle = hatch(ctx, P.gray, 0.9, C.dpr); ctx.fillRect(X(c.t0), by - 2, Math.max(2, X(e1) - X(c.t0)), bh + 4); }
  ctx.font = '10px ' + FONT; ctx.fillStyle = P.faint; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
  const marks = W > 520 ? [T.fOpen, T.preOpen, T.closeCall, T.afterStart, T.fClose] : [T.preOpen, T.closeCall];
  let lastX = -99;
  for (const m of marks) { const x = clamp(X(m), 15, W - 15); if (x - lastX < 34) continue; ctx.fillText(hm(m), x, by - 2); lastX = x; }
  const x = X(Math.min(E.t, b));
  ctx.fillStyle = P.text; ctx.fillRect(Math.round(x) - 1, by - 5, 2, bh + 8);
  ctx.beginPath(); ctx.moveTo(x - 4, by - 7); ctx.lineTo(x + 4, by - 7); ctx.lineTo(x, by - 2); ctx.closePath(); ctx.fill();
}
function drawTimeline(cv, big) {
  if (!cv) return; const E = UI.E, P = UI.pal, insts = E.insts, n = insts.length;
  const rowH = big ? 21 : 19, lab = big ? 78 : 70, H = n * rowH + 26;
  cv.parentElement.style.height = H + 'px';
  const { ctx, w: W, dpr } = fitSmall(cv);
  const t0 = E.T.fPre, t1 = DAY('18:30'), X = t => lab + (t - t0) / (t1 - t0) * (W - lab - 8);
  ctx.font = '11px ' + FONT; ctx.textBaseline = 'middle';
  for (let h = 9; h <= 18; h++) { const x = X(h * 3600); ctx.strokeStyle = rgba(P.line2, 0.5); ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, n * rowH); ctx.stroke(); ctx.fillStyle = P.faint; ctx.textAlign = 'center'; ctx.fillText(h + 'h', x, n * rowH + 12); }
  insts.forEach((i, r) => {
    const y = r * rowH, yy = y + 3, hh = rowH - 6;
    if (i === UI.focus) { ctx.fillStyle = rgba(P.accent, 0.09); ctx.fillRect(0, y, W, rowH); }
    ctx.fillStyle = i === UI.focus ? P.accent : P.text; ctx.textAlign = 'left'; ctx.font = (i === UI.focus ? '600 ' : '') + '11px ' + FONT;
    ctx.fillText(i.ticker, 4, y + rowH / 2);
    // faixas de estado: negociação contínua, parado pelo circuit breaker e after-market (os leilões vêm por cima)
    const L = i.stateLog;
    for (let k = 0; k < L.length; k++) {
      const s = L[k].s, a = L[k].t, b = k + 1 < L.length ? L[k + 1].t : E.t;
      if (b <= a) continue; const xa = X(a), xb = Math.max(xa + 1.5, X(b));
      if (s === 'halt') { ctx.fillStyle = hatch(ctx, P.gray, 0.9, dpr); ctx.fillRect(xa, yy, xb - xa, hh); }
      else if (s === 'cont') { ctx.fillStyle = rgba(P.up, 0.32); ctx.fillRect(xa, yy, xb - xa, hh); }
      else if (s === 'after') { ctx.fillStyle = rgba(P.violet, 0.45); ctx.fillRect(xa, yy, xb - xa, hh); }
    }
    // leilões e calls: cor do tipo; a parte prorrogada fica hachurada, com um corte em cada prorrogação
    for (const a of i.auctions) {
      const K = AUC_KIND[aucKey(a)], col = P[K.col], e = a.ended ? a.t1 : E.t;
      const xa = X(a.t0), xb = Math.max(X(e), xa + 2.5), xm = Math.min(xb, Math.max(xa + 1, X(a.t0 + a.dur0)));
      ctx.fillStyle = col; ctx.fillRect(xa, yy, xm - xa, hh);
      if (xb > xm) {
        ctx.fillStyle = rgba(col, 0.6); ctx.fillRect(xm, yy, xb - xm, hh);
        ctx.fillStyle = hatch(ctx, '#000000', 0.32, dpr); ctx.fillRect(xm, yy, xb - xm, hh);
        for (const p of a.prorr) { const x = X(p.prevEnd); if (x > xa && x < xb) { ctx.fillStyle = P.panel; ctx.fillRect(Math.round(x), yy, 1.5, hh); } }
      }
      if (K.call) { ctx.strokeStyle = rgba(P.panel, 0.9); ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeRect(xa + 0.5, yy + 0.5, Math.max(1, xb - xa - 1), hh - 1); ctx.setLineDash([]); }
      if (xb - xa >= 16) drawIco(ctx, K.ico, xa + 8.5, y + rowH / 2, 11, P.onamb, 1.5);
      if (a.ended && a.price != null) { ctx.fillStyle = P.text; ctx.beginPath(); ctx.arc(xb, y + rowH / 2, 2.2, 0, 7); ctx.fill(); }
    }
  });
  const xn = X(E.t); ctx.fillStyle = P.text; ctx.fillRect(Math.round(xn), 0, 1.5, n * rowH);
  cv._tl = { X, t0, t1, lab, rowH, n, W };
}
/* legenda da linha do tempo: um chip por tipo, mais prorrogação e estados */
function buildTlLegend() {
  const el = $('tlLeg'); if (!el) return;
  el.innerHTML = Object.keys(AUC_KIND).map(k => `<span class="tl-k ak-${k}${AUC_KIND[k].call ? ' call' : ''}" title="${AUC_KIND[k].full}: ${AUC_KIND[k].how}"><i>${icoSVG(AUC_KIND[k].ico)}</i>${AUC_KIND[k].n}</span>`).join('') +
    '<span class="tl-k tl-prorr" title="Cada corte é uma prorrogação"><i class="sw-h"></i>Prorrogação</span><span class="tl-k tl-cont"><i class="sw-c"></i>Negociando</span><span class="tl-k tl-halt"><i class="sw-b"></i>Parado</span>';
}
/* dica ao passar o mouse sobre um leilão da linha do tempo */
function tlHover(e) {
  const cv = $('tl'), m = cv._tl, tip = $('tlTip'); if (!m || !tip) return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, E = UI.E, i = E.insts[Math.floor(y / m.rowH)];
  const t = m.t0 + (x - m.lab) / (m.W - m.lab - 8) * (m.t1 - m.t0), P = UI.pal;
  let hit = null;
  if (i && x > m.lab) for (const a of i.auctions) { const e1 = a.ended ? a.t1 : E.t; if (t >= a.t0 - 20 && t <= e1 + 20 && Math.abs(x - m.X((a.t0 + e1) / 2)) <= Math.max(8, (m.X(e1) - m.X(a.t0)) / 2 + 4)) hit = a; }
  if (!hit) { tip.hidden = true; return; }
  const a = hit, K = AUC_KIND[aucKey(a)], col = P[K.col];
  const row = (c, n, v, em) => `<div class="r"><i style="background:${c}"></i><span>${n}</span><span>${v}</span>${em ? `<em>${em}</em>` : ''}</div>`;
  let h = `<div class="h"><span>${i.ticker}</span><span>${hms(a.t0)} a ${a.ended ? hms(a.t1) : 'agora'}</span></div>` + row(col, K.full, fadd(Math.round(a.dur0)), a.kind === 'auction' ? E.trigMsg(i, a.trig).replace(/^\S+ entrou em leilão( por quantidade)?: /, '') : K.how);
  for (const p of a.prorr.slice(0, 5)) h += row(P[prorrSty(p.code).col], '+' + fadd(p.add || 60), hms(p.prevEnd), PRORR_LABEL[p.code] + (p.detail ? ' (' + p.detail + ')' : ''));
  if (a.prorr.length > 5) h += `<div class="r"><i></i><span>e mais ${a.prorr.length - 5}</span><span></span></div>`;
  h += a.ended ? (a.price != null ? row(P.text, 'Fechou a', fpr(i, a.price), `${fq(a.qty)} ${unitQ(i)}${a.refT != null ? ' · ' + distLbl(i, a.price, a.refT) + ' sobre ' + fp(i, a.refT) : ''}${a.how === 'supervisao' ? ' · supervisão' : ''}`) : row(P.muted, 'Sem negócio', '', '')) : row(P.amber, 'Em andamento', a.theo != null ? 'teórico ' + fpr(i, a.theo) : 'sem teórico', 'fim previsto ' + hms(a.plannedEnd));
  tip.innerHTML = h; tip.hidden = false;
  const bw = tip.offsetWidth || 260, bh = tip.offsetHeight || 100, wr = cv.parentElement.getBoundingClientRect();
  let lx = x + 14, ly = y + 14; if (lx + bw > wr.width - 4) lx = x - bw - 14; if (ly + bh > wr.height + 140) ly = y - bh - 8;
  tip.style.left = Math.max(4, lx) + 'px'; tip.style.top = Math.max(2, ly) + 'px';
}
