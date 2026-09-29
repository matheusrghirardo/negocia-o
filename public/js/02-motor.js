'use strict';
/* ============================================================================
   MOTOR DA SIMULAÇÃO
   Preços internos em ticks inteiros (evita erro de ponto flutuante no livro).
   ============================================================================ */

/* ----------------------------- utilidades ----------------------------- */
const DAY = s => { const a = String(s).split(':').map(Number); return a[0] * 3600 + a[1] * 60 + (a[2] || 0); };
const clamp = (x, a, b) => (x < a ? a : (x > b ? b : x));
function hms(t) { t = Math.max(0, Math.floor(t + 1e-6)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
const hm = t => hms(t).slice(0, 5);
function mmss(sec) { sec = Math.max(0, Math.ceil(sec - 1e-6)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
function decOf(tick) { if (tick >= 1) return 0; const s = String(tick); const k = s.indexOf('.'); return k < 0 ? 0 : s.length - k - 1; }

const _nf = {};
function fnum(x, d) { let f = _nf[d]; if (!f) f = _nf[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); return f.format(x); }
const fq = q => fnum(q, 0);
function fpct(x, d = 1) { if (!isFinite(x)) return '—'; const r = Math.round(x * 100 * Math.pow(10, d)); const s = r > 0 ? '+' : (r < 0 ? '−' : ''); return s + fnum(Math.abs(x * 100), d) + '%'; }
const fpctAbs = (x, d = 1) => fnum(Math.abs(x * 100), d) + '%';
function fp(i, pT) { return pT == null || pT !== pT ? '—' : fnum(pT * i.tick, i.dec); }
function fpr(i, pT) { if (pT == null || pT !== pT) return '—'; const s = fp(i, pT); if (i.cur === 'R$') return 'R$ ' + s; if (i.cur === '%') return s + '%'; return s + ' pts'; }
function fqShort(q) { if (q >= 1e6) return fnum(q / 1e6, q >= 1e7 ? 0 : 1) + ' mi'; if (q >= 1e4) return fnum(q / 1e3, q >= 1e5 ? 0 : 1) + ' mil'; return fq(q); }
function unitQ(i) { return i.type === 'fut' ? 'contratos' : (i.type === 'etf' ? 'cotas' : (i.type === 'opt' ? 'opções' : 'ações')); }
/* distância entre preço e base, em % (ou p.p. no DI) */
function fdist(i, p, base) { return i.cur === '%' ? fnum(Math.abs(p - base) * i.tick, 3) + ' p.p.' : fpctAbs(p / base - 1); }

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
class RNG {
  constructor(seed) { this.r = mulberry32(seed >>> 0); this.g = null; }
  u() { return this.r(); }
  n() { if (this.g !== null) { const g = this.g; this.g = null; return g; } let u = 0; while (u === 0) u = this.r(); const v = this.r(); const m = Math.sqrt(-2 * Math.log(u)); this.g = m * Math.sin(6.283185307179586 * v); return m * Math.cos(6.283185307179586 * v); }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  range(a, b) { return a + (b - a) * this.r(); }
  pick(a) { return a[Math.floor(this.r() * a.length)]; }
  chance(p) { return this.r() < p; }
  poisson(l) { if (l <= 0) return 0; if (l < 0.03) return this.r() < l ? 1 : 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= this.r(); } while (p > L && k < 60); return k - 1; }
  logn(mean, sd) { const s2 = Math.log(1 + sd * sd); return mean * Math.exp(-s2 / 2 + Math.sqrt(s2) * this.n()); }
}
function ncdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989422804014327 * Math.exp(-x * x / 2); const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x > 0 ? 1 - p : p; }
function bsPrice(cp, S, K, T, r, sig) {
  if (!(S > 0)) return 0;
  if (T <= 0 || sig <= 0) return Math.max(0, cp === 'C' ? S - K : K - S);
  const sq = sig * Math.sqrt(T), d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sq, d2 = d1 - sq;
  return cp === 'C' ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2) : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
}

/* Série em degraus: guarda só as mudanças (t, v0[, v1, v2]). NaN = interrupção. */
const _eq = (x, y) => x === y || (x !== x && y !== y);
class Series {
  constructor(n) { this.n = n; this.t = []; this.v = []; for (let k = 0; k < n; k++) this.v.push([]); }
  get length() { return this.t.length; }
  push(t, a, b, c) {
    const L = this.t.length, v = this.v, n = this.n;
    if (L) {
      if (_eq(v[0][L - 1], a) && (n < 2 || _eq(v[1][L - 1], b)) && (n < 3 || _eq(v[2][L - 1], c))) return;
      if (this.t[L - 1] === t) { v[0][L - 1] = a; if (n > 1) v[1][L - 1] = b; if (n > 2) v[2][L - 1] = c; return; }
    }
    this.t.push(t); v[0].push(a); if (n > 1) v[1].push(b); if (n > 2) v[2].push(c);
  }
  idx(t) { const T = this.t; let lo = 0, hi = T.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  at(t, k = 0) { const i = this.idx(t); return i < 0 ? NaN : this.v[k][i]; }
}

/* ----------------------------- constantes ----------------------------- */
const LMT = 0, MKT = 1, MOA = 2;
const ST = { PRE: 'PRE', CALL: 'CALL', CONT: 'CONT', AUC: 'AUC', CLOSED: 'CLOSED', AFTER: 'AFTER', HALT: 'HALT' };
const TRIG_LABEL = { ult: 'Túnel de leilão por último preço', med: 'Túnel de leilão por preço médio', est: 'Túnel estático',
  qtd: 'Leilão por quantidade', call_open: 'Call de abertura', call_close: 'Call de fechamento', reopen: 'Call de reabertura após circuit breaker' };
const PRORR_LABEL = { prot_preco: 'proteção de preço', prot_qtd: 'proteção por quantidade', alt60: 'alteração no último minuto',
  alt30: 'alteração nos últimos 30 s', alt15: 'alteração nos últimos 15 s', sem_teorico: 'sem preço teórico' };
const PRORR_SHORT = { prot_preco: 'proteção', prot_qtd: 'proteção por quantidade', alt60: 'alteração no último minuto',
  alt30: 'alteração nos últimos 30 s', alt15: 'alteração nos últimos 15 s', sem_teorico: 'sem teórico' };
const FACT_LABEL = { theo: 'mudou o preço teórico', qty: 'mudou a quantidade teórica', alloc: 'oferta nova mudou o atendimento de outra', imb: 'mudou o saldo não atendido' };

/* ----------------------------- instrumento ----------------------------- */
class Inst {
  constructor(d) {
    Object.assign(this, d);
    this.g = CONFIG.groups[d.tunnelGroup];
    this.isFut = d.type === 'fut'; this.isOpt = d.type === 'opt'; this.isDeriv = this.isFut || this.isOpt;
    this.cur = d.tunnelGroup === 'DI1' ? '%' : (this.isFut ? 'pts' : 'R$');
    this.dec = decOf(d.tick);
    this.halfSpread = (d.spreadTicks || 1) / 2;
    this.bids = []; this.asks = []; this.moaB = []; this.moaS = []; this.orders = new Map();
    this.last = null; this.lastTime = -1e9; this.open = null; this.high = null; this.low = null; this.close = null;
    this.volume = 0; this.nTrades = 0;
    this.vwT = []; this.vwP = []; this.vwQ = []; this.vwH = 0; this.vwPQ = 0; this.vwSQ = 0;
    this.staticStep = 1; this.state = ST.PRE; this.auction = null;
    this.tun = { rej: null, ult: null, med: null, est: null }; this.baseT = null; this.baseSrc = '';
    this.fut = { center: null, t: -1e9 }; this.ref = { p: null, t: -1e9 };
    this.fv = 0; this.e = 0; this.shift = 0; this.gap = 0; this.idio = 0;
    this.hist = { price: new Series(1), ult: new Series(3), med: new Series(3), est: new Series(3), rej: new Series(3) };
    this.auctions = []; this.rejMarks = []; this.stateLog = []; this.tt = []; this.mms = []; this.escada = null;
    this.st = { auctions: 0, rej: 0, prorr: 0 };
    this.win = []; this.winSec = -1; this.isUnderlying = false;
    this.medT = -1e9; this.afterBand = null; this.closeCallStarted = false; this.afterDone = false;
    this.outCount = 0; this.outSec = -1; this.outMsgT = -1e9;
  }
  toT(p) { return Math.round(p / this.tick + 1e-9); }
  bb() { return this.bids.length ? this.bids[0].p : null; }
  ba() { return this.asks.length ? this.asks[0].p : null; }
  refT() { return this.last != null ? this.last : (this.isDeriv ? this.settleT : this.prevCloseT); }
}

/* =============================== ENGINE =============================== */
class Engine {
  constructor(seed, opts) {
    opts = opts || {};
    this.seed = seed >>> 0; this.opts = opts;
    this.rs = new RNG(this.seed ^ 0x5bd1e995);  // roteiro do dia (mesma semente = mesmos eventos)
    this.rf = new RNG(this.seed);               // fluxo de ordens
    this.t = DAY(CONFIG.engineStart);
    this.oid = 0; this.aid = 0; this.m = 0; this.crash = null; this.silent = false;
    this.setIntensity(opts.intensity || 'normal');
    this.feed = []; this.feedSeq = 0; this.events = []; this.focusTk = null; this.forceLate = null;
    this.quiet = new Set();   // ativos sem ofertas tardias aleatórias no leilão (modo aula: prorrogações controladas)
    this.hook = null;         // função chamada ao fim de cada passo (roteiro das aulas)
    this.stats = { rejPreco: 0, rejQtd: 0, rejOutros: 0, auc: { ult: 0, med: 0, est: 0, qtd: 0 },
      calls: { call_open: 0, call_close: 0, reopen: 0 },
      prorr: { prot_preco: 0, prot_qtd: 0, alt60: 0, alt30: 0, alt15: 0, sem_teorico: 0 }, sup: 0, durations: [], cb: 0 };
    this.cb = { active: false, level: 0, hit: 0, t0: 0, until: 0, drop: 0, byB3: false, haltMin: 0 };
    this.ended = false; this.msg = {}; this.cbLog = [];
    const S = CONFIG.schedule;
    this.T = { fPre: DAY(S.futures.preOpen), fOpen: DAY(S.futures.open), fClose: DAY(S.futures.close), preOpen: DAY(S.stocks.preOpen), open: DAY(S.stocks.open),
      closeCall: DAY(S.stocks.closeCall), close: DAY(S.stocks.close), afterStart: DAY(S.stocks.afterStart), afterEnd: DAY(S.stocks.afterEnd),
      oPre: DAY(S.options.preOpen), oOpen: DAY(S.options.open), oCloseCall: DAY(S.options.closeCall), oClose: DAY(S.options.close), dayEnd: DAY(S.dayEnd) };
    this.ibov0 = CONFIG.ibov.start; this.ibov = this.ibov0; this.ibovFair = this.ibov0;
    this.insts = CONFIG.instruments.map(d => new Inst(d));
    this.by = {}; for (const i of this.insts) this.by[i.ticker] = i;
    for (const i of this.insts) if (i.isOpt) this.by[i.underlying].isUnderlying = true;
    this.ibovList = this.insts.filter(i => i.ibovWeight);
    this.optT = CONFIG.option.daysToExpiry / 252;
    this.initPrices(); this.initMMs(); this.buildScript();
    for (const i of this.insts) { this.logState(i, 'pre'); this.refreshTunnels(i); }
  }
  setIntensity(k) { this.intKey = k; this.I = CONFIG.intensity[k]; }

  /* ----------------------------- inicialização ----------------------------- */
  initPrices() {
    const rs = this.rs;
    this.m = rs.n() * 0.004; // movimento do mercado durante a noite
    const cands = this.insts.filter(i => i.type === 'stock' && i.ibovWeight);
    const gapTk = this.opts.gapTicker || rs.pick(cands).ticker;
    const gapPct = this.opts.gapPct != null ? this.opts.gapPct : (rs.chance(0.5) ? 1 : -1) * rs.range(CONFIG.script.gapMin, CONFIG.script.gapMax);
    this.gapInfo = { tk: gapTk, pct: gapPct };
    for (const i of this.insts) {
      if (i.isOpt) continue;
      i.prevCloseT = i.toT(i.prevClose); i.settleT = i.toT(i.settle != null ? i.settle : i.prevClose);
      if (i.type === 'stock') {
        const dv = i.vol / Math.sqrt(252), mv = Math.abs(i.beta) * CONFIG.market.dailyVol;
        i.idio = Math.sqrt(Math.max(1e-6, dv * dv - mv * mv));
        i.gap = rs.n() * 0.003; if (i.ticker === gapTk) i.gap = Math.log(1 + gapPct);
      } else if (i.type === 'etf') i.idio = 0.0015;
      else if (i.tunnelGroup === 'WIN') i.idio = 0.002;
      else if (i.tunnelGroup === 'WDO') i.idio = i.vol / Math.sqrt(252) * 0.9;
      else i.idio = i.volPP;
    }
    for (const i of this.insts) {
      if (!i.isOpt) continue;
      const u = this.by[i.underlying];
      const p = bsPrice(i.cp, u.prevClose, i.strike, this.optT, CONFIG.option.r, i.iv);
      i.prevCloseT = Math.max(1, Math.round(p / i.tick)); i.settleT = i.prevCloseT; i.prevClose = i.prevCloseT * i.tick;
    }
    this.updateFV(0);
  }
  halfWidthTicks(i) {
    if (i.isOpt) return 8;
    const g = i.g, p = i.prevCloseT * i.tick;
    let d = g.ult.pct != null ? p * g.ult.pct : g.ult.abs;
    if (g.minAmp && !i.isDeriv) d = Math.max(d, CONFIG.minAmplitudeStocks);
    return Math.max(2, d / i.tick);
  }
  hwNow(i) { const u = i.tun.ult; return u ? Math.max(2, (u.hi - u.lo) / 2) : this.halfWidthTicks(i); }
  initMMs() {
    const rs = this.rs, B = CONFIG.brokers;
    for (const i of this.insts) {
      const hw = this.halfWidthTicks(i), n = i.isOpt ? 7 : 10;
      const target = Math.max(n - 1, Math.round(0.55 * hw));
      const offs = [];
      for (let k = 0; k < n; k++) {
        let o = k < 5 ? k : Math.round(4 + (target - 4) * Math.pow((k - 4) / (n - 5), 1.4));
        if (k > 0 && o <= offs[k - 1]) o = offs[k - 1] + 1;
        offs.push(o);
      }
      i.mmOffs = offs; i.mmSize = Math.max(i.lot, Math.round(i.tradeSize * 2.2 / i.lot) * i.lot);
      const b1 = rs.pick(B); let b2 = rs.pick(B); while (b2 === b1) b2 = rs.pick(B);
      i.mms = [b1, b2].map(br => ({ br, b: new Map(), a: new Map(), every: CONFIG.flow.mmEverySec * rs.range(0.8, 1.25), next: 0 }));
    }
  }
  newsSize(i, rng) { const r = rng || this.rs; return i.tunnelGroup === 'DI1' ? r.range(0.12, 0.25) : (i.tunnelGroup === 'WIN' ? r.range(0.012, 0.02) : (i.isFut ? r.range(0.008, 0.013) : r.range(0.03, 0.07))); }
  buildScript() {
    const rs = this.rs, I = this.I, C = CONFIG.script, ev = [];
    const cnt = b => { const x = b * I.events, f = Math.floor(x); return f + (rs.chance(x - f) ? 1 : 0); };
    const stocks = this.insts.filter(i => i.type === 'stock' || i.type === 'etf');
    const trad = this.insts.filter(i => !i.isOpt);
    const tS = () => rs.range(DAY('10:12'), DAY('16:40'));
    const tA = i => i.isFut ? rs.range(DAY('09:50'), DAY('18:05')) : tS();
    const add = (type, i) => ev.push({ t: tA(i), type, tk: i.ticker, dir: rs.chance(0.5) ? 1 : -1, size: this.newsSize(i) });
    const newsable = trad.filter(i => i.type !== 'etf'); // ETF segue a carteira: notícia vem pelo mercado
    for (let k = cnt(C.news); k-- > 0;) add('news', rs.pick(newsable));
    for (let k = cnt(C.macro); k-- > 0;) ev.push({ t: tS(), type: 'macro', tk: 'WINV26', dir: rs.chance(0.5) ? 1 : -1, size: rs.range(0.014, 0.022) });
    for (let k = cnt(C.escada); k-- > 0;) add('escada', rs.pick(stocks.concat([this.by.WINV26])));
    for (let k = cnt(C.whale); k-- > 0;) add('whale', rs.pick(trad));
    for (let k = cnt(C.ffPrice); k-- > 0;) add('ffPrice', rs.pick(this.insts));
    for (let k = cnt(C.ffQty); k-- > 0;) add('ffQty', rs.pick(this.insts));
    for (let k = cnt(C.qtyAuction); k-- > 0;) add('qtyAuction', rs.pick(trad));
    ev.sort((a, b) => a.t - b.t);
    for (const e of ev) e.deadline = e.t + 1800;
    this.script = ev;
  }

  /* ----------------------------- valor justo ----------------------------- */
  updateFV(dt) {
    const I = this.I, r = this.rf, sq = dt > 0 ? Math.sqrt(dt / CONFIG.market.tradingDaySec) : 0;
    if (dt > 0) {
      this.m += CONFIG.market.dailyVol * I.vol * sq * r.n();
      if (this.crash) { const c = this.crash; if (this.m > c.target) this.m = Math.max(c.target, this.m + c.rate * dt); else this.crash = null; }
    }
    let s = 0;
    for (const i of this.insts) {
      if (i.type !== 'stock') continue;
      if (dt > 0) i.e += i.idio * I.vol * sq * r.n();
      i.fv = i.prevClose * Math.exp(i.beta * this.m + i.e + i.gap + i.shift);
      if (i.ibovWeight) s += i.ibovWeight * i.fv / i.prevClose;
    }
    this.ibovFair = this.ibov0 * s;
    for (const i of this.insts) {
      if (i.type === 'stock') continue;
      if (dt > 0 && !i.isOpt) i.e += i.idio * I.vol * sq * r.n();
      if (i.type === 'etf' && dt > 0) i.shift *= Math.exp(-dt / 90); // arbitragem puxa o ETF de volta à carteira
      if (i.type === 'etf') i.fv = i.prevClose * s * Math.exp(i.e + i.shift);
      else if (i.tunnelGroup === 'WIN') i.fv = i.settle * s * Math.exp(i.e + i.shift);
      else if (i.tunnelGroup === 'WDO') i.fv = i.settle * Math.exp(i.beta * this.m + i.e + i.shift);
      else if (i.tunnelGroup === 'DI1') i.fv = i.settle + i.beta * this.m + i.e + i.shift;
      else if (i.isOpt) {
        const u = this.by[i.underlying];
        const S = ((u.state === ST.CALL && u.auction && u.auction.theo != null) ? u.auction.theo : (u.baseT != null ? u.baseT : u.prevCloseT)) * u.tick; i.fv = bsPrice(i.cp, S, i.strike, this.optT, CONFIG.option.r, i.iv); }
    }
  }

  /* ----------------------------- passo ----------------------------- */
  step(dt) {
    this.t += dt; const t = this.t;
    this.updateFV(dt);
    this.schedule();
    if (this.cb.active && t >= this.cb.until) this.cbReopen();
    if (!this.cb.active) this.runScript();
    for (const i of this.insts) {
      if (!this.cb.active) {
        if (i.state === ST.CONT || i.state === ST.AFTER) this.flowCont(i, dt);
        else if (i.state === ST.AUC || i.state === ST.CALL) {
          this.flowAuction(i, dt);
          if (i.auction && t >= i.auction.plannedEnd) this.endCheck(i);
        }
      }
      this.updateRef(i);
      this.refreshTunnels(i);
      this.record(i);
    }
    this.computeIbov();
    this.checkCB();
    if (t >= this.T.dayEnd && !this.ended) { this.ended = true; this.feedAdd(null, 'info', 'Pregão encerrado. O resumo do dia está disponível.'); }
    if (this.hook) this.hook();
  }

  /* ----------------------------- fases do pregão ----------------------------- */
  schedule() {
    const t = this.t, T = this.T, AM = CONFIG.schedule.afterMarket;
    for (const i of this.insts) {
      if (i.isFut) {
        if (i.state === ST.PRE && t >= T.fPre && t < T.fClose) this.startCall(i, 'call_open', T.fOpen);
        else if ((i.state === ST.CONT || i.state === ST.AUC || i.state === ST.CALL) && t >= T.fClose) this.closeDay(i);
        continue;
      }
      const pre = i.isOpt ? T.oPre : T.preOpen, open = i.isOpt ? T.oOpen : T.open;
      const cc = i.isOpt ? T.oCloseCall : T.closeCall, cl = i.isOpt ? T.oClose : T.close;
      if (i.state === ST.PRE && t >= pre && t < cc) this.startCall(i, 'call_open', open);
      else if ((i.state === ST.CONT || i.state === ST.AUC) && t >= cc && !i.closeCallStarted) this.startCloseCall(i, cl);
      else if (i.state === ST.CLOSED && !i.afterDone && AM.enabled && i.type === 'stock' && i.tunnelGroup === 'IBOV' && t >= T.afterStart && t < T.afterEnd) this.startAfter(i);
      else if (i.state === ST.AFTER && t >= T.afterEnd) this.endAfter(i);
    }
    const M = this.msg;
    if (!M.pre && t >= T.preOpen) { M.pre = 1; this.feedAdd(null, 'call', 'Pré-abertura: ações e opções acumulam ofertas no call de abertura até 10:00. No encerramento vale o túnel de proteção dos calls.'); }
    if (!M.close && t >= T.closeCall) { M.close = 1; this.feedAdd(null, 'call', 'Call de fechamento: ações e opções acumulam ofertas até 17:00; o preço de fechamento sai desse leilão.'); }
    if (!M.after && AM.enabled && t >= T.afterStart) { M.after = 1; this.feedAdd(null, 'call', 'After-market aberto: só ações do Ibovespa/IBrX-100, com oscilação máxima de ±2% sobre o fechamento.'); }
    if (!M.afterEnd && AM.enabled && t >= T.afterEnd) { M.afterEnd = 1; this.feedAdd(null, 'info', 'After-market encerrado. Os futuros seguem até 18:25.'); }
  }
  startCall(i, kind, endT) {
    const refT = kind === 'call_open' ? (i.isDeriv ? i.settleT : i.prevCloseT) : i.refT();
    const a = this.newAuction(i, kind, { kind }, refT, i.g.protCall, Math.max(1, endT - this.t));
    i.state = ST.CALL; this.logState(i, 'call'); this.stats.calls[kind]++;
    return a;
  }
  startCloseCall(i, cl) {
    i.closeCallStarted = true;
    if (i.state === ST.AUC && i.auction) {
      const a = i.auction;
      a.kind = 'call_close'; a.plannedEnd = Math.max(cl, this.t + 1); a.ladder = 0; a.protCount = 0;
      a.protSpec = i.g.protCall; a.prot = this.protBand(i, a.refT, i.g.protCall); a.flowUntil = a.plannedEnd - 60;
      this.planLate(a); i.state = ST.CALL; this.logState(i, 'call'); this.stats.calls.call_close++;
      this.feedAdd(i, 'call', `${i.ticker}: o leilão em andamento foi incorporado ao call de fechamento`);
    } else this.startCall(i, 'call_close', cl);
  }
  startAfter(i) {
    i.afterDone = true;
    const c = i.close != null ? i.close : i.refT(), b = CONFIG.schedule.afterMarket.bandPct;
    i.afterBand = { lo: Math.ceil(c * (1 - b) - 1e-7), hi: Math.floor(c * (1 + b) + 1e-7), c };
    i.state = ST.AFTER; i.tun.rej = Object.assign({}, i.afterBand); this.logState(i, 'after');
  }
  endAfter(i) { this.clearBook(i); i.state = ST.CLOSED; this.logState(i, 'closed'); }
  closeDay(i) {
    if (i.auction) { const a = i.auction; a.ended = true; a.t1 = this.t; a.how = 'fechamento'; i.auction = null; }
    i.close = i.last; this.clearBook(i); i.state = ST.CLOSED; this.logState(i, 'closed');
    this.feedAdd(i, 'info', `${i.ticker} encerrou a sessão a ${fpr(i, i.refT())}`);
  }
  clearBook(i) {
    for (const o of i.orders.values()) { if (o.status === 'aberta' || o.status === 'parcial') o.status = 'expirada'; if (o.own) this.emit({ k: 'own', tk: i.ticker }); }
    i.bids = []; i.asks = []; i.moaB = []; i.moaS = []; i.orders.clear();
    for (const mm of i.mms) { mm.b.clear(); mm.a.clear(); }
  }

  /* ----------------------------- agentes ----------------------------- */
  size(i) { const q = this.rf.logn(i.tradeSize, 0.9); return Math.max(i.lot, Math.round(q / i.lot) * i.lot); }
  flowCont(i, dt) {
    const r = this.rf, t = this.t;
    if (i.escada && t >= i.escada.next) { this.escadaStep(i); if (i.state !== ST.CONT) return; }
    for (const mm of i.mms) {
      if (t >= mm.next) {
        mm.next = t + mm.every * (0.75 + 0.5 * r.u());
        this.mmQuote(i, mm);
        if (i.state !== ST.CONT && i.state !== ST.AFTER) return;
      }
    }
    const lam = i.activity * this.I.flow * (i.state === ST.AFTER ? 0.25 : 1);
    let n = r.poisson(lam * dt);
    while (n-- > 0) { this.taker(i); if (i.state !== ST.CONT && i.state !== ST.AFTER) return; }
    n = r.poisson(lam * CONFIG.flow.passiveRatio * dt);
    while (n-- > 0) this.passive(i);
    if (r.chance(0.35 * dt)) this.tidy(i);
  }
  mmQuote(i, mm) {
    const c = i.fv / i.tick, h = i.halfSpread, offs = i.mmOffs, n = offs.length;
    const wb = new Array(n), wa = new Array(n);
    for (let k = 0; k < n; k++) { wb[k] = Math.floor(c - h - offs[k] + 1e-9); wa[k] = Math.ceil(c + h + offs[k] - 1e-9); }
    if (i.state === ST.AFTER) {
      const b = i.afterBand;
      for (let k = 0; k < n; k++) { if (wb[k] < b.lo || wb[k] > b.hi) wb[k] = null; if (wa[k] > b.hi || wa[k] < b.lo) wa[k] = null; }
    }
    for (const [p, o] of Array.from(mm.b)) if (!wb.includes(p)) this.cancel(i, o.id, false);
    for (const [p, o] of Array.from(mm.a)) if (!wa.includes(p)) this.cancel(i, o.id, false);
    const sz = k => Math.max(i.lot, Math.round(i.mmSize * (1 + 0.3 * k) / i.lot) * i.lot);
    for (let k = 0; k < n; k++) {
      const p = wb[k];
      if (p != null && p > 0 && !mm.b.has(p)) { this.submit(i, { side: 1, type: LMT, p, q: sz(k), br: mm.br, mm, tag: 'formador' }); if (i.state !== ST.CONT && i.state !== ST.AFTER) return; }
    }
    for (let k = 0; k < n; k++) {
      const p = wa[k];
      if (p != null && !mm.a.has(p)) { this.submit(i, { side: -1, type: LMT, p, q: sz(k), br: mm.br, mm, tag: 'formador' }); if (i.state !== ST.CONT && i.state !== ST.AFTER) return; }
    }
  }
  taker(i) {
    const r = this.rf, bb = i.bb(), ba = i.ba();
    if (bb == null || ba == null) { this.passive(i); return; }
    const mid = (bb + ba) / 2, fvT = i.fv / i.tick, hw = this.hwNow(i);
    const bias = clamp((fvT - mid) / hw * 2.5, -0.38, 0.38);
    const side = r.u() < 0.5 + bias ? 1 : -1, q = this.size(i), br = r.pick(CONFIG.brokers);
    if (i.state === ST.CONT && r.chance(0.16)) { this.submit(i, { side, type: MKT, p: null, q, br, tag: 'agressor' }); return; }
    let p = side > 0 ? ba + (r.chance(0.3) ? r.int(1, 2) : 0) : bb - (r.chance(0.3) ? r.int(1, 2) : 0);
    if (i.state === ST.AFTER) p = clamp(p, i.afterBand.lo, i.afterBand.hi);
    if (p < 1) return;
    this.submit(i, { side, type: LMT, p, q, br, tag: 'agressor' });
  }
  passive(i) {
    const r = this.rf, fvT = i.fv / i.tick, bb = i.bb(), ba = i.ba(), hw = this.hwNow(i);
    const side = r.chance(0.5) ? 1 : -1, deep = !i.isOpt && r.chance(0.07);
    const off = deep ? Math.round(hw * r.range(0.9, 2.4)) : r.int(0, 6);
    let p = side > 0 ? Math.floor(fvT - i.halfSpread - off) : Math.ceil(fvT + i.halfSpread + off);
    if (side > 0 && ba != null && p >= ba) p = ba - 1;
    if (side < 0 && bb != null && p <= bb) p = bb + 1;
    const rj = i.tun.rej; if (rj) p = clamp(p, rj.lo, rj.hi);
    if (i.state === ST.AFTER) { if ((side > 0 && ba != null && p >= ba) || (side < 0 && bb != null && p <= bb)) return; }
    if (p < 1) return;
    this.submit(i, { side, type: LMT, p, q: this.size(i) * (deep ? 2 : 1), br: r.pick(CONFIG.brokers), tag: 'passiva' });
  }
  tidy(i) {
    const r = this.rf;
    for (const side of [i.bids, i.asks]) {
      if (side.length > 36) { const l = side[side.length - 1]; for (const o of l.orders.slice()) if (!o.own) this.cancel(i, o.id, false); }
      if (side.length > 3 && r.chance(0.5)) {
        const l = side[r.int(1, side.length - 1)], o = l && l.orders[0];
        if (o && !o.own && !o.mm && this.t - o.t > 60) this.cancel(i, o.id, false);
      }
    }
  }
  flowAuction(i, dt) {
    const a = i.auction; if (!a) return;
    const r = this.rf, t = this.t, F = CONFIG.flow;
    const rate = a.kind === 'auction' ? F.auctionOrdersPerSec : (a.kind === 'call_close' ? F.closeCallOrdersPerSec : F.callOrdersPerSec);
    const lam = i.activity * rate * this.I.flow;
    if (t < a.flowUntil) {
      let n = r.poisson(lam * dt); while (n-- > 0) this.auctionOrder(i, a, false);
      if (r.chance(0.06 * lam * dt)) this.auctionCancel(i);
    } else if (a.protCount > 0 && t < a.lastProrrT + 20 && !this.quiet.has(i.ticker)) {
      if (r.chance(lam * 0.35 * dt)) this.auctionOrder(i, a, false);
    }
    if (a.lateAt != null && t >= a.lateAt) { a.lateAt = null; this.auctionOrder(i, a, true); }
  }
  auctionOrder(i, a, late) {
    const r = this.rf, fvT = i.fv / i.tick, hw = this.hwNow(i);
    let side = r.chance(0.5) ? 1 : -1, p = null, type = LMT, q = this.size(i);
    // ofertas de leilão/call menores e sem cauda gorda (evita proteção por quantidade à toa)
    q = Math.min(q * (a.kind === 'auction' ? 0.8 : 0.5), i.tradeSize * 3);
    q = Math.max(i.lot, Math.round(q / i.lot) * i.lot);
    if (late) {
      const th = a.theo != null ? a.theo : Math.round(fvT);
      p = side > 0 ? th + r.int(0, 2) : th - r.int(0, 2);
      q = Math.max(i.lot, Math.round(q * 0.6 / i.lot) * i.lot);
    } else {
      if (r.chance(0.07)) type = MOA;
      const s = Math.max(2, hw * (a.kind === 'auction' ? 0.22 : 0.3));
      p = Math.round(fvT + side * 0.5 * s + r.n() * s);
    }
    if (type === LMT) { const rj = i.tun.rej; if (rj) p = clamp(p, rj.lo, rj.hi); if (p < 1) p = 1; }
    this.submit(i, { side, type, p: type === LMT ? p : null, q, br: r.pick(CONFIG.brokers), tag: late ? 'tardia' : 'leilão' });
  }
  auctionCancel(i) {
    const r = this.rf, side = r.chance(0.5) ? i.bids : i.asks; if (!side.length) return;
    const l = side[r.int(0, side.length - 1)], o = l.orders[r.int(0, l.orders.length - 1)];
    if (!o || o.own || o.mm || this.isLocked(i, o)) return;
    this.cancel(i, o.id, false);
  }
  depthTo(i, dir, target) { let q = 0; const opp = dir > 0 ? i.asks : i.bids; for (const l of opp) { if (dir > 0 ? l.p > target : l.p < target) break; q += l.qty; } return q; }

  /* ---------------- eventos do roteiro e cenários ---------------- */
  runScript() {
    for (const ev of this.script) {
      if (ev.done || ev.t > this.t) continue;
      const i = this.by[ev.tk];
      if (i.state !== ST.CONT) { ev.t = this.t + 45; if (ev.t > ev.deadline) ev.done = true; continue; }
      ev.done = true; this.fire(ev.type, i, ev.dir, ev.size);
    }
  }
  fire(type, i, dir, size) {
    switch (type) {
      case 'news': return this.doNews(i, dir, size);
      case 'macro': return this.doMacro(dir, size);
      case 'escada': return this.doEscada(i, dir);
      case 'whale': return this.doWhale(i, dir);
      case 'ffPrice': return this.doFFPrice(i, dir);
      case 'ffQty': return this.doFFQty(i, dir);
      case 'qtyAuction': return this.doQtyAuction(i, dir);
    }
  }
  doNews(i, dir, size) {
    if (size == null) size = this.newsSize(i, this.rf);
    if (i.tunnelGroup === 'DI1') i.shift += dir * size; else i.shift += Math.log(1 + dir * size);
    this.feedAdd(i, 'info', `Notícia simulada em ${i.ticker}: o valor justo ${dir > 0 ? 'sobe' : 'cai'} ${i.cur === '%' ? fnum(size, 2) + ' p.p.' : fnum(size * 100, 1) + '%'}; os formadores de mercado vão reprecificar.`);
  }
  doMacro(dir, size) {
    this.m += Math.log(1 + dir * size);
    this.feedAdd(null, 'info', `Notícia macro simulada: o mercado todo ${dir > 0 ? 'sobe' : 'cai'} cerca de ${fnum(size * 100, 1)}% (ações pelo beta, WIN junto, dólar e juros no sentido contrário).`);
  }
  doEscada(i, dir) {
    if (!i.g.med) return false;
    i.escada = { dir, left: 5, next: this.t, br: this.rf.pick(CONFIG.brokers) };
    this.feedAdd(i, 'info', `Escada simulada em ${i.ticker}: agressões pequenas de ${dir > 0 ? 'compra' : 'venda'} em sequência; cada uma passa no túnel do último preço, mas somadas se afastam da média de ${CONFIG.vwapWindowSec} s.`);
    return true;
  }
  escadaStep(i) {
    const s = i.escada, hw = this.hwNow(i), stepT = Math.max(1, Math.round(hw * 0.62));
    const L = i.last != null ? i.last : i.refT();
    if (i.tunnelGroup === 'DI1') i.shift += s.dir * stepT * i.tick; else i.shift += s.dir * Math.log(1 + stepT / L) * 0.95;
    const target = Math.max(1, L + s.dir * stepT), depth = this.depthTo(i, s.dir, target);
    const q = Math.min(i.qtyAuction - i.lot, Math.max(i.lot, Math.round(depth * 1.08 / i.lot) * i.lot + i.lot));
    s.left--; s.next = this.t + this.rf.range(7, 12);
    this.submit(i, { side: s.dir, type: LMT, p: target, q, br: s.br, tag: 'escada' });
    if (s.left <= 0 || i.state !== ST.CONT) i.escada = null;
  }
  doWhale(i, dir) {
    const hw = this.hwNow(i), L = i.last != null ? i.last : i.refT();
    const target = Math.max(1, L + dir * Math.round(hw * this.rf.range(1.5, 2.1)));
    const edge = dir > 0 ? i.tun.ult.hi : i.tun.ult.lo;
    return this.doPush(i, dir, edge, target, 'baleia', (q, pulled) =>
      `Baleia simulada em ${i.ticker}: ${dir > 0 ? 'compra' : 'venda'} de ${fq(q)} ${unitQ(i)} com limite ${fpr(i, target)}, grande o bastante para varrer o livro` +
      (pulled ? `. Antes dela, a liquidez recuou: ${pulled} ofertas de ${dir > 0 ? 'venda' : 'compra'} mais distantes foram canceladas` : '') + '.');
  }
  /* Ordem agressiva que varre o livro até passar de 'edge' (limite de algum túnel), com preço-limite 'target'.
     Num livro fundo, uma única oferta abaixo do limite de quantidade não alcança a borda: simula o recuo da
     liquidez (as ofertas mais distantes do lado oposto são canceladas antes). Garante uma contraparte além
     da borda, para que o negócio fora do túnel aconteça na hora. */
  doPush(i, dir, edge, target, tag, msgFn, br, extraQ) {
    const cap = Math.max(i.lot, Math.floor((i.qtyAuction - i.lot) / i.lot) * i.lot);
    const extra = extraQ != null ? Math.max(i.lot, Math.round(extraQ / i.lot) * i.lot) : Math.max(i.lot, Math.min(Math.round(cap * 0.3 / i.lot) * i.lot,
      Math.round(CONFIG.prorrogation.qtyProtectionLots * i.lot * this.rf.range(0.35, 0.6) / i.lot) * i.lot));
    const pulled = this.thinTo(i, dir, edge, cap - extra);
    if (this.depthTo(i, dir, target) - this.depthTo(i, dir, edge) <= 0) {
      const pd = edge + dir * Math.max(1, Math.round(Math.abs(target - edge) / 3));
      this.submit(i, { side: -dir, type: LMT, p: pd, q: this.size(i), br: this.rf.pick(CONFIG.brokers), tag: 'livro' });
    }
    const inside = this.depthTo(i, dir, edge);
    const q = Math.min(cap, Math.max(i.lot, Math.round(inside / i.lot) * i.lot + extra));
    if (msgFn) this.feedAdd(i, 'info', msgFn(q, pulled));
    return this.submit(i, { side: dir, type: LMT, p: target, q, br: br || this.rf.pick(CONFIG.brokers), tag });
  }
  /* cancela ofertas do lado oposto, das mais distantes para as mais próximas, até a profundidade até 'edge' caber em 'room' */
  thinTo(i, dir, edge, room) {
    let inside = this.depthTo(i, dir, edge), pulled = 0;
    if (inside <= room) return 0;
    const levels = (dir > 0 ? i.asks : i.bids).filter(l => dir > 0 ? l.p <= edge : l.p >= edge);
    const pull = keepTop => {
      for (let k = levels.length - 1; k >= keepTop && inside > room * 0.8; k--)
        for (const o of levels[k].orders.slice()) {
          if (o.own) continue; if (inside <= room * 0.8) break;
          this.remove(i, o); o.status = 'cancelada'; inside -= o.rem; pulled++;
        }
    };
    pull(2); pull(0);
    return pulled;
  }
  /* compra (ou vende) tudo até 'target', sem passar dele: move o preço dentro do túnel, sem leilão */
  doSweepTo(i, dir, target, br) {
    const cap = Math.max(i.lot, Math.floor((i.qtyAuction - i.lot) / i.lot) * i.lot);
    this.thinTo(i, dir, target, cap);
    const q = Math.min(cap, Math.round(this.depthTo(i, dir, target) / i.lot) * i.lot);
    if (q < i.lot) return null;
    return this.submit(i, { side: dir, type: LMT, p: target, q, br: br || this.rf.pick(CONFIG.brokers), tag: 'varredura' });
  }
  doFFPrice(i, dir) {
    const L = i.last != null ? i.last : i.refT();
    const p = dir > 0 ? L * 10 : Math.max(1, Math.round(L / 10));
    return this.submit(i, { side: dir, type: LMT, p, q: this.size(i), br: this.rf.pick(CONFIG.brokers), tag: 'dedo gordo' });
  }
  doFFQty(i, dir) {
    const q = Math.round(i.qtyReject * this.rf.range(1.5, 6) / i.lot) * i.lot;
    const p = dir > 0 ? (i.ba() != null ? i.ba() : i.refT()) : (i.bb() != null ? i.bb() : i.refT());
    return this.submit(i, { side: dir, type: LMT, p, q, br: this.rf.pick(CONFIG.brokers), tag: 'dedo gordo' });
  }
  doQtyAuction(i, dir) {
    const q = Math.min(i.qtyReject - i.lot, Math.round(i.qtyAuction * this.rf.range(1.2, 1.8) / i.lot) * i.lot);
    const p = dir > 0 ? (i.ba() != null ? i.ba() : i.refT()) : (i.bb() != null ? i.bb() : i.refT());
    return this.submit(i, { side: dir, type: LMT, p, q, br: this.rf.pick(CONFIG.brokers), tag: 'ordem grande' });
  }
  startCrash() {
    this.crash = { target: this.m + Math.log(0.875), rate: Math.log(0.875) / 900 };
    this.feedAdd(null, 'info', 'Cenário de estresse simulado: notícias muito negativas derrubam o valor justo de todo o mercado nos próximos minutos.');
  }

  /* ============================================================================
     4.4 VALIDAÇÃO DE CADA OFERTA — exatamente nesta ordem:
       receberOferta(ativo, oferta):
         1. ativo parado (circuit breaker)         → rejeita "negociação interrompida"
         2. fora do horário (antes da abertura/encerrado) → rejeita
         3. quantidade inválida (não múltipla do lote) → rejeita
         4. quantidade > limite de rejeição         → rejeita (túnel de rejeição por quantidade)
         5. MOA fora de leilão/call                 → rejeita
         6. after-market: só limitadas dentro de ±2% do fechamento
         7. limitada fora do túnel de rejeição (compra > sup., venda < inf.) → rejeita
         8. ativo em leilão ou call                 → entra no livro, recalcula teórico e
                                                       registra os 4 fatos de prorrogação
         9. quantidade > limite de leilão por quantidade → entra no livro e abre leilão
        10. casa contra o livro; ANTES de cada negócio checa os túneis de leilão
            (estático, último preço, preço médio) com os limites vigentes no início
            da oferta → se violar, interrompe, o restante entra no leilão
        11. restante: limitada vai ao livro; a mercado é cancelada (simplificação)
     ============================================================================ */
  validate(i, o) {
    const u = unitQ(i), T = this.T;
    if (i.state === ST.HALT) return { ok: false, code: 'halt', msg: 'negociação interrompida (circuit breaker)' };
    if (i.state === ST.PRE) return { ok: false, code: 'hora', msg: i.isFut ? 'fora do horário (pré-abertura às 08:55)' : 'fora do horário: a pré-abertura começa às 09:45' };
    if (i.state === ST.CLOSED) {
      let msg = 'pregão encerrado';
      if (i.type === 'stock' && i.tunnelGroup === 'IBOV' && CONFIG.schedule.afterMarket.enabled && !i.afterDone && this.t < T.afterStart) msg = 'pregão regular encerrado; o after-market abre às 17:30';
      else if (!i.isFut && this.t >= T.afterStart && this.t < T.afterEnd && !i.afterDone) msg = 'fora do after-market (só ações do Ibovespa/IBrX-100)';
      return { ok: false, code: 'hora', msg };
    }
    if (!(o.q > 0) || o.q % i.lot !== 0) return { ok: false, code: 'lote', msg: `quantidade deve ser múltipla do lote (${fq(i.lot)})` };
    if (o.q > i.qtyReject) return { ok: false, code: 'qtd', msg: `quantidade acima do limite por oferta (máx. ${fq(i.qtyReject)} ${u})` };
    if (o.type === MOA && i.state !== ST.AUC && i.state !== ST.CALL) return { ok: false, code: 'moa', msg: 'oferta MOA só vale durante leilão ou call' };
    if (i.state === ST.AFTER) {
      const b = i.afterBand;
      if (o.type !== LMT) return { ok: false, code: 'after', msg: 'o after-market aceita só ofertas limitadas' };
      if (o.p > b.hi || o.p < b.lo) return { ok: false, code: 'after', msg: `o after-market limita a ±2% do fechamento (${fp(i, b.lo)} a ${fp(i, b.hi)})`, bound: o.p > b.hi ? b.hi : b.lo };
      return { ok: true };
    }
    if (o.type === LMT) {
      if (!(o.p >= 1)) return { ok: false, code: 'preco', msg: 'preço inválido' };
      const r = i.tun.rej;
      if (o.side > 0 && o.p > r.hi) return { ok: false, code: 'preco', msg: `acima do túnel de rejeição (limite ${fpr(i, r.hi)})`, bound: r.hi };
      if (o.side < 0 && o.p < r.lo) return { ok: false, code: 'preco', msg: `abaixo do túnel de rejeição (limite ${fpr(i, r.lo)})`, bound: r.lo };
    }
    return { ok: true };
  }
  submit(i, s) {
    const o = { id: ++this.oid, side: s.side, type: s.type, p: s.type === LMT ? s.p : null, q: s.q, rem: s.q, br: s.br || '—', t: this.t,
      own: !!s.own, mm: s.mm || null, tag: s.tag || '', status: 'aberta', filled: 0, avg: 0 };
    const v = this.validate(i, o);
    if (!v.ok) { o.status = 'rejeitada'; o.msg = v.msg; o.rem = 0; this.onReject(i, o, v); return { ok: false, o, v, out: 'rej' }; }
    let out;
    if (i.state === ST.AUC || i.state === ST.CALL) { this.addAuctionOrder(i, o); out = 'auc'; }
    else if (i.state === ST.CONT && o.q > i.qtyAuction) {
      this.startAuction(i, { kind: 'qtd', q: o.q, lim: i.qtyAuction, side: o.side, p: o.p });
      this.addAuctionOrder(i, o); out = 'trig';
    } else {
      const nt = i.nTrades;
      out = this.matchCont(i, o);
      if (i.nTrades !== nt && i.state === ST.CONT) this.refreshTunnels(i);
    }
    if (i.ticker === this.focusTk || o.own) this.emit({ k: 'order', tk: i.ticker, side: o.side, p: o.p, q: o.q, out, own: o.own, type: o.type });
    return { ok: true, o, out };
  }
  onReject(i, o, v) {
    if (v.code === 'preco') this.stats.rejPreco++; else if (v.code === 'qtd') this.stats.rejQtd++; else this.stats.rejOutros++;
    i.st.rej++;
    i.rejMarks.push({ t: this.t, p: o.p, side: o.side, code: v.code }); if (i.rejMarks.length > 4000) i.rejMarks.splice(0, 1000);
    const what = `${o.side > 0 ? 'compra' : 'venda'} de ${fq(o.q)} ${o.type === LMT ? 'a ' + fpr(i, o.p) : (o.type === MOA ? 'MOA' : 'a mercado')}`;
    const tag = o.own ? ' (sua oferta)' : (o.tag === 'dedo gordo' ? ' (dedo gordo simulado)' : '');
    this.feedAdd(i, 'rej', `${i.ticker}: ${what} rejeitada${tag}: ${v.msg}`, o.own);
    this.emit({ k: 'rej', tk: i.ticker, side: o.side, p: o.p, code: v.code, bound: v.bound, own: o.own });
    if (o.own || i.ticker === this.focusTk) this.emit({ k: 'order', tk: i.ticker, side: o.side, p: o.p, q: o.q, out: 'rej', own: o.own, type: o.type, bound: v.bound });
  }
  checkTun(i, p, tu) {
    const e = tu.est, u = tu.ult, m = tu.med;
    if (e && (p > e.hi || p < e.lo)) return { kind: 'est', p, bound: p > e.hi ? e.hi : e.lo, base: e.c, dir: p > e.hi ? 1 : -1 };
    if (u && (p > u.hi || p < u.lo)) return { kind: 'ult', p, bound: p > u.hi ? u.hi : u.lo, base: u.c, dir: p > u.hi ? 1 : -1 };
    if (m && (p > m.hi || p < m.lo)) return { kind: 'med', p, bound: p > m.hi ? m.hi : m.lo, base: m.c, dir: p > m.hi ? 1 : -1 };
    return null;
  }
  matchCont(i, o) {
    const opp = o.side > 0 ? i.asks : i.bids;
    const tu = i.state === ST.CONT ? { ult: i.tun.ult, med: i.tun.med, est: i.tun.est } : null; // limites do início da oferta
    let trig = null, traded = false;
    while (o.rem > 0 && opp.length) {
      const lvl = opp[0];
      if (o.type === LMT && (o.side > 0 ? lvl.p > o.p : lvl.p < o.p)) break;
      if (tu) { trig = this.checkTun(i, lvl.p, tu); if (trig) break; }
      const ords = lvl.orders;
      while (o.rem > 0 && ords.length) {
        const r = ords[0], q = o.rem < r.rem ? o.rem : r.rem;
        this.trade(i, lvl.p, q, o, r); lvl.qty -= q; traded = true;
        if (r.rem <= 0) { ords.shift(); this.gone(i, r); }
      }
      if (!ords.length) opp.shift();
    }
    if (trig) {
      this.startAuction(i, trig);
      this.addAuctionOrder(i, o);
      return 'trig';
    }
    if (o.rem > 0) {
      if (o.type === LMT) this.insert(i, o);
      else o.status = o.filled > 0 ? 'parcial, resto cancelado' : 'cancelada: sem contraparte';
    }
    return traded ? 'trade' : 'book';
  }
  trade(i, p, q, ag, rs) {
    ag.rem -= q; rs.rem -= q; this.fill(ag, p, q); this.fill(rs, p, q);
    const buy = ag.side > 0 ? ag : rs, sell = ag.side > 0 ? rs : ag;
    this.print(i, p, q);
    this.ttPush(i, { t: this.t, p, q, b: buy.own ? 'Você' : buy.br, s: sell.own ? 'Você' : sell.br, ag: ag.side, auc: false });
    if (ag.own || rs.own) this.emit({ k: 'own', tk: i.ticker });
  }
  fill(o, p, q) { o.avg = (o.avg * o.filled + p * q) / (o.filled + q); o.filled += q; o.status = o.rem > 0 ? 'parcial' : 'executada'; }
  print(i, p, q) {
    i.last = p; i.lastTime = this.t; i.volume += q; i.nTrades++;
    if (i.open == null) i.open = p; if (i.high == null || p > i.high) i.high = p; if (i.low == null || p < i.low) i.low = p;
    this.vwAdd(i, p, q); i.hist.price.push(this.t, p);
  }
  ttPush(i, x) { i.tt.push(x); if (i.tt.length > 260) i.tt.splice(0, 60); }

  /* ----------------------------- livro ----------------------------- */
  insert(i, o) {
    if (o.type === MOA) { (o.side > 0 ? i.moaB : i.moaS).push(o); i.orders.set(o.id, o); return; }
    const side = o.side > 0 ? i.bids : i.asks, p = o.p;
    let lo = 0, hi = side.length;
    if (o.side > 0) { while (lo < hi) { const m = (lo + hi) >> 1; if (side[m].p > p) lo = m + 1; else hi = m; } }
    else { while (lo < hi) { const m = (lo + hi) >> 1; if (side[m].p < p) lo = m + 1; else hi = m; } }
    if (lo < side.length && side[lo].p === p) { side[lo].orders.push(o); side[lo].qty += o.rem; }
    else side.splice(lo, 0, { p, orders: [o], qty: o.rem });
    i.orders.set(o.id, o);
    if (o.mm) (o.side > 0 ? o.mm.b : o.mm.a).set(p, o);
  }
  levelIdx(side, p, dir) {
    let lo = 0, hi = side.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, v = side[m].p; if (v === p) return m; if (dir > 0 ? v > p : v < p) lo = m + 1; else hi = m - 1; }
    return -1;
  }
  remove(i, o) {
    if (o.type === MOA) { const arr = o.side > 0 ? i.moaB : i.moaS, k = arr.indexOf(o); if (k >= 0) arr.splice(k, 1); }
    else {
      const side = o.side > 0 ? i.bids : i.asks, idx = this.levelIdx(side, o.p, o.side);
      if (idx >= 0) { const l = side[idx], k = l.orders.indexOf(o); if (k >= 0) { l.orders.splice(k, 1); l.qty -= o.rem; if (!l.orders.length) side.splice(idx, 1); } }
    }
    this.gone(i, o);
  }
  gone(i, o) { i.orders.delete(o.id); if (o.mm) { const m = o.side > 0 ? o.mm.b : o.mm.a; if (m.get(o.p) === o) m.delete(o.p); } }
  isLocked(i, o) {
    const a = i.auction; if (!a || a.theo == null) return false;
    if (o.type === MOA) return true;
    return o.side > 0 ? o.p >= a.theo : o.p <= a.theo;
  }
  cancel(i, id, byUser) {
    const o = i.orders.get(id);
    if (!o) return { ok: false, msg: 'Essa oferta não está mais no livro (executada, cancelada ou expirada).' };
    if (i.auction && this.isLocked(i, o)) return { ok: false, locked: true, msg: 'Durante o leilão, compras com preço igual ou acima do teórico e vendas igual ou abaixo dele não podem ser canceladas nem reduzidas. Só é possível melhorar o preço ou aumentar a quantidade.' };
    this.remove(i, o); o.status = 'cancelada';
    if (i.auction) this.auctionChanged(i, null);
    if (byUser) this.emit({ k: 'own', tk: i.ticker });
    return { ok: true };
  }
  /* alteração da própria oferta: melhorar preço ou aumentar quantidade (perde prioridade) */
  modifyOwn(i, id, np, nq) {
    const o = i.orders.get(id);
    if (!o) return { ok: false, msg: 'Essa oferta não está mais no livro.' };
    const newP = np != null ? np : o.p, newQ = nq != null ? nq : o.rem;
    if (i.auction && this.isLocked(i, o)) {
      const worse = o.type === LMT && (o.side > 0 ? newP < o.p : newP > o.p);
      if (worse || newQ < o.rem) return { ok: false, locked: true, msg: 'Oferta travada no leilão: só é permitido melhorar o preço ou aumentar a quantidade.' };
    }
    const v = this.validate(i, { side: o.side, type: o.type, p: newP, q: newQ });
    if (!v.ok) return { ok: false, msg: 'Alteração rejeitada: ' + v.msg };
    this.remove(i, o); o.status = 'substituída';
    return this.submit(i, { side: o.side, type: o.type, p: newP, q: newQ, br: o.br, own: true, tag: 'sua' });
  }

  /* ----------------------------- leilão ----------------------------- */
  protBand(i, refT, spec) {
    const c = refT * i.tick, d = spec.pct != null ? c * spec.pct : spec.abs;
    let hi = Math.round((c + d) / i.tick), lo = Math.round((c - d) / i.tick);
    const mt = i.isOpt ? 3 : 1; // opções baratas: faixa nunca menor que 3 ticks por lado
    if (hi < refT + mt) hi = refT + mt; if (lo > refT - mt) lo = refT - mt;
    return { lo: Math.max(1, lo), hi, c: refT };
  }
  newAuction(i, kind, trig, refT, protSpec, dur) {
    const t = this.t;
    const a = { id: ++this.aid, tk: i.ticker, kind, trig, t0: t, plannedEnd: t + dur, dur0: dur, refT, protSpec, prot: this.protBand(i, refT, protSpec),
      theo: null, tq: 0, imb: 0, D: 0, S: 0, prorr: [], protCount: 0, noTheo: 0, ladder: 0,
      last: { theo: -1e9, qty: -1e9, alloc: -1e9, imb: -1e9 }, lastAny: -1e9, lastKind: null, changes: [],
      theoS: new Series(1), alloc: new Map(), lateAt: null, flowUntil: dur >= 120 ? t + dur - 60 : t + dur * 0.35,
      lastProrrT: -1e9, ended: false, t1: null, price: null, qty: 0, how: null };
    i.auction = a; i.auctions.push(a);
    this.planLate(a);
    const u = this.uncross(i, refT);
    a.theo = u.p; a.tq = u.q; a.imb = u.imb; a.D = u.D; a.S = u.S; a.alloc = this.alloc(i, u);
    a.theoS.push(t, u.p == null ? NaN : u.p);
    return a;
  }
  planLate(a) {
    const P = CONFIG.prorrogation, st = a.ladder;
    if (st >= P.ladder.length || this.quiet.has(a.tk)) { a.lateAt = null; return; }
    let p = CONFIG.flow.lateProb[st] * this.I.late;
    if (this.forceLate === a.tk && a.kind === 'call_close') p = 1;
    const w = P.ladder[st];
    a.lateAt = this.rf.chance(Math.min(1, p)) ? a.plannedEnd - 1 - this.rf.u() * Math.max(1, w - 4) : null;
  }
  auctionDuration(i, trig) {
    const D = CONFIG.auctionDuration;
    if (i.isFut) return D.futSec;
    if (i.isOpt) return D.optSec;
    if (trig.kind === 'qtd') return D.qtySec;
    const osc = Math.abs((trig.p != null ? trig.p : i.refT()) / i.prevCloseT - 1);
    if (osc >= D.extreme2Osc) return D.extreme2Sec;
    if (osc >= D.extremeOsc) return D.extremeSec;
    if (osc >= D.bigOsc) return D.bigSec;
    return i.g.auctionSec;
  }
  startAuction(i, trig) {
    const refT = i.refT(), dur = this.auctionDuration(i, trig);
    this.newAuction(i, 'auction', trig, refT, i.g.protAuction, dur);
    i.state = ST.AUC; i.escada = null; this.logState(i, 'auc');
    this.stats.auc[trig.kind]++; i.st.auctions++;
    this.feedAdd(i, 'auc', this.trigMsg(i, trig) + ` (leilão de ${fnum(dur / 60, 0)} min)`);
    this.emit({ k: 'aucStart', tk: i.ticker, kind: trig.kind });
  }
  trigMsg(i, tr) {
    if (tr.kind === 'qtd') return `${i.ticker} entrou em leilão por quantidade: oferta de ${fq(tr.q)} ${unitQ(i)} (leilão a partir de ${fq(tr.lim)})`;
    const dir = tr.dir > 0 ? 'acima' : 'abaixo', b = tr.base;
    let ref;
    if (tr.kind === 'ult') {
      if (i.isOpt) ref = `do preço teórico da opção (${fpr(i, b)})`;
      else if (i.g.stepped) ref = `do centro do túnel, atualizado em degraus (${fpr(i, b)})`;
      else if (i.g.priceBase === 'CLAST') ref = `do preço-base C-LAST (${fpr(i, b)})`;
      else if (i.g.priceBase === 'MOSTRECENT') ref = `do preço-base most recent (${fpr(i, b)})`;
      else ref = `do último preço (${fpr(i, b)})`;
    } else if (tr.kind === 'med') ref = `da média dos últimos ${CONFIG.vwapWindowSec} s (${fpr(i, b)})`;
    else ref = `do fechamento anterior (${fpr(i, b)}), túnel estático de ±${fnum(i.g.est.pct * i.staticStep * 100, 0)}%`;
    return `${i.ticker} entrou em leilão: negócio a ${fpr(i, tr.p)} ficaria ${fdist(i, tr.p, b)} ${dir} ${ref}; limite ${fpr(i, tr.bound)}`;
  }
  addAuctionOrder(i, o) {
    if (o.type === MKT) o.type = MOA; // a mercado vira MOA no leilão
    this.insert(i, o);
    this.auctionChanged(i, o);
  }
  auctionChanged(i, newO) {
    const a = i.auction; if (!a) return;
    const u = this.uncross(i, a.refT);
    const pt = a.theo, pq = a.tq, pi = a.imb;
    a.theo = u.p; a.tq = u.q; a.imb = u.imb; a.D = u.D; a.S = u.S;
    if (u.p !== pt) this.fact(i, a, 'theo');
    if (u.q !== pq) this.fact(i, a, 'qty');
    if (u.imb !== pi) this.fact(i, a, 'imb');
    const al = this.alloc(i, u);
    if (newO) {
      let ch = false;
      for (const [id, q] of a.alloc) { if (id !== newO.id && (al.get(id) || 0) !== q) { ch = true; break; } }
      if (!ch) for (const [id, q] of al) { if (id !== newO.id && q > 0 && !a.alloc.has(id)) { ch = true; break; } }
      if (ch) this.fact(i, a, 'alloc');
    }
    a.alloc = al;
    a.theoS.push(this.t, u.p == null ? NaN : u.p);
  }
  fact(i, a, k) {
    a.last[k] = this.t; a.lastAny = this.t; a.lastKind = k;
    a.changes.push({ t: this.t, k }); if (a.changes.length > 500) a.changes.splice(0, 150);
    if (i.ticker === this.focusTk) this.emit({ k: 'fact', tk: i.ticker, f: k });
  }
  /* preço teórico: 1) maximiza quantidade; 2) menor desequilíbrio; 3) mais perto da referência */
  uncross(i, refT) {
    let mb = 0, ms = 0;
    for (const o of i.moaB) mb += o.rem;
    for (const o of i.moaS) ms += o.rem;
    const B = i.bids, A = i.asks;
    if (!B.length && !A.length) {
      if (mb > 0 && ms > 0) return { p: refT, q: Math.min(mb, ms), D: mb, S: ms, imb: mb - ms };
      return { p: null, q: 0, D: mb, S: ms, imb: mb - ms };
    }
    const cand = []; let ia = 0, ib = B.length - 1;
    while (ia < A.length || ib >= 0) {
      let p; if (ib < 0 || (ia < A.length && A[ia].p <= B[ib].p)) { p = A[ia].p; ia++; } else { p = B[ib].p; ib--; }
      if (!cand.length || cand[cand.length - 1] !== p) cand.push(p);
    }
    const n = cand.length, S = new Array(n), D = new Array(n);
    let acc = ms, k = 0;
    for (let j = 0; j < n; j++) { while (k < A.length && A[k].p <= cand[j]) { acc += A[k].qty; k++; } S[j] = acc; }
    acc = mb; k = 0;
    for (let j = n - 1; j >= 0; j--) { while (k < B.length && B[k].p >= cand[j]) { acc += B[k].qty; k++; } D[j] = acc; }
    let best = -1, bq = 0, bi = Infinity, bd = Infinity;
    for (let j = 0; j < n; j++) {
      const q = D[j] < S[j] ? D[j] : S[j]; if (q <= 0) continue;
      const im = Math.abs(D[j] - S[j]), dd = Math.abs(cand[j] - refT);
      if (q > bq || (q === bq && (im < bi || (im === bi && dd < bd)))) { best = j; bq = q; bi = im; bd = dd; }
    }
    if (best < 0) return { p: null, q: 0, D: mb, S: ms, imb: mb - ms };
    return { p: cand[best], q: bq, D: D[best], S: S[best], imb: D[best] - S[best] };
  }
  /* atendimento por prioridade: MOA, depois preço, depois ordem de chegada */
  alloc(i, u) {
    const m = new Map(); if (u.p == null || u.q <= 0) return m;
    const P = u.p; let rem = u.q;
    for (const o of i.moaB) { if (rem <= 0) break; const q = Math.min(o.rem, rem); m.set(o.id, q); rem -= q; }
    for (const l of i.bids) { if (rem <= 0 || l.p < P) break; for (const o of l.orders) { if (rem <= 0) break; const q = Math.min(o.rem, rem); m.set(o.id, q); rem -= q; } }
    rem = u.q;
    for (const o of i.moaS) { if (rem <= 0) break; const q = Math.min(o.rem, rem); m.set(o.id, q); rem -= q; }
    for (const l of i.asks) { if (rem <= 0 || l.p > P) break; for (const o of l.orders) { if (rem <= 0) break; const q = Math.min(o.rem, rem); m.set(o.id, q); rem -= q; } }
    return m;
  }
  brokerMax(i, a) {
    const m = new Map();
    for (const [id, q] of a.alloc) { const o = i.orders.get(id); if (!o) continue; m.set(o.br, (m.get(o.br) || 0) + q); }
    let br = null, mx = 0; for (const [b, q] of m) if (q > mx) { mx = q; br = b; }
    return { br, lots: mx / i.lot };
  }
  endCheck(i) {
    const a = i.auction, P = CONFIG.prorrogation;
    if (a.theo == null || a.tq <= 0) {
      if (a.noTheo < P.maxNoTheo) { a.noTheo++; this.prorrogate(i, a, 'sem_teorico', 'nenhuma compra cruza com venda'); }
      else this.closeAuction(i, a, 'sem_negocio');
      return;
    }
    const pp = a.theo >= a.prot.hi || a.theo <= a.prot.lo;
    const bm = this.brokerMax(i, a), pq = bm.lots > P.qtyProtectionLots;
    if (pp || pq) {
      if (a.protCount >= P.maxProtection) {
        this.stats.sup++; a.sup = true;
        this.feedAdd(i, 'sup', `Supervisão de mercado (simulada) autorizou ${a.kind === 'call_open' ? 'a abertura' : (a.kind === 'call_close' ? 'o fechamento' : 'o encerramento do leilão')} de ${i.ticker} a ${fpr(i, a.theo)}, após ${a.protCount} prorrogações por proteção.`);
        this.closeAuction(i, a, 'supervisao');
        return;
      }
      a.protCount++;
      if (pp) this.prorrogate(i, a, 'prot_preco', `teórico ${fpr(i, a.theo)} ${a.theo >= a.prot.hi ? '≥ limite superior ' + fpr(i, a.prot.hi) : '≤ limite inferior ' + fpr(i, a.prot.lo)}`);
      else this.prorrogate(i, a, 'prot_qtd', `${bm.br} somaria ${fq(Math.round(bm.lots))} lotes entre compra e venda; limite ${P.qtyProtectionLots}`);
      return;
    }
    if (a.ladder < P.ladder.length) {
      const w = P.ladder[a.ladder];
      if (a.lastAny > a.plannedEnd - w) {
        a.ladder++;
        this.prorrogate(i, a, ['alt60', 'alt30', 'alt15'][a.ladder - 1], `${FACT_LABEL[a.lastKind] || 'alteração'} às ${hms(a.lastAny)}`);
        return;
      }
    }
    this.closeAuction(i, a, 'normal');
  }
  prorrogate(i, a, code, detail) {
    const prevEnd = a.plannedEnd; a.plannedEnd = prevEnd + CONFIG.prorrogation.extendSec; a.lastProrrT = this.t;
    a.prorr.push({ t: this.t, code, prevEnd, newEnd: a.plannedEnd, detail, theo: a.theo });
    this.stats.prorr[code]++; i.st.prorr++;
    this.logState(i, 'prorr');
    const nome = a.kind === 'call_open' ? 'call de abertura' : (a.kind === 'call_close' ? 'call de fechamento' : (a.kind === 'reopen' ? 'call de reabertura' : 'leilão'));
    this.feedAdd(i, 'prorr', `${i.ticker}: ${nome} prorrogado +1 min por ${PRORR_LABEL[code]} (${detail}); novo fim às ${hms(a.plannedEnd)}`);
    this.emit({ k: 'prorr', tk: i.ticker, code });
    this.planLate(a);
  }
  closeAuction(i, a, how) {
    const t = this.t;
    a.t1 = t; a.ended = true; a.how = how;
    let price = null, qty = 0;
    if (a.theo != null && a.tq > 0) { price = a.theo; qty = a.tq; this.executeUncross(i, a); }
    a.price = price; a.qty = qty; i.auction = null;
    if (a.kind === 'auction') this.stats.durations.push(t - a.t0);
    const n = a.prorr.length, pr = n ? `, após ${n} prorrogaç${n > 1 ? 'ões' : 'ão'}` : '';
    if (a.kind === 'call_close') {
      i.close = i.last; this.clearBook(i); i.state = ST.CLOSED; this.logState(i, 'closed');
      this.feedAdd(i, 'open', price != null ? `${i.ticker} fechou a ${fpr(i, price)} (${fpct(price / i.prevCloseT - 1)}) no call de fechamento${pr}` : `${i.ticker}: call de fechamento sem negócio; fechamento no último preço`);
    } else {
      i.state = ST.CONT; this.logState(i, 'cont');
      if (a.kind === 'call_open') this.feedAdd(i, 'open', price != null ? `${i.ticker} abriu a ${fpr(i, price)} (${fpct(price / i.prevCloseT - 1)})${pr}` : `${i.ticker} saiu do call de abertura sem negócio`);
      else if (a.kind === 'reopen') this.feedAdd(i, 'open', `${i.ticker} voltou a negociar após o circuit breaker${price != null ? ' a ' + fpr(i, price) : ''}`);
      else this.feedAdd(i, 'open', price != null ? `${i.ticker} voltou à negociação: leilão fechou a ${fpr(i, price)} com ${fq(qty)} ${unitQ(i)} a preço único${pr}; túneis recentralizados` : `${i.ticker} voltou à negociação sem negócio de leilão`);
      if (price != null && i.g.est) {
        while (Math.abs(price / i.prevCloseT - 1) > i.g.est.pct * i.staticStep + 1e-9) {
          i.staticStep++;
          this.feedAdd(i, 'info', `${i.ticker}: o leilão abriu além do degrau estático; o túnel estático passa a ±${fnum(i.g.est.pct * i.staticStep * 100, 0)}% sobre o fechamento anterior`);
        }
      }
    }
    i.fut.center = null;
    this.refreshTunnels(i);
    this.fixCross(i);
    this.emit({ k: 'aucEnd', tk: i.ticker, price, qty });
  }
  executeUncross(i, a) {
    const P = a.theo, Q = a.tq, buys = [], sells = [];
    let rem = Q;
    for (const o of i.moaB) { if (rem <= 0) break; const q = Math.min(o.rem, rem); buys.push([o, q]); rem -= q; }
    for (const l of i.bids) { if (rem <= 0 || l.p < P) break; for (const o of l.orders) { if (rem <= 0) break; const q = Math.min(o.rem, rem); buys.push([o, q]); rem -= q; } }
    rem = Q;
    for (const o of i.moaS) { if (rem <= 0) break; const q = Math.min(o.rem, rem); sells.push([o, q]); rem -= q; }
    for (const l of i.asks) { if (rem <= 0 || l.p > P) break; for (const o of l.orders) { if (rem <= 0) break; const q = Math.min(o.rem, rem); sells.push([o, q]); rem -= q; } }
    let own = false;
    for (const [o, q] of buys) { o.rem -= q; this.fill(o, P, q); if (o.own) own = true; }
    for (const [o, q] of sells) { o.rem -= q; this.fill(o, P, q); if (o.own) own = true; }
    // restante das MOA vira limitada ao preço do leilão
    const leftovers = i.moaB.concat(i.moaS).filter(o => o.rem > 0);
    this.compactBook(i);
    for (const o of leftovers) { this.remove(i, o); o.type = LMT; o.p = P; this.insert(i, o); }
    this.print(i, P, Q);
    this.vwReset(i, P, Q);
    this.ttPush(i, { t: this.t, p: P, q: Q, b: 'Leilão', s: 'Leilão', ag: 0, auc: true, nb: buys.length, ns: sells.length });
    if (own) this.emit({ k: 'own', tk: i.ticker });
  }
  compactBook(i) {
    for (const side of [i.bids, i.asks]) {
      for (let k = side.length - 1; k >= 0; k--) {
        const l = side[k]; let q = 0; const keep = [];
        for (const o of l.orders) { if (o.rem > 0) { keep.push(o); q += o.rem; } else this.gone(i, o); }
        l.orders = keep; l.qty = q; if (!keep.length) side.splice(k, 1);
      }
    }
    for (const o of i.moaB) if (o.rem <= 0) this.gone(i, o);
    for (const o of i.moaS) if (o.rem <= 0) this.gone(i, o);
    i.moaB = i.moaB.filter(o => o.rem > 0); i.moaS = i.moaS.filter(o => o.rem > 0);
  }
  fixCross(i) {
    let g = 0;
    while (i.bids.length && i.asks.length && i.bids[0].p >= i.asks[0].p && g++ < 60) {
      const lb = i.bids[0], la = i.asks[0], ob = lb.orders[lb.orders.length - 1], oa = la.orders[la.orders.length - 1];
      let o = ob.t >= oa.t ? ob : oa; if (o.own) o = o === ob ? oa : ob;
      this.remove(i, o); o.status = 'cancelada';
    }
  }

  /* ----------------------------- túneis ----------------------------- */
  vwAdd(i, p, q) { i.vwT.push(this.t); i.vwP.push(p); i.vwQ.push(q); i.vwPQ += p * q; i.vwSQ += q; }
  vwTrim(i) {
    const lim = this.t - CONFIG.vwapWindowSec;
    while (i.vwH < i.vwT.length && i.vwT[i.vwH] < lim) { i.vwPQ -= i.vwP[i.vwH] * i.vwQ[i.vwH]; i.vwSQ -= i.vwQ[i.vwH]; i.vwH++; }
    if (i.vwH > 4000) { i.vwT = i.vwT.slice(i.vwH); i.vwP = i.vwP.slice(i.vwH); i.vwQ = i.vwQ.slice(i.vwH); i.vwH = 0; }
    if (i.vwSQ <= 0) { i.vwSQ = 0; i.vwPQ = 0; }
  }
  vwap(i) { this.vwTrim(i); return i.vwSQ > 0 ? i.vwPQ / i.vwSQ : null; }
  vwReset(i, p, q) { i.vwT = [this.t]; i.vwP = [p]; i.vwQ = [q]; i.vwH = 0; i.vwPQ = p * q; i.vwSQ = q; }
  band(i, cT, spec, minAmp) {
    const c = cT * i.tick; let d = spec.pct != null ? c * spec.pct : spec.abs, amp = false;
    if (minAmp && d < minAmp) { d = minAmp; amp = true; }
    let hi = Math.floor((c + d) / i.tick + 1e-7), lo = Math.ceil((c - d) / i.tick - 1e-7);
    if (hi <= cT) hi = cT + 1; if (lo >= cT) lo = cT - 1; if (lo < 1) lo = 1;
    return { lo, hi, c: cT, amp };
  }
  priceBase(i) {
    const ref0 = i.isDeriv ? i.settleT : i.prevCloseT, L = i.last != null ? i.last : ref0;
    const none = i.isDeriv ? 'ajuste anterior' : 'fechamento anterior';
    switch (i.g.priceBase) {
      case 'CLAST': {
        const b = i.bb(), a = i.ba();
        if (b != null && b > L) { i.baseSrc = 'C-LAST: melhor compra'; return b; }
        if (a != null && a < L) { i.baseSrc = 'C-LAST: melhor venda'; return a; }
        i.baseSrc = i.last != null ? 'C-LAST: último preço' : 'C-LAST: ' + none; return L;
      }
      case 'MOSTRECENT':
        if (i.ref.p != null && i.ref.t > i.lastTime) { i.baseSrc = 'Most recent: preço de referência'; return i.ref.p; }
        i.baseSrc = i.last != null ? 'Most recent: último negócio' : 'Most recent: ' + none; return L;
      default:
        i.baseSrc = i.last != null ? 'LTP: último preço' : 'LTP: ' + none; return L;
    }
  }
  updateRef(i) {
    if (i.g.priceBase !== 'MOSTRECENT' || i.state !== ST.CONT || this.t - i.ref.t < CONFIG.refPriceEverySec) return;
    let p = null;
    if (i.type === 'etf') p = Math.round(i.prevCloseT * this.ibov / this.ibov0); // valor da cota pela carteira
    else { const b = i.bb(), a = i.ba(); if (b != null && a != null && a - b <= 4) p = Math.round((a + b) / 2); }
    if (p != null) i.ref = { p, t: this.t };
  }
  refreshTunnels(i) {
    if (i.state === ST.AFTER) { i.tun.rej = Object.assign({}, i.afterBand); return; }
    const frozen = i.state === ST.AUC || i.state === ST.CALL || i.state === ST.HALT || i.state === ST.CLOSED;
    if (frozen && i.tun.ult) return; // durante leilão/call os túneis ficam congelados
    if (i.isOpt) { this.optionTunnels(i); return; }
    const g = i.g, base = this.priceBase(i); i.baseT = base;
    const ma = (!i.isDeriv && g.minAmp) ? CONFIG.minAmplitudeStocks : 0;
    i.tun.rej = this.band(i, g.rejOnSettle ? i.settleT : base, g.rej, 0);
    let c = base;
    if (g.stepped) {
      const f = i.fut, hw = (g.ult.pct != null ? base * i.tick * g.ult.pct : g.ult.abs) / i.tick;
      if (f.center == null || this.t - f.t >= CONFIG.futuresCenter.everySec || Math.abs(base - f.center) >= hw * CONFIG.futuresCenter.moveFrac) { f.center = base; f.t = this.t; }
      c = f.center;
    }
    i.tun.ult = this.band(i, c, g.ult, ma);
    if (g.med) { const vw = this.vwap(i), mc = vw == null ? c : Math.round(vw); i.tun.med = this.band(i, mc, g.med, ma); i.tun.med.vw = vw; }
    else i.tun.med = null;
    i.tun.est = g.est ? this.band(i, i.prevCloseT, { pct: g.est.pct * i.staticStep }, 0) : null;
  }
  undWindow(u) {
    let mx = -Infinity, mn = Infinity;
    for (const w of u.win) { if (w[1] > mx) mx = w[1]; if (w[1] < mn) mn = w[1]; }
    const cur = (u.baseT != null ? u.baseT : u.prevCloseT) * u.tick;
    if (cur > mx) mx = cur; if (cur < mn) mn = cur;
    return { mx, mn, cur };
  }
  /* opções: túnel ASSÍNCRONO — centro = teórico (Black-Scholes) a partir do ativo-objeto;
     limites = choque de volatilidade sobre a máxima/mínima do objeto numa janela recente */
  optionTunnels(i) {
    const u = this.by[i.underlying], w = this.undWindow(u);
    const T = this.optT, r = CONFIG.option.r, K = i.strike, sig = i.iv, g = i.g;
    const theo = bsPrice(i.cp, w.cur, K, T, r, sig), cT = Math.max(1, Math.round(theo / i.tick));
    const shock = sp => {
      const sHi = w.mx * (1 + sp.spotShock), sLo = w.mn * (1 - sp.spotShock); let hi, lo;
      if (i.cp === 'C') { hi = bsPrice('C', sHi, K, T, r, sig + sp.volShock); lo = bsPrice('C', sLo, K, T, r, Math.max(0.02, sig - sp.volShock)); }
      else { hi = bsPrice('P', sLo, K, T, r, sig + sp.volShock); lo = bsPrice('P', sHi, K, T, r, Math.max(0.02, sig - sp.volShock)); }
      return { lo: Math.max(1, Math.floor(lo / i.tick + 1e-7)), hi: Math.ceil(hi / i.tick - 1e-7) };
    };
    const a = shock(g.ult), rj = shock(g.rej), m1 = CONFIG.option.minHalfTicks, m2 = CONFIG.option.rejMinHalfTicks;
    i.tun.ult = { lo: Math.max(1, Math.min(a.lo, cT - m1)), hi: Math.max(a.hi, cT + m1), c: cT, S: w.cur, sLo: w.mn, sHi: w.mx };
    i.tun.rej = { lo: Math.max(1, Math.min(rj.lo, cT - m2)), hi: Math.max(rj.hi, cT + m2), c: cT };
    i.tun.med = null; i.tun.est = null; i.baseT = cT; i.optTheo = theo;
    i.baseSrc = `teórico (Black-Scholes) com ${u.ticker} a ${fnum(w.cur, u.dec)}`;
  }
  record(i) {
    const h = i.hist, t = this.t, s = i.state;
    if (s === ST.CONT) {
      const u = i.tun.ult; h.ult.push(t, u.lo, u.hi, u.c);
      if (i.tun.med && t - i.medT >= 1) { const m = i.tun.med; h.med.push(t, m.lo, m.hi, m.c); i.medT = t; }
    } else if (s !== ST.PRE) { h.ult.push(t, NaN, NaN, NaN); h.med.push(t, NaN, NaN, NaN); i.medT = -1e9; }
    if (s === ST.CONT || s === ST.AUC || s === ST.CALL || s === ST.AFTER) {
      const r = i.tun.rej; h.rej.push(t, r.lo, r.hi, r.c);
      if (i.tun.est && s !== ST.AFTER) { const e = i.tun.est; h.est.push(t, e.lo, e.hi, e.c); } else h.est.push(t, NaN, NaN, NaN);
    } else if (s !== ST.PRE) { h.rej.push(t, NaN, NaN, NaN); h.est.push(t, NaN, NaN, NaN); }
    const sec = Math.floor(t);
    if (i.isUnderlying && sec !== i.winSec) {
      i.winSec = sec; i.win.push([t, (i.baseT != null ? i.baseT : i.prevCloseT) * i.tick]);
      const lim = t - CONFIG.option.windowSec; while (i.win.length && i.win[0][0] < lim) i.win.shift();
    }
    if (i.isOpt && s === ST.CONT && sec !== i.outSec) {
      i.outSec = sec; const u = i.tun.ult; let n = 0;
      for (const l of i.bids) if (l.p > u.hi || l.p < u.lo) n += l.orders.length;
      for (const l of i.asks) if (l.p > u.hi || l.p < u.lo) n += l.orders.length;
      if (n > 0 && i.outCount === 0 && t - i.outMsgT > 90) { i.outMsgT = t; this.feedAdd(i, 'info', `${i.ticker}: o túnel se deslocou com ${i.underlying}, sem negócio na opção (teórico ${fpr(i, u.c)}); ${n} oferta${n > 1 ? 's' : ''} antiga${n > 1 ? 's ficaram' : ' ficou'} fora do túnel de leilão`); }
      i.outCount = n;
    }
  }
  logState(i, s) { const L = i.stateLog; if (L.length && L[L.length - 1].s === s) return; L.push({ t: this.t, s }); }

  /* ----------------------------- índice e circuit breaker ----------------------------- */
  computeIbov() {
    let s = 0;
    for (const i of this.ibovList) {
      let p = i.refT();
      if (i.state === ST.CALL && i.last == null && i.auction && i.auction.theo != null) p = i.auction.theo;
      s += i.ibovWeight * p / i.prevCloseT;
    }
    this.ibov = this.ibov0 * s;
  }
  checkCB() {
    if (this.cb.active) return;
    const L = CONFIG.circuitBreaker.levels, k = this.cb.hit;
    if (k >= L.length || this.t < this.T.open || this.t >= this.T.closeCall) return;
    if (1 - this.ibov / this.ibov0 >= L[k].drop) this.cbTrigger(k);
  }
  cbTrigger(k) {
    const L = CONFIG.circuitBreaker.levels[k], t = this.t;
    this.cb = { active: true, level: k + 1, hit: k + 1, t0: t, until: t + L.haltMin * 60, drop: 1 - this.ibov / this.ibov0, byB3: !!L.byB3, haltMin: L.haltMin };
    this.stats.cb++; this.cbLog.push({ t0: t, t1: null, level: k + 1 });
    for (const i of this.insts) {
      if (i.state === ST.CONT || i.state === ST.AUC || i.state === ST.CALL) {
        if (i.auction) { const a = i.auction; a.ended = true; a.t1 = t; a.how = 'cb'; i.auction = null; }
        i.state = ST.HALT; i.escada = null; this.logState(i, 'halt');
      }
    }
    this.feedAdd(null, 'cb', `Circuit breaker nível ${k + 1}: Ibovespa ${fpct(this.ibov / this.ibov0 - 1)} sobre o fechamento anterior. Todo o mercado para por ${L.haltMin} min${L.byB3 ? ' (prazo definido pela B3; aqui, simulado)' : ''}; retorno às ${hm(this.cb.until)} via call.`);
    this.emit({ k: 'cb' });
  }
  cbReopen() {
    const t = this.t, T = this.T, rc = CONFIG.circuitBreaker.reopenCallMin * 60;
    this.cb.active = false;
    const lg = this.cbLog[this.cbLog.length - 1]; if (lg) lg.t1 = t;
    for (const i of this.insts) {
      if (i.state !== ST.HALT) continue;
      if (i.isFut) { if (t >= T.fClose) this.closeDay(i); else this.startCall(i, 'reopen', t + rc); continue; }
      const cc = i.isOpt ? T.oCloseCall : T.closeCall, cl = i.isOpt ? T.oClose : T.close;
      if (t >= cc) { i.closeCallStarted = true; this.startCall(i, 'call_close', Math.max(cl, t + rc)); }
      else this.startCall(i, 'reopen', t + rc);
    }
    this.feedAdd(null, 'cb', `Fim da parada: o mercado volta por um call de reabertura de ${CONFIG.circuitBreaker.reopenCallMin} min.`);
  }

  /* ----------------------------- feed e eventos ----------------------------- */
  feedAdd(i, type, msg, own) {
    this.feed.push({ id: ++this.feedSeq, t: this.t, tk: i ? i.ticker : 'Mercado', type, msg, own: !!own });
    if (this.feed.length > 500) this.feed.splice(0, this.feed.length - 500);
  }
  emit(ev) { if (this.silent) return; this.events.push(ev); if (this.events.length > 600) this.events.splice(0, 200); }
  phaseLabel() {
    const t = this.t, T = this.T;
    if (this.cb.active) return { k: 'cb', label: 'Circuit breaker' };
    if (t < T.fOpen) return { k: 'call', label: 'Pré-abertura (futuros)' };
    if (t < T.preOpen) return { k: 'deriv', label: 'Negociação (derivativos)' };
    if (t < T.open) return { k: 'call', label: 'Pré-abertura' };
    if (t < T.closeCall) return { k: 'cont', label: 'Negociação' };
    if (t < T.close) return { k: 'call', label: 'Call de fechamento' };
    if (this.insts.some(i => !i.isFut && i.state === ST.CALL && i.auction && i.auction.kind === 'call_close')) return { k: 'call', label: 'Call de fechamento prorrogado' };
    if (CONFIG.schedule.afterMarket.enabled && t >= T.afterStart && t < T.afterEnd) return { k: 'after', label: 'After-market' };
    if (t < T.fClose) return { k: 'closed', label: 'Encerrado (ações)' };
    return { k: 'closed', label: 'Encerrado' };
  }

  /* ----------------------------- simulação a seco (boleta) ----------------------------- */
  preview(i, s) {
    const o = { side: s.side, type: s.type, p: s.type === LMT ? s.p : null, q: s.q };
    const v = this.validate(i, o);
    if (!v.ok) return { kind: 'rej', msg: 'Rejeitada: ' + v.msg, bound: v.bound };
    if (i.state === ST.AUC || i.state === ST.CALL) {
      const a = i.auction, pr = o.type === LMT ? (o.side > 0 ? (a.theo != null && o.p >= a.theo) : (a.theo != null && o.p <= a.theo)) : true;
      return { kind: 'auc', msg: `Entra no leilão${o.type === MKT ? ' como MOA' : ''}: ${pr ? 'ficaria entre as ofertas atendidas ao preço teórico e travada (sem cancelar ou reduzir)' : 'fica fora do preço teórico atual e pode ser cancelada'}` };
    }
    if (i.state === ST.CONT && o.q > i.qtyAuction) return { kind: 'trig', msg: `Dispara leilão por quantidade: ${fq(o.q)} ${unitQ(i)} passa do limite de ${fq(i.qtyAuction)}` };
    const opp = o.side > 0 ? i.asks : i.bids, tu = i.state === ST.CONT ? { ult: i.tun.ult, med: i.tun.med, est: i.tun.est } : null;
    let rem = o.q, filled = 0, pmin = null, pmax = null, trig = null;
    for (const l of opp) {
      if (rem <= 0) break;
      if (o.type === LMT && (o.side > 0 ? l.p > o.p : l.p < o.p)) break;
      if (tu) { trig = this.checkTun(i, l.p, tu); if (trig) break; }
      const q = Math.min(rem, l.qty); rem -= q; filled += q;
      pmin = pmin == null ? l.p : Math.min(pmin, l.p); pmax = pmax == null ? l.p : Math.max(pmax, l.p);
    }
    const range = filled ? (pmin === pmax ? fpr(i, pmin) : `${fpr(i, pmin)} a ${fp(i, pmax)}`) : '';
    if (trig) {
      const where = trig.kind === 'med' ? 'da média de 60 s' : (trig.kind === 'est' ? 'do fechamento anterior' : 'do preço-base');
      return { kind: 'trig', trig, msg: `Dispara leilão: negócio a ${fpr(i, trig.p)} ficaria ${fdist(i, trig.p, trig.base)} ${trig.dir > 0 ? 'acima' : 'abaixo'} ${where}, fora do túnel (limite ${fpr(i, trig.bound)})${filled ? `. Antes disso executa ${fq(filled)} a ${range}` : ''}` };
    }
    const outside = o.type === LMT && tu && tu.ult && (o.p > tu.ult.hi || o.p < tu.ult.lo);
    const note = outside ? ` O preço fica fora do túnel de leilão: um negócio contra ela dispararia leilão.` : '';
    if (o.type === MKT) {
      if (!filled) return { kind: 'warn', msg: 'Sem contraparte: a oferta a mercado seria cancelada' };
      return { kind: 'ok', msg: `Aceita: executa ${fq(filled)} a ${range}${rem > 0 ? `; o restante (${fq(rem)}) seria cancelado` : ''}` };
    }
    if (filled && rem <= 0) return { kind: 'ok', msg: `Aceita: executa tudo a ${range}` };
    if (filled) return { kind: 'ok', msg: `Aceita: executa ${fq(filled)} a ${range}; o restante (${fq(rem)}) fica no livro a ${fpr(i, o.p)}.${note}` };
    return { kind: outside ? 'warn' : 'ok', msg: `Aceita: entra no livro a ${fpr(i, o.p)}.${note}` };
  }
}

if (typeof module !== 'undefined') module.exports = { Engine, ST, LMT, MKT, MOA, hms, DAY };
