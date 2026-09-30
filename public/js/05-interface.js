'use strict';
/* ============================================================================
   INTERFACE (parte 2): painéis, livro, boleta, feed, números, modais, cenários
   ============================================================================ */
function stateText(i) {
  const a = i.auction, n = a ? a.prorr.length : 0, pr = n ? `, prorrogado ${n}×` : '';
  switch (i.state) {
    case ST.CONT: return 'Negociando';
    case ST.AUC: return 'Em leilão' + pr;
    case ST.CALL: return (a ? TRIG_LABEL[a.kind] : 'Em call') + pr;
    case ST.HALT: return 'Parado: circuit breaker';
    case ST.PRE: return 'Aguardando abertura';
    case ST.AFTER: return 'After-market';
    default: return 'Encerrado';
  }
}
function refreshDOM(force) {
  const E = UI.E; if (!E || !UI.focus) return;
  $('clock').textContent = hms(E.t);
  const ph = E.phaseLabel(), pe = $('phase'); if (pe.dataset.k !== ph.k) pe.dataset.k = ph.k; pe.lastElementChild.textContent = ph.label;
  $('ibovVal').textContent = fnum(E.ibov, 0);
  const iv = E.ibov / E.ibov0 - 1, ive = $('ibovVar'); ive.textContent = fpct(iv, 2); ive.className = 'd ' + (iv > 5e-5 ? 'up' : iv < -5e-5 ? 'down' : 'flat');
  $('slowTag').hidden = !UI.slowActive;
  $('bSkip').disabled = E.t >= E.T.open || !!UI.ff;
  const bp = $('bPause'), lp = !!(LS.les && !LS.running); (bp.querySelector('.bl') || bp).textContent = lp ? 'Aula em pausa' : (UI.paused ? 'Continuar' : 'Pausar'); bp.disabled = lp; bp.setAttribute('aria-pressed', UI.paused ? 'true' : 'false'); bp.classList.toggle('primary', UI.paused && !lp);
  drawDaybar();
  const V = UI.vis; // só atualiza o que está perto da tela
  if (V.map || force) updateMap(); else updateMapDot();
  if (V.focus || force) { updateFocusHead(); updatePanel(force); }
  if (V.rail || force) { updateBook(); updateBoleta(); }
  if (V.trades || force) updateTrades();
  updateFeed();
  if (V.events || force) { if (UI.btab === 'numeros') updateNums(); else if (UI.btab === 'timeline') drawTimeline($('tl')); }
  updateCB();
  const lv = $('bLive'); lv.classList.toggle('primary', UI.chart.live && !UI.chart.day);
  if (LS.les) lesRefresh();
}

/* ----------------------------- mapa ----------------------------- */
const MAP_GROUPS = ['Ações Ibovespa', 'Outras ações', 'ETF', 'Derivativos'];
function buildMap() {
  const E = UI.E, wrap = $('mapGroups'), homes = {};
  wrap.innerHTML = ''; $('aucStripBody').innerHTML = '';
  for (const g of MAP_GROUPS) {
    const sec = document.createElement('div'); sec.className = 'grp';
    const n = E.insts.filter(i => i.mapGroup === g).length; // grupos lado a lado: colunas para 2 ou 3 linhas de blocos
    sec.style.setProperty('--c2', Math.max(1, Math.ceil(n / 2))); sec.style.setProperty('--c3', Math.max(1, Math.ceil(n / 3)));
    sec.innerHTML = `<h3>${g}</h3>`; const bl = document.createElement('div'); bl.className = 'blocks';
    sec.appendChild(bl); wrap.appendChild(sec); homes[g] = bl;
  }
  UI.blocks = {};
  for (const i of E.insts) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'blk';
    b.innerHTML = `<span class="tk">${i.ticker}</span><span class="px"></span><span class="vr"></span><svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="rb" cx="12" cy="12" r="9.5"/><circle class="rf" cx="12" cy="12" r="9.5" pathLength="100"/></svg><span class="badge"></span><span class="rt"></span><span class="pz"></span>`;
    b.addEventListener('click', () => { setFocus(i.ticker); showFocus(); });
    homes[i.mapGroup].appendChild(b);
    UI.blocks[i.ticker] = { el: b, px: b.querySelector('.px'), vr: b.querySelector('.vr'), rf: b.querySelector('.rf'), badge: b.querySelector('.badge'),
      rt: b.querySelector('.rt'), pz: b.querySelector('.pz'), home: homes[i.mapGroup], inStrip: false, key: '' };
  }
  UI.homes = homes;
}
function stripWanted(i) { const a = i.auction; return i.state === ST.AUC || (i.state === ST.CALL && a && (a.prorr.length > 0 || a.kind === 'reopen')); }
function updateMapDot() { const any = UI.E.insts.some(i => i.state === ST.AUC); $('dotMercado').hidden = !any; }
function updateMap() {
  const E = UI.E; let nStrip = 0, moved = false;
  for (const i of E.insts) {
    const B = UI.blocks[i.ticker], el = B.el, a = i.auction, st = i.state, inA = inAuctionLike(i);
    const cls = 'blk' + (st === ST.AUC ? ' auc' : st === ST.CALL ? ' call' : st === ST.HALT ? ' halt' : st === ST.CLOSED ? ' closed' : st === ST.PRE ? ' pre' : '')
      + (a && a.prorr.length ? ' prorr' : '') + (i === UI.focus ? ' focus' : '');
    if (el.className !== cls) el.className = cls;
    const p = dispPriceT(i), showTheo = inA && a.theo != null;
    const key = p + '|' + showTheo;
    if (B.key !== key) {
      B.key = key; B.px.innerHTML = fp(i, p) + (showTheo ? '<small>teórico</small>' : '');
      B.vr.textContent = chgText(i, p); B.vr.className = 'vr ' + chgCls(i, p);
      const ch = i.cur === '%' ? (p - i.prevCloseT) * i.tick / 0.2 : p / i.prevCloseT - 1;
      el.style.setProperty('--tint', ch >= 0 ? 'var(--up)' : 'var(--down)');
      el.style.setProperty('--tp', (Math.min(1, Math.abs(ch) / 0.04) * 24).toFixed(1) + '%');
    }
    if (inA) {
      const segStart = a.prorr.length ? a.prorr[a.prorr.length - 1].prevEnd : a.t0, rem = Math.max(0, a.plannedEnd - E.t);
      const frac = clamp(rem / Math.max(1, a.plannedEnd - segStart), 0, 1);
      B.rf.style.strokeDashoffset = (100 - frac * 100).toFixed(1); B.rt.textContent = mmss(rem);
      B.badge.textContent = '+' + a.prorr.length;
      const last = a.prorr[a.prorr.length - 1];
      el.title = `${i.ticker}: ${stateText(i)}. ${a.kind === 'auction' ? TRIG_LABEL[a.trig.kind] : TRIG_LABEL[a.kind]}.` + (last ? ` Última prorrogação: ${PRORR_LABEL[last.code]} (${last.detail}).` : '') + ` Fim previsto ${hms(a.plannedEnd)}.`;
    } else { if (B.rt.textContent) B.rt.textContent = ''; el.title = `${i.ticker}, ${i.name}: ${stateText(i)}`; }
    const want = stripWanted(i);
    if (want !== B.inStrip) { B.inStrip = want; moved = true; if (want) $('aucStripBody').appendChild(el); }
    if (want) nStrip++;
  }
  if (moved) for (const i of E.insts) { const B = UI.blocks[i.ticker]; if (!B.inStrip) B.home.appendChild(B.el); }
  $('aucStrip').classList.toggle('has', nStrip > 0); $('aucEmpty').hidden = nStrip > 0;
  $('aucCount').textContent = nStrip ? String(nStrip) : '';
  $('dotMercado').hidden = !E.insts.some(i => i.state === ST.AUC);
  if (UI.mapView === 'lista') updateMapList();
}
function updateMapList() {
  const E = UI.E; let html = '<table class="maplist"><thead><tr><th>Ativo</th><th>Último</th><th>Var.</th><th>Status</th><th>Resta</th></tr></thead><tbody>';
  const order = E.insts.slice().sort((a, b) => (stripWanted(b) - stripWanted(a)));
  for (const i of order) {
    const a = i.auction, inA = inAuctionLike(i), p = i.refT();
    const stc = i.state === ST.AUC || i.state === ST.CALL ? 'st-auc' : (i.state === ST.HALT ? 'st-halt' : '');
    html += `<tr data-tk="${i.ticker}"><td><b>${i.ticker}</b></td><td>${fp(i, p)}</td><td class="${chgCls(i, p)}">${chgText(i, p)}</td><td class="${stc}">${stateText(i)}</td><td>${inA ? mmss(a.plannedEnd - E.t) : ''}</td></tr>`;
  }
  $('mapList').innerHTML = html + '</tbody></table>';
}

/* ----------------------------- cabeçalho do ativo ----------------------------- */
function updateFocusHead() {
  const i = UI.focus, a = i.auction, inA = inAuctionLike(i), p = dispPriceT(i);
  $('fhTk').textContent = i.ticker; $('fhName').textContent = i.name;
  $('fhPx').textContent = (inA && a.theo != null ? 'teórico ' : '') + fpr(i, p);
  const v = $('fhVar'); v.textContent = chgText(i, p); v.className = 'fh-var ' + chgCls(i, p);
  const st = $('fhState'); st.className = 'chip s-' + i.state; st.textContent = stateText(i);
  const key = i.ticker + '|' + i.baseSrc + '|' + i.staticStep;
  if (key !== UI.metaKey) {
    UI.metaKey = key;
    const meta = [`Túneis: <b>${i.g.label}</b>`, `Preço-base: <b>${baseMethodName(i)}</b>`, `Tick <b>${fp(i, 1)}</b>`, `Lote <b>${fq(i.lot)}</b>`];
    if (i.isOpt) meta.push(`Ativo-objeto <b>${i.underlying}</b>, strike <b>${fnum(i.strike, 2)}</b>`);
    if (i.isFut) meta.push(`Rejeição sobre o ajuste <b>${fp(i, i.settleT)}</b>`);
    $('fhMeta').innerHTML = meta.map(m => `<span>${m}</span>`).join('');
  }
}

/* ----------------------------- painel do leilão / limites agora ----------------------------- */
function updatePanel(force) {
  const i = UI.focus, a = inAuctionLike(i) ? i.auction : null, key = a ? 'a' + a.id : 'l' + i.ticker + i.state;
  if (key !== UI.panelKey || force) { UI.panelKey = key; if (a) buildAuctionPanel(); else buildLimits(); }
  if (a) fillAuctionPanel(i, a); else fillLimits(i);
}
function buildAuctionPanel() {
  $('panelBox').innerHTML = `<div class="ap">
    <div>
      <div class="ap-why" id="apWhy"></div>
      <div class="ap-ringbox">
        <div class="ap-ring"><svg viewBox="0 0 24 24" aria-hidden="true"><circle class="rb" cx="12" cy="12" r="10.5"/><circle class="rf" id="apRing" cx="12" cy="12" r="10.5" pathLength="100"/></svg><b id="apCd"></b></div>
        <div class="ap-end" id="apEnd"></div>
      </div>
      <div class="plist" id="apHist"></div>
    </div>
    <div>
      <div class="theo-lbl">Preço teórico</div>
      <div class="theo-big" id="apTheo"></div>
      <div class="kv"><span>Quantidade teórica</span><span id="apQ"></span></div>
      <div class="imb" title="Compra × venda ao preço teórico"><i id="apImb"></i></div>
      <div class="imb-l"><span id="apD"></span><span id="apS"></span></div>
      <div class="kv"><span>Saldo não atendido</span><span id="apSaldo"></span></div>
      <div class="kv"><span>Faixa de proteção</span><span id="apProt"></span></div>
      <div class="kv"><span id="apProtRef"></span><span class="prot-st" id="apProtSt"></span></div>
    </div>
    <div>
      <div class="lights" id="apLights">
        <div class="lt" data-f="theo" title="Mudou o preço teórico"><i></i><span>1. Preço teórico</span><small></small></div>
        <div class="lt" data-f="qty" title="Mudou a quantidade teórica"><i></i><span>2. Qtd. teórica</span><small></small></div>
        <div class="lt" data-f="alloc" title="Entrou oferta nova que mudou a quantidade atendida de uma oferta anterior"><i></i><span>3. Atendimento</span><small></small></div>
        <div class="lt" data-f="imb" title="Mudou o saldo não atendido"><i></i><span>4. Saldo</span><small></small></div>
      </div>
      <div class="winbox"><canvas id="apWin"></canvas></div>
      <div class="theobox"><canvas id="apTheoC"></canvas></div>
    </div>
  </div>`;
}
function fillAuctionPanel(i, a) {
  const E = UI.E, P = UI.pal;
  let why;
  if (a.kind === 'auction') {
    const tr = a.trig;
    why = tr.kind === 'qtd' ? `Leilão por quantidade: ${fq(tr.q)} ${unitQ(i)} (limite ${fq(tr.lim)})` : `${TRIG_LABEL[tr.kind]}: ${distLbl(i, tr.p, tr.base)}`;
  } else why = `${TRIG_LABEL[a.kind]}. Proteção dos calls: ${a.protSpec.pct != null ? '±' + fnum(a.protSpec.pct * 100, 1) + '%' : '±' + fnum(a.protSpec.abs, 2) + ' p.p.'}`;
  setText('apWhy', why);
  const segStart = a.prorr.length ? a.prorr[a.prorr.length - 1].prevEnd : a.t0, rem = Math.max(0, a.plannedEnd - E.t);
  $('apRing').style.strokeDashoffset = (100 - clamp(rem / Math.max(1, a.plannedEnd - segStart), 0, 1) * 100).toFixed(1);
  setText('apCd', mmss(rem));
  setHTML('apEnd', `Fim previsto <b>${hms(a.plannedEnd)}</b><br>Prorrogações: <b>${a.prorr.length}</b>${a.protCount ? ` (${a.protCount} por proteção; a supervisão abre após ${CONFIG.prorrogation.maxProtection})` : ''}`);
  const hist = a.prorr.slice(-3).reverse().map(p => `<div><b>+1 min</b> às ${hms(p.prevEnd)}: ${PRORR_LABEL[p.code]} (${p.detail})</div>`).join('');
  setHTML('apHist', hist || 'Sem prorrogações até agora.');
  setText('apTheo', a.theo != null ? fpr(i, a.theo) : 'sem cruzamento');
  setText('apQ', fq(a.tq));
  const tot = a.D + a.S; $('apImb').style.width = (tot ? a.D / tot * 100 : 50).toFixed(1) + '%';
  setText('apD', `compra ${fqShort(a.D)}`); setText('apS', `venda ${fqShort(a.S)}`);
  setText('apSaldo', a.theo == null ? '—' : (a.imb === 0 ? 'zero' : `${fq(Math.abs(a.imb))} na ${a.imb > 0 ? 'compra' : 'venda'}`));
  setText('apProt', `${fp(i, a.prot.lo)} a ${fp(i, a.prot.hi)}`);
  setText('apProtRef', `sobre ${fp(i, a.prot.c)}`);
  const out = a.theo != null && (a.theo >= a.prot.hi || a.theo <= a.prot.lo), ps = $('apProtSt');
  const txt = a.theo == null ? '' : (out ? 'teórico fora: prorroga' : 'teórico dentro');
  if (ps.textContent !== txt) { ps.textContent = txt; ps.className = 'prot-st ' + (out ? 'out' : 'in'); }
  const now = performance.now();
  for (const el of $('apLights').children) {
    const f = el.dataset.f, on = now - (UI.lights[f] || -1e9) < 1100;
    el.classList.toggle('on', on);
    const lt = a.last[f]; el.lastElementChild.textContent = lt > -1e8 ? 'há ' + Math.max(0, Math.round(E.t - lt)) + ' s' : '';
  }
  drawWin(i, a); drawTheo(i, a);
}
function setText(id, s) { const el = $(id); if (el && el.textContent !== s) el.textContent = s; }
function setHTML(id, s) { const el = $(id); if (el && el._h !== s) { el._h = s; el.innerHTML = s; } }
function drawWin(i, a) {
  const cv = $('apWin'); if (!cv) return; const { ctx, w: W, h: H } = fitSmall(cv); const P = UI.pal, E = UI.E;
  const end = a.plannedEnd, ta = end - 72, tb = end + 3, X = t => (t - ta) / (tb - ta) * W, wins = CONFIG.prorrogation.ladder, st = a.ladder;
  const y = 15, h = 11;
  wins.forEach((s, k) => { ctx.fillStyle = rgba(P.amber, 0.1 + k * 0.08 + (k === st ? 0.22 : 0)); ctx.fillRect(X(end - s), y, X(end) - X(end - s), h); });
  if (st < wins.length) { const s = wins[st]; ctx.strokeStyle = P.amber; ctx.lineWidth = 2; ctx.strokeRect(X(end - s) + 1, y - 1, X(end) - X(end - s) - 2, h + 2); }
  ctx.font = '10px ' + FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = P.muted;
  wins.forEach(s => ctx.fillText(s + ' s', X(end - s) + 2, y + h + 2));
  for (const c of a.changes) { if (c.t < ta || c.t > tb) continue; ctx.fillStyle = P.amber; ctx.fillRect(X(c.t) - 1, y - 3, 2, h + 6); }
  const xn = X(E.t); if (xn >= 0 && xn <= W) { ctx.fillStyle = P.text; ctx.fillRect(xn - 1, y - 5, 2, h + 10); }
  ctx.fillStyle = P.text; ctx.font = '11px ' + FONT;
  ctx.fillText(st < wins.length ? `Decide a ${st + 1}ª prorrogação: alteração nos últimos ${wins[st]} s` : 'Escada esgotada: só a proteção prorroga', 0, 0);
}
function drawTheo(i, a) {
  const cv = $('apTheoC'); if (!cv) return; const { ctx, w: W, h: H } = fitSmall(cv); const P = UI.pal, E = UI.E;
  const t0 = a.t0, t1 = Math.max(E.t, t0 + 20), pw = W - 52, X = t => 2 + (t - t0) / (t1 - t0) * pw;
  let mn = a.prot.lo, mx = a.prot.hi; const V = a.theoS.v[0]; for (let k = 0; k < V.length; k++) { const v = V[k]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
  const pad = (mx - mn) * 0.12 + 1; mn -= pad; mx += pad; const Y = v => 3 + (1 - (v - mn) / (mx - mn)) * (H - 6);
  ctx.fillStyle = rgba(P.cyan, 0.16); ctx.fillRect(2, Y(a.prot.hi), pw, Y(a.prot.lo) - Y(a.prot.hi));
  ctx.strokeStyle = P.amber; ctx.lineWidth = 1.5; lineB(ctx, buckets(a.theoS, 0, t0, t1, E.t, X, 2, Math.max(1, Math.floor(pw))), 2, Y, 1);
  ctx.font = '10px ' + FONT; ctx.fillStyle = P.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('teórico', pw + 8, 8); ctx.fillStyle = P.cyan; ctx.fillText('proteção', pw + 8, H - 8);
}
function buildLimits() {
  $('panelBox').innerHTML = `<table class="lim"><thead><tr><th>Túnel</th><th>Preço-base usado</th><th>Inferior</th><th>Superior</th></tr></thead><tbody id="limBody"></tbody></table><div class="lim-note" id="limNote"></div>`;
}
function shortSrc(s) {
  return String(s || '').replace('C-LAST: último preço', 'C-LAST, último').replace('C-LAST: melhor compra', 'C-LAST, melhor compra').replace('C-LAST: melhor venda', 'C-LAST, melhor venda')
    .replace('LTP: último preço', 'LTP').replace('Most recent: preço de referência', 'most recent, referência').replace('Most recent: último negócio', 'most recent, negócio')
    .replace(/^(C-LAST|LTP|Most recent): (fechamento anterior|ajuste anterior)$/, '$2');
}
function fillLimits(i) {
  const t = i.tun, P = UI.pal, E = UI.E; if (!t.ult || !t.rej) return;
  const rows = [], g = i.g;
  const cell = (v, c) => v == null ? '—' : `${fp(i, v)} <small>${distLbl(i, v, c)}</small>`;
  const row = (col, dash, name, typ, base, src, lo, hi, c) => rows.push(`<tr title="${typ}"><td><span class="sw" style="border-color:${col};border-top-style:${dash}"></span>${name}</td><td>${base} <small>${src}</small></td><td>${cell(lo, c)}</td><td>${cell(hi, c)}</td></tr>`);
  if (i.state === ST.AFTER) {
    row(P.rasp, 'solid', 'After-market ±2%', 'estático no after', fp(i, i.afterBand.c), 'fechamento', i.afterBand.lo, i.afterBand.hi, i.afterBand.c);
  } else {
    row(P.rasp, 'solid', 'Rejeição (preço)', g.rejOnSettle ? 'estático no dia, sobre o ajuste' : (i.isOpt ? 'dinâmico assíncrono' : 'dinâmico síncrono'),
      fp(i, t.rej.c), g.rejOnSettle ? 'ajuste' : (i.isOpt ? 'teórico, choque alto' : shortSrc(i.baseSrc)), t.rej.lo, t.rej.hi, t.rej.c);
    row(P.amber, 'solid', 'Leilão: último preço', i.isOpt ? 'dinâmico assíncrono' : (g.stepped ? 'dinâmico síncrono, em degraus' : 'dinâmico síncrono'),
      fp(i, t.ult.c), i.isOpt ? 'teórico, choque moderado' : (g.stepped ? 'centro em degraus' : shortSrc(i.baseSrc)), t.ult.lo, t.ult.hi, t.ult.c);
    if (t.med) row(P.violet, 'dashed', 'Leilão: preço médio', 'dinâmico síncrono', fp(i, t.med.c), `média ${CONFIG.vwapWindowSec} s`, t.med.lo, t.med.hi, t.med.c);
    if (t.est) row(P.gray, 'dotted', `Estático ±${fnum(g.est.pct * i.staticStep * 100, 0)}%`, 'estático', fp(i, i.prevCloseT), 'fech. anterior', t.est.lo, t.est.hi, t.est.c);
    const ref = i.refT(), pa = E.protBand(i, ref, g.protAuction), pc = E.protBand(i, ref, g.protCall);
    row(P.cyan, 'solid', 'Proteção (leilões)', 'age no fim do leilão; limite já prorroga', fp(i, ref), 'último negócio', pa.lo, pa.hi, ref);
    row(P.cyan, 'dashed', 'Proteção (calls)', 'abertura e fechamento', fp(i, ref), 'último negócio', pc.lo, pc.hi, ref);
  }
  rows.push(`<tr><td><span class="sw" style="border-color:${P.text}"></span>Quantidade por oferta</td><td><small>${unitQ(i)}</small></td><td><small>leilão acima de</small> ${fq(i.qtyAuction)}</td><td><small>rejeita acima de</small> ${fq(i.qtyReject)}</td></tr>`);
  const html = rows.join('');
  if ($('limBody') && $('limBody')._h !== html) { $('limBody')._h = html; $('limBody').innerHTML = html; }
  let note = '';
  if (i.state === ST.PRE) note = 'Fora do horário: os limites estão calculados sobre o fechamento anterior. ';
  if (t.ult.amp && !i.isDeriv) { const b = t.ult.c * i.tick; note += `<b>Amplitude mínima aplicada.</b> ${fnum(g.ult.pct * 100, 1)}% de ${fpr(i, t.ult.c)} daria só R$ ${fnum(b * g.ult.pct, 2)} por lado; em ações vale no mínimo R$ ${fnum(CONFIG.minAmplitudeStocks, 2)}. `; }
  if (i.isOpt && t.ult.sHi != null) { const u = E.by[i.underlying]; note += `Túnel assíncrono: o centro é o teórico Black-Scholes da opção; os limites saem de um choque de volatilidade sobre a máxima (${fnum(t.ult.sHi, u.dec)}) e a mínima (${fnum(t.ult.sLo, u.dec)}) de ${i.underlying} nos últimos ${CONFIG.option.windowSec} s. Quando ${i.underlying} salta, o túnel se desloca mesmo sem negócio na opção. `; }
  if (g.stepped) note += `Futuros: o centro do túnel de leilão anda em degraus (a cada ${CONFIG.futuresCenter.everySec} s ou quando o preço percorre metade da meia-largura); último degrau às ${hms(i.fut.t)}. A rejeição usa o preço de ajuste. `;
  if (g.priceBase === 'CLAST') note += 'C-LAST: vale o último preço se estiver entre a melhor compra e a melhor venda; se a melhor compra estiver acima dele, vale ela; se a melhor venda estiver abaixo, vale ela. ';
  if (g.priceBase === 'MOSTRECENT' && !g.stepped) note += `Most recent: vale o que foi atualizado por último entre o último negócio e o valor da carteira, recalculado a cada ${CONFIG.refPriceEverySec} s. `;
  setHTML('limNote', note);
}

/* ----------------------------- livro ----------------------------- */
/* negócios recentes do ativo em foco (lado passivo, preço, quantidade), guardados por HIT_MS. No livro, o preço
   onde saiu negócio ganha um realce que se apaga aos poucos e a quantidade negociada (−qtd); se o preço zerou,
   a linha fica no lugar, riscada, até sumir. */
const HIT_MS = 1300;
function pollMatchFlash(i) {
  const now = performance.now();
  if (UI.bookTtTicker !== i.ticker) { UI.bookTtTicker = i.ticker; UI.bookTtSeen = i.tt.length; UI.matchFlash = []; return; }
  if (UI.bookTtSeen > i.tt.length) UI.bookTtSeen = i.tt.length; // a fita foi podada (ttPush corta o início de tempos em tempos)
  let novos = i.tt.slice(UI.bookTtSeen); UI.bookTtSeen = i.tt.length;
  if (novos.length > 8) novos = novos.slice(-8); // rajada grande (turbo ou "pular para 10:00"): só os mais recentes contam
  for (const x of novos) if (!x.auc) UI.matchFlash.push({ side: x.ag > 0 ? -1 : 1, p: x.p, q: x.q, until: now + HIT_MS });
  if (UI.matchFlash.length) UI.matchFlash = UI.matchFlash.filter(f => f.until > now);
}
function bookHits() {
  const now = performance.now(), hits = new Map();
  for (const f of UI.matchFlash) {
    const k = f.side + '|' + f.p, h = hits.get(k), v = Math.max(0, (f.until - now) / HIT_MS);
    if (h) { h.q += f.q; h.v = Math.max(h.v, v); } else hits.set(k, { side: f.side, p: f.p, q: f.q, v });
  }
  return hits;
}
function updateBook() {
  const i = UI.focus, a = i.auction, inA = inAuctionLike(i), t = i.tun, L = 10, U = unitQ(i);
  pollMatchFlash(i);
  const hits = inA ? new Map() : bookHits();
  const theo = inA ? a.theo : null, ult = i.state === ST.CONT ? t.ult : null, bestA = i.ba(), bestB = i.bb();
  // cada lado: os L melhores preços, mais os preços que acabaram de zerar (ficam no lugar até o realce apagar,
  // a não ser que o outro lado já ocupe aquele preço: aí o livro pareceria cruzado)
  const sideRows = (levels, side) => {
    const rows = levels.slice(0, L).map(l => ({ p: l.p, l }));
    for (const h of hits.values()) {
      if (h.side !== side || levels.some(l => l.p === h.p)) continue;
      if (side > 0 ? (bestA != null && h.p >= bestA) : (bestB != null && h.p <= bestB)) continue;
      rows.push({ p: h.p, gone: h });
    }
    rows.sort((x, y) => side > 0 ? y.p - x.p : x.p - y.p);
    return rows.slice(0, L);
  };
  const askRows = sideRows(i.asks, -1), bidRows = sideRows(i.bids, 1);
  const N = Math.max(5, askRows.length, bidRows.length); // mesmo número de linhas nos dois lados: o meio não pula
  let maxQ = 1, askTot = 0, bidTot = 0;
  for (const r of askRows) if (r.l) { maxQ = Math.max(maxQ, r.l.qty); askTot += r.l.qty; }
  for (const r of bidRows) if (r.l) { maxQ = Math.max(maxQ, r.l.qty); bidTot += r.l.qty; }
  const rowHTML = (l, side) => {
    let top = '', tq = 0, own = false; const m = {};
    for (const o of l.orders) { const k = o.own ? 'Você' : o.br; m[k] = (m[k] || 0) + o.rem; if (m[k] > tq) { tq = m[k]; top = k; } if (o.own) own = true; }
    const exe = theo != null && (side > 0 ? l.p >= theo : l.p <= theo), out = ult && (l.p > ult.hi || l.p < ult.lo);
    const best = l.p === (side > 0 ? bestB : bestA), h = hits.get(side + '|' + l.p);
    const nome = side > 0 ? 'compra' : 'venda', n = l.orders.length;
    const tip = `${n} ${n === 1 ? 'oferta' : 'ofertas'} de ${nome} a ${fp(i, l.p)}: ${fq(l.qty)} ${U}. Maior: ${top} (${fq(tq)}).` +
      (h ? ` Acabaram de ser negociadas ${fq(h.q)} ${U} neste preço.` : '') + ` Toque para ${side > 0 ? 'vender para' : 'comprar de'} quem está aqui.`;
    return `<div class="br ${side > 0 ? 'b' : 'a'} lv${exe ? ' exe' : ''}${own ? ' own' : ''}${out ? ' out' : ''}${best ? ' best' : ''}${h ? ' hit' : ''}" data-p="${l.p}" data-s="${side}" title="${tip}" style="--d:${(l.qty / maxQ * 100).toFixed(0)}%${h ? ';--hit:' + h.v.toFixed(2) : ''}">` +
      `<span class="bk">${exe ? '<span class="lock" title="Não pode ser cancelada nem reduzida">' + LOCK + '</span>' : ''}${h ? `<span class="tq">−${fq(h.q)}</span>` : ''}${own ? 'Você' : top}</span><span>${n}</span><span>${fq(l.qty)}</span><span class="bp">${fp(i, l.p)}</span></div>`;
  };
  const goneHTML = (g, side) => `<div class="br ${side > 0 ? 'b' : 'a'} gone" style="--hit:${g.v.toFixed(2)}" title="Preço zerado: ${fq(g.q)} ${U} negociadas a ${fp(i, g.p)}, e as ofertas desse preço fecharam.">` +
    `<span class="bk"><span class="tq">−${fq(g.q)}</span>fechou</span><span>0</span><span>0</span><span class="bp">${fp(i, g.p)}</span></div>`;
  const slotHTML = (r, side) => !r ? '<div class="br empty"></div>' : (r.gone ? goneHTML(r.gone, side) : rowHTML(r.l, side));
  const moaRow = (arr, side) => { const q = arr.reduce((s, o) => s + o.rem, 0); return `<div class="br ${side > 0 ? 'b' : 'a'} exe" style="--d:${Math.min(100, q / maxQ * 100).toFixed(0)}%"><span class="bk"><span class="lock">${LOCK}</span>a mercado (MOA)</span><span>${arr.length}</span><span>${fq(q)}</span><span class="bp">MOA</span></div>`; };
  const items = [];
  if (inA && i.moaS.length) items.push({ html: moaRow(i.moaS, -1) });
  for (let k = N - 1; k >= 0; k--) { const r = askRows[k]; items.push({ p: r ? r.p : null, html: slotHTML(r, -1) }); }
  items.push({ mid: true });
  for (let k = 0; k < N; k++) { const r = bidRows[k]; items.push({ p: r ? r.p : null, html: slotHTML(r, 1) }); }
  if (inA && i.moaB.length) items.push({ html: moaRow(i.moaB, 1) });
  let mid;
  if (inA) mid = theo != null ? `<div class="bmk theo">teórico ${fp(i, theo)}, ${fq(a.tq)} ${U}</div>` : `<div class="spread">sem preço teórico: compras e vendas ainda não cruzam</div>`;
  else {
    const lt = i.tt.length ? i.tt[i.tt.length - 1] : null, dir = lt ? (lt.ag > 0 ? 'up' : (lt.ag < 0 ? 'down' : 'flat')) : 'flat';
    const spr = bestB != null && bestA != null ? 'spread ' + fp(i, bestA - bestB) : (bestB == null && bestA == null ? 'livro vazio' : 'um dos lados está vazio');
    const ltTip = lt ? `Último negócio: ${fq(lt.q)} ${U} a ${fp(i, lt.p)}` + (lt.ag > 0 ? ', comprador agressor (pagou o preço de quem vendia).' : (lt.ag < 0 ? ', vendedor agressor (aceitou o preço de quem comprava).' : '.')) : '';
    const tot = askTot + bidTot, pb = tot ? Math.round(bidTot / tot * 100) : 50;
    mid = `<div class="bk-mid"><div class="bk-mid-r"><span title="Distância entre a melhor venda e a melhor compra">${spr}</span>` +
      (lt ? `<span class="bk-last ${dir}" title="${ltTip}">último ${fp(i, lt.p)} ${lt.ag > 0 ? '▲' : (lt.ag < 0 ? '▼' : '')}</span>` : '<span class="bk-last flat">sem negócios</span>') + '</div>' +
      `<div class="bk-press" title="Quantidade nos preços mostrados: compra ${fq(bidTot)}, venda ${fq(askTot)}"><i style="width:${pb}%"></i></div></div>`;
  }
  const marks = [];
  if (ult) { marks.push({ v: ult.hi, up: true, cls: 'amb', txt: `túnel de leilão ${fp(i, ult.hi)}` }); marks.push({ v: ult.lo, up: false, cls: 'amb', txt: `túnel de leilão ${fp(i, ult.lo)}` }); }
  if (t.rej && (i.state === ST.CONT || i.state === ST.AFTER)) { const nm = i.state === ST.AFTER ? 'limite do after' : 'túnel de rejeição'; marks.push({ v: t.rej.hi, up: true, cls: 'rsp', txt: `${nm} ${fp(i, t.rej.hi)}` }); marks.push({ v: t.rej.lo, up: false, cls: 'rsp', txt: `${nm} ${fp(i, t.rej.lo)}` }); }
  const pos = marks.map(mk => { let k = items.findIndex(it => it.p != null && (mk.up ? it.p <= mk.v : it.p < mk.v)); return k < 0 ? items.length : k; });
  // os rótulos dos lados ficam por fora da lista: limites além dos preços mostrados aparecem logo depois deles, com ▲/▼
  let html = `<div class="bk-side a" title="Quem quer vender. O preço mais perto do meio é o mais barato: é por ele que dá para comprar agora."><span>Vendas</span><small>${fq(askTot)} ${U}</small></div>`;
  for (let k = 0; k <= items.length; k++) {
    marks.forEach((mk, j) => { if (pos[j] === k) html += `<div class="bmk ${mk.cls}">${k === 0 ? '▲ ' : (k === items.length ? '▼ ' : '')}${mk.txt}</div>`; });
    if (k < items.length) html += items[k].mid ? mid : items[k].html;
  }
  html += `<div class="bk-side b" title="Quem quer comprar. O preço mais perto do meio é o mais alto: é por ele que dá para vender agora."><span>Compras</span><small>${fq(bidTot)} ${U}</small></div>`;
  if (!askRows.length && !bidRows.length && !(inA && (i.moaB.length || i.moaS.length))) html =`<div class="bk-empty">${i.state === ST.PRE ? 'O livro abre na pré-abertura.' : (i.state === ST.CLOSED ? 'Livro encerrado: as ofertas do dia expiraram.' : 'Livro vazio.')}</div>`;
  const bb = $('bookBody'); if (bb._h !== html) { bb._h = html; bb.innerHTML = html; }
  const crossed = inA && i.bb() != null && i.ba() != null && i.bb() >= i.ba();
  setText('bookNote', inA ? (crossed ? 'Livro cruzado: em leilão' : 'Em leilão') : (i.state === ST.AFTER ? 'After-market' : (i.state === ST.HALT ? 'Parado' : '')));
}
function brShort(b) { return String(b).replace('Corretora ', ''); }
function updateTrades() {
  const i = UI.focus, tt = i.tt, last = tt.length ? tt[tt.length - 1] : null;
  const key = i.ticker + tt.length + (last ? last.t + '|' + last.q : '');
  if (key === UI.ttKey) return; UI.ttKey = key;
  let html = ''; const n = Math.min(tt.length, UI.mobile ? 15 : 18);
  for (let k = tt.length - 1; k >= tt.length - n; k--) {
    const x = tt[k];
    if (x.auc) html += `<div class="tr auc"><span class="t">${hms(x.t)}</span><span>${fp(i, x.p)}</span><span>${fq(x.q)}</span><span>Leilão: preço único (${x.nb} compras, ${x.ns} vendas)</span></div>`;
    else html += `<div class="tr"><span class="t">${hms(x.t)}</span><span class="${x.ag > 0 ? 'up' : 'down'}">${fp(i, x.p)}</span><span>${fq(x.q)}</span><span>${brShort(x.b)}</span><span>${brShort(x.s)}</span><span class="${x.ag > 0 ? 'up' : 'down'}">${x.ag > 0 ? 'C' : 'V'}</span></div>`;
  }
  $('ttBody').innerHTML = html || '<div class="bk-empty">Sem negócios ainda.</div>';
}

/* ----------------------------- boleta ----------------------------- */
function parsePrice(i, s) {
  s = String(s || '').trim().replace(/R\$|\s|%|pts/gi, ''); if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (i.tick >= 1) s = s.replace(/\./g, '');
  const v = parseFloat(s); if (!isFinite(v) || v <= 0) return null;
  return Math.max(1, Math.round(v / i.tick + 1e-9));
}
function parseQty(s) { const v = parseInt(String(s || '').replace(/\D/g, ''), 10); return isFinite(v) && v > 0 ? v : null; }
function defaultQty(i) { return Math.max(i.lot, Math.round(i.tradeSize / i.lot) * i.lot); }
function setBolDefaults() {
  const i = UI.focus; $('bolP').value = fp(i, dispPriceT(i)); $('bolQ').value = fq(defaultQty(i)); UI.bol.qtyMode = 0;
  if (UI.bol.type === MOA && !inAuctionLike(i)) setBolType(LMT);
}
function setBolType(tp) { UI.bol.type = tp; for (const b of $('bolType').children) b.classList.toggle('on', +b.dataset.t === tp); }
function setBolSide(s) { UI.bol.side = s; for (const b of $('bolSide').children) b.classList.toggle('on', +b.dataset.s === s); }
/* toque numa oferta do livro: a boleta passa a negociar com ela (oferta de venda → você compra; de compra → você vende) */
function bookPick(p, side) {
  const i = UI.focus;
  setBolSide(side > 0 ? -1 : 1); setBolType(LMT);
  $('bolP').value = fp(i, p);
  updateBoleta();
  const f = $('bolP'); f.classList.remove('pick'); void f.offsetWidth; f.classList.add('pick');
  const r = f.getBoundingClientRect();
  if (r.top < barBottom() || r.bottom > window.innerHeight) f.scrollIntoView({ block: 'center', behavior: UI.reduced ? 'auto' : 'smooth' });
}
function updateBoleta() {
  const i = UI.focus, E = UI.E, inA = inAuctionLike(i), tb = $('bolType').children;
  setText('bolTk', i.ticker);
  tb[2].disabled = !inA; tb[1].disabled = i.state === ST.AFTER;
  if (!inA && UI.bol.type === MOA) setBolType(LMT);
  if (i.state === ST.AFTER && UI.bol.type === MKT) setBolType(LMT);
  $('bolP').disabled = UI.bol.type !== LMT;
  const pT = UI.bol.type === LMT ? parsePrice(i, $('bolP').value) : null, q = parseQty($('bolQ').value);
  UI.bol.pT = pT;
  let r;
  if (UI.bol.type === LMT && pT == null) r = { kind: '', msg: 'Digite um preço válido.' };
  else if (!q) r = { kind: '', msg: 'Digite uma quantidade.' };
  else r = E.preview(i, { side: UI.bol.side, type: UI.bol.type, p: pT, q });
  const pv = $('bolPv'), cls = 'pv ' + (r.kind || '');
  if (pv.className !== cls) pv.className = cls; if (pv.textContent !== r.msg) pv.textContent = r.msg;
  const s = $('bolSend'); s.textContent = UI.bol.side > 0 ? 'Enviar compra' : 'Enviar venda'; s.className = 'send' + (UI.bol.side > 0 ? '' : ' sell');
  renderOwn();
}
function renderOwn() {
  const E = UI.E, list = UI.own.slice(-6).reverse();
  if (!list.length) { $('myo').hidden = true; return; }
  $('myo').hidden = false;
  let html = '';
  for (const r of list) {
    const i = E.by[r.tk], o = r.o, open = i.orders.get(o.id) === o, locked = open && i.auction && E.isLocked(i, o);
    const desc = `${o.side > 0 ? 'Compra' : 'Venda'} ${fq(o.q)} ${o.type === LMT ? 'a ' + fp(i, o.p) : (o.type === MOA ? 'MOA' : 'a mercado')}, ${r.tk}`;
    const done = o.filled ? ` (${fq(o.filled)} a ${fnum(o.avg * i.tick, i.dec)})` : '';
    const st = open ? (o.filled ? `no livro, ${fq(o.filled)} já executadas` : 'no livro') : (o.status + done);
    html += `<div class="mo"><div><div>${desc}</div><div class="st">${locked ? `<span class="lk">${LOCK} travada: preço igual ou melhor que o teórico</span>` : st}</div></div><div class="acts">${open ? `<button data-a="cx" data-id="${o.id}" data-tk="${r.tk}">Cancelar</button>${o.type === LMT ? `<button data-a="imp" data-id="${o.id}" data-tk="${r.tk}">Melhorar</button>` : ''}<button data-a="add" data-id="${o.id}" data-tk="${r.tk}">+ Qtd</button>` : ''}</div></div>`;
  }
  if (html !== UI.ownKey) { UI.ownKey = html; $('myoList').innerHTML = html; }
}
function sendOrder() {
  const i = UI.focus, E = UI.E, pT = UI.bol.type === LMT ? parsePrice(i, $('bolP').value) : null, q = parseQty($('bolQ').value);
  if ((UI.bol.type === LMT && pT == null) || !q) { showToast('Preencha preço e quantidade.'); return; }
  const res = E.submit(i, { side: UI.bol.side, type: UI.bol.type, p: pT, q, br: 'Você', own: true, tag: 'sua' });
  UI.own.push({ tk: i.ticker, o: res.o }); if (UI.own.length > 40) UI.own.shift();
  const msgs = { rej: 'Rejeitada: ' + (res.v ? res.v.msg : ''), trig: 'Sua oferta disparou leilão.', auc: 'Entrou no leilão.', trade: 'Executada (total ou parcialmente).', book: 'Entrou no livro.' };
  setText('myoMsg', msgs[res.out] || 'Enviada.');
  UI.ownKey = ''; refreshDOM(true);
}
function ownAction(act, tk, id) {
  const E = UI.E, i = E.by[tk], o = i.orders.get(id); let res;
  if (act === 'cx') res = E.cancel(i, id, true);
  else if (o) {
    if (act === 'imp') res = E.modifyOwn(i, id, o.p + o.side, null);
    else res = E.modifyOwn(i, id, null, o.rem + Math.max(i.lot, Math.round(defaultQty(i) / i.lot) * i.lot));
    if (res && res.o && res.ok) { const r = UI.own.find(x => x.o === o); if (r) r.o = res.o; }
  }
  if (!res) return;
  if (!res.ok) { setText('myoMsg', res.msg); if (res.locked) showToast(res.msg, 6000); }
  else setText('myoMsg', act === 'cx' ? 'Oferta cancelada.' : 'Oferta alterada (perdeu a prioridade de tempo).');
  UI.ownKey = ''; refreshDOM(true);
}
function bolShortcut(k) {
  const i = UI.focus, E = UI.E, t = i.tun, s = UI.bol.side, inA = inAuctionLike(i);
  if (k === 'lim' || k === 'tick') {
    setBolType(LMT);
    let lim, name;
    if (inA) { lim = s > 0 ? i.auction.prot.hi : i.auction.prot.lo; name = 'faixa de proteção'; }
    else if (i.state === ST.AFTER) { lim = s > 0 ? i.afterBand.hi : i.afterBand.lo; name = 'limite do after'; }
    else { lim = s > 0 ? t.ult.hi : t.ult.lo; name = 'túnel de leilão'; }
    const p = k === 'lim' ? lim : Math.max(1, lim + s);
    $('bolP').value = fp(i, p);
    if (k === 'tick' && i.state === ST.CONT) { const d = E.depthTo(i, s, p); $('bolQ').value = fq(Math.min(i.qtyAuction - i.lot, Math.max(defaultQty(i), Math.round(d * 1.1 / i.lot) * i.lot + i.lot))); }
    if (inA || i.state === ST.AFTER) showToast(`${inA ? 'Durante o leilão' : 'No after-market'}, o limite relevante aqui é a ${name}.`);
  } else if (k === 'typo') {
    setBolType(LMT); const L = i.refT(); $('bolP').value = fp(i, s > 0 ? L * 10 : Math.max(1, Math.round(L / 10)));
  } else if (k === 'qty') {
    UI.bol.qtyMode = (UI.bol.qtyMode + 1) % 2;
    const q = UI.bol.qtyMode === 1 ? Math.min(i.qtyReject - i.lot, Math.round(i.qtyAuction * 1.3 / i.lot) * i.lot) : Math.round(i.qtyReject * 1.5 / i.lot) * i.lot;
    $('bolQ').value = fq(q);
    if (UI.bol.type === LMT && parsePrice(i, $('bolP').value) == null) $('bolP').value = fp(i, i.refT());
    showToast(UI.bol.qtyMode === 1 ? `Acima de ${fq(i.qtyAuction)} ${unitQ(i)}: leilão por quantidade. Toque de novo para passar do limite de rejeição.` : `Acima de ${fq(i.qtyReject)} ${unitQ(i)}: rejeitada na entrada.`);
  }
  updateBoleta();
}

/* ----------------------------- feed ----------------------------- */
const FEED_FILTERS = [['todos', 'Todos'], ['rej', 'Rejeições'], ['auc', 'Leilões'], ['prorr', 'Prorrogações'], ['open', 'Aberturas'], ['mkt', 'Mercado']];
function feedPass(type) { const f = UI.feedFilter; if (f === 'todos') return true; if (f === 'mkt') return ['call', 'sup', 'cb', 'info'].includes(type); return f === type; }
function updateFeed() {
  const E = UI.E, box = $('feed'), items = E.feed;
  if (!items.length) { if (!box.children.length) box.innerHTML = '<div class="feed-empty">Os eventos do pregão aparecem aqui: rejeições, leilões, prorrogações e aberturas.</div>'; return; }
  let s = items.length; while (s > 0 && items[s - 1].id > UI.lastFeedId) s--;
  if (s === items.length) return;
  const empty = box.querySelector('.feed-empty'); if (empty) empty.remove();
  const frag = document.createDocumentFragment();
  for (let k = items.length - 1; k >= s; k--) frag.appendChild(feedEl(items[k]));
  box.insertBefore(frag, box.firstChild);
  UI.lastFeedId = items[items.length - 1].id;
  while (box.children.length > 500) box.removeChild(box.lastChild);
}
function feedEl(f) {
  const d = document.createElement('div'); d.className = 'fi ' + f.type + (f.own ? ' own' : ''); d.dataset.type = f.type;
  d.innerHTML = `<span class="ft">${hms(f.t)}</span><span class="fk"></span><i class="fc"></i><span class="fm"></span>`;
  d.children[1].textContent = f.tk; d.children[3].textContent = f.msg;
  d.hidden = !feedPass(f.type);
  d.addEventListener('click', () => onFeedClick(f));
  return d;
}
function applyFeedFilter() { for (const d of $('feed').children) if (d.dataset.type) d.hidden = !feedPass(d.dataset.type); for (const b of $('ffil').children) b.classList.toggle('on', b.dataset.v === UI.feedFilter); }
function onFeedClick(f) {
  const E = UI.E; if (!E.by[f.tk]) return;
  if (UI.focus.ticker !== f.tk) setFocus(f.tk);
  goToTime(f.t);
  showFocus();
}
function goToTime(t) { const ch = UI.chart; ch.day = false; setZoomButtons(); ch.live = false; ch.viewEnd = Math.min(UI.E.t + ch.zoom * 0.3, t + ch.zoom * 0.35); ch.ymin = NaN; }

/* ----------------------------- números do dia ----------------------------- */
function numsHTML() {
  const E = UI.E, s = E.stats;
  const rej = s.rejPreco + s.rejQtd + s.rejOutros, auc = s.auc.ult + s.auc.med + s.auc.est + s.auc.qtd;
  const pr = Object.values(s.prorr).reduce((a, b) => a + b, 0);
  const dur = s.durations.length ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length : 0;
  const top = E.insts.filter(i => i.st.auctions > 0).sort((a, b) => b.st.auctions - a.st.auctions || b.st.prorr - a.st.prorr).slice(0, 4);
  const bars = (rows, col) => { const mx = Math.max(1, ...rows.map(r => r[1])); return '<div class="bars">' + rows.map(([k, v]) => `<div class="r"><b>${k}</b><span>${v}</span><div class="bw"><i style="width:${(v / mx * 100).toFixed(0)}%;${col ? 'background:' + col : ''}"></i></div></div>`).join('') + '</div>'; };
  return `
  <div class="card"><h4>Rejeições</h4><div class="big">${rej}</div>${bars([['por preço', s.rejPreco], ['por quantidade', s.rejQtd], ['outras (horário, lote, MOA)', s.rejOutros]], 'var(--rasp)')}</div>
  <div class="card"><h4>Leilões intradiários</h4><div class="big">${auc}</div>${bars([['último preço', s.auc.ult], ['preço médio', s.auc.med], ['estático', s.auc.est], ['quantidade', s.auc.qtd]])}</div>
  <div class="card"><h4>Prorrogações por motivo</h4><div class="big">${pr}</div>${bars([['proteção de preço', s.prorr.prot_preco], ['proteção por quantidade', s.prorr.prot_qtd], ['alteração, último minuto', s.prorr.alt60], ['alteração, últimos 30 s', s.prorr.alt30], ['alteração, últimos 15 s', s.prorr.alt15], ['sem preço teórico', s.prorr.sem_teorico]])}</div>
  <div class="card"><h4>Duração média dos leilões</h4><div class="big">${s.durations.length ? mmss(dur) : '—'}</div><div class="bars"><div class="r"><b>leilões encerrados</b><span>${s.durations.length}</span></div><div class="r"><b>abertas pela supervisão</b><span>${s.sup}</span></div><div class="r"><b>calls de abertura / fechamento</b><span>${s.calls.call_open} / ${s.calls.call_close}</span></div><div class="r"><b>circuit breakers</b><span>${s.cb}</span></div></div></div>
  <div class="card"><h4>Ativo com mais leilões</h4><div class="big">${top.length ? top[0].ticker : '—'}</div>${top.length ? bars(top.map(i => [i.ticker + (i.st.prorr ? `, ${i.st.prorr} prorr.` : ''), i.st.auctions])) : '<div class="bars"><div class="r"><b>nenhum leilão intradiário ainda</b></div></div>'}</div>`;
}
function updateNums() { setHTML('nums', numsHTML()); }

/* ----------------------------- circuit breaker ----------------------------- */
function updateCB() {
  const E = UI.E, cb = E.cb;
  if (!cb.active) { $('cbOver').hidden = true; $('cbMini').hidden = true; return; }
  const rem = cb.until - E.t, cd = rem >= 3600 ? hms(rem) : mmss(rem);
  setText('cbTitle', `Circuit breaker nível ${cb.level}`);
  setText('cbWhy', `Ibovespa ${fpct(-cb.drop, 1)} sobre o fechamento anterior. Todo o mercado está parado: ações e derivativos.`);
  setText('cbCd', cd);
  setText('cbNext', `Retomada às ${hm(cb.until)} por um call de reabertura de ${CONFIG.circuitBreaker.reopenCallMin} min${cb.byB3 ? '. Prazo definido pela B3 (aqui, simulado)' : ''}.`);
  setText('cbLevels', 'Regra: queda de 10% para por 30 min; ao voltar, se chegar a −15%, para por 1 h; a −20%, a parada tem prazo definido pela B3.');
  setText('cbMini', `Circuit breaker: retomada em ${cd}`);
  $('cbOver').hidden = UI.cbMin || !!UI.ff; $('cbMini').hidden = !UI.cbMin;
}

/* ----------------------------- modais ----------------------------- */
function openModal(html, onClose) {
  hideToast(); $('modal').innerHTML = html; $('modalOver').hidden = false; UI.modalClose = onClose || null;
  const f = $('modal').querySelector('button'); if (f) f.focus({ preventScroll: true });
}
function closeModal() { $('modalOver').hidden = true; $('modal').innerHTML = ''; if (UI.modalClose) { const c = UI.modalClose; UI.modalClose = null; c(); } }
function sw(kind) {
  const P = UI.pal;
  const s = {
    ult: `<rect x="1" y="5" width="46" height="12" fill="${rgba(P.amber, 0.18)}"/><line x1="1" y1="5" x2="47" y2="5" stroke="${P.amber}" stroke-width="2"/><line x1="1" y1="17" x2="47" y2="17" stroke="${P.amber}" stroke-width="2"/><path d="M3 12h8v-3h9v4h8v-2h9v3h8" fill="none" stroke="${P.text}" stroke-width="1.6"/>`,
    med: `<line x1="1" y1="7" x2="47" y2="7" stroke="${P.violet}" stroke-width="1.6" stroke-dasharray="5 4"/><line x1="1" y1="15" x2="47" y2="15" stroke="${P.violet}" stroke-width="1.6" stroke-dasharray="5 4"/>`,
    est: `<line x1="1" y1="7" x2="47" y2="7" stroke="${P.gray}" stroke-width="2" stroke-dasharray="1.5 3.5" stroke-linecap="round"/><line x1="1" y1="15" x2="47" y2="15" stroke="${P.gray}" stroke-width="2" stroke-dasharray="1.5 3.5" stroke-linecap="round"/>`,
    rej: `<defs><pattern id="hx" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" stroke="${rgba(P.rasp, 0.5)}"/></pattern></defs><rect x="1" y="1" width="46" height="7" fill="url(#hx)"/><line x1="1" y1="8" x2="47" y2="8" stroke="${P.rasp}" stroke-width="2"/>`,
    prot: `<rect x="1" y="6" width="46" height="10" fill="${rgba(P.cyan, 0.2)}" stroke="${P.cyan}"/>`,
    theo: `<line x1="1" y1="11" x2="40" y2="11" stroke="${P.amber}" stroke-width="2" stroke-dasharray="2 3"/><circle cx="41" cy="11" r="4" fill="${P.amber}"/>`,
    block: `<rect x="3" y="1" width="30" height="20" fill="${rgba(P.amber, 0.14)}" stroke="${P.amber}"/><line x1="33" y1="1" x2="45" y2="1" stroke="${P.amber}" stroke-dasharray="2 2"/><rect x="33" y="1" width="12" height="20" fill="${rgba(P.amber, 0.08)}" stroke="${P.amber}" stroke-dasharray="3 2"/>`
  }[kind];
  return `<svg viewBox="0 0 48 22" aria-hidden="true">${s}</svg>`;
}
/* ----------------------------- seções da página: como funciona, parâmetros, aulas ----------------------------- */
function guideHTML() {
  const G = [
    ['rej', 'Túnel de rejeição', 'área vinho hachurada além da linha', 'Age na entrada da oferta: compra acima do limite superior ou venda abaixo do inferior é recusada e nem entra no livro. Existe também um limite de quantidade por oferta. É o mais largo; serve para barrar erro operacional.'],
    ['ult', 'Túnel de leilão por último preço', 'tubo dourado', 'Age no momento do negócio: se o próximo negócio sairia fora dele, o negócio não acontece e o ativo entra em leilão. Acompanha o preço-base; nos futuros, o centro anda em degraus.'],
    ['med', 'Túnel de leilão por preço médio', 'índigo tracejado', `Centro na média ponderada dos negócios dos últimos ${CONFIG.vwapWindowSec} s. Pega a escada: vários negócios pequenos que passam um a um no túnel do último preço, mas que somados se afastam da média.`],
    ['est', 'Túnel estático', 'cinza pontilhado', 'Fixo no dia, sobre o fechamento anterior. Simplificação: depois que um leilão abre além de um degrau, passa a valer o próximo (±10%, ±20%, ±30%…).'],
    ['prot', 'Túnel de proteção', 'faixa verde-petróleo sobre o bloco de leilão', `Age no encerramento de leilões e calls, sobre o último negócio antes do leilão. Se o teórico estiver no limite ou além, prorroga. Exemplo: parâmetro 2%, referência 100,00, proteção de 98,00 a 102,00; teórico 102,00 ou 97,90 prorroga, 101,50 não. Também prorroga se uma corretora somar mais de ${CONFIG.prorrogation.qtyProtectionLots} lotes entre compra e venda.`],
    ['theo', 'Preço teórico', 'linha dourada pontilhada', 'Maximiza a quantidade negociada; no empate, deixa o menor desequilíbrio; depois, o mais perto do último negócio. No encerramento, tudo sai a esse preço único (prioridade: MOA, preço, ordem de chegada).'],
    ['block', 'Bloco de leilão', 'faixa dourada vertical', 'Vai do início ao fim previsto. Cada prorrogação estica o bloco para a direita, com o motivo escrito. Contorno tracejado indica call (abertura, fechamento ou reabertura).']
  ];
  return `<div class="guide-grid">${G.map(([k, t, s, p]) => `<article class="card g-card">${sw(k)}<div><h3>${t}</h3><span class="g-sub">No gráfico: ${s}</span></div><p>${p}</p></article>`).join('')}</div>
  <div class="g-notes">
    <div>
    <h3>Por que um leilão prorroga</h3>
    <p>Contam como alteração: 1) mudou o preço teórico; 2) mudou a quantidade teórica; 3) entrou oferta nova que mudou a quantidade atendida de outra; 4) mudou o saldo não atendido. No fim previsto, a proteção (preço ou quantidade) prorroga primeiro, por 1 min. Senão vale a escada: 1ª prorrogação se houve alteração no último minuto, 2ª nos últimos 30 s, 3ª nos últimos 15 s. Depois da 3ª, só a proteção prorroga. Para não virar laço infinito, após ${CONFIG.prorrogation.maxProtection} prorrogações por proteção a supervisão de mercado (simulada) autoriza a abertura no teórico.</p>
    <p>Durante o leilão, compras com preço igual ou acima do teórico e vendas igual ou abaixo dele não podem ser canceladas nem reduzidas: só melhorar o preço ou aumentar a quantidade. No livro e na boleta, elas aparecem com cadeado.</p>
    </div>
    <div>
    <h3>Estados no mapa</h3>
    <p>Borda dourada com anel: em leilão, com o teórico no lugar do último preço. Selo +N: prorrogações (o anel recomeça a cada uma). Contorno tracejado: call. Cinza hachurado: parado pelo circuit breaker. Pulso vinho no canto: uma oferta acabou de ser rejeitada. O fundo é tingido pela variação do dia.</p>
    <h3>Classificação dos túneis</h3>
    <p><b>Estático</b>: fixo no dia (túnel estático; rejeição dos derivativos, sobre o ajuste). <b>Dinâmico síncrono</b>: segue o preço do próprio ativo (último preço, preço médio). <b>Dinâmico assíncrono</b>: vem de outro ativo, como nas opções, cujo túnel deriva do teórico calculado a partir de PETR4.</p>
    </div>
    <div>
    <h3>Limites e arredondamento</h3>
    <p>Rejeição e leilão: limites arredondados ao tick para dentro e inclusivos (preço igual ao limite está dentro). Proteção: arredondada ao tick mais próximo; teórico igual ao limite já prorroga. Em ações, a meia-largura mínima do túnel de leilão é R$ ${fnum(CONFIG.minAmplitudeStocks, 2)} (veja PQNO3).</p>
    </div>
    <div>
    <h3>Simplificações</h3>
    <p>Agentes simulados (formadores de mercado, agressores, dedo gordo, baleia, escada). Oferta a mercado sem contraparte é cancelada. A supervisão encerra o leilão após ${CONFIG.prorrogation.maxProtection} prorrogações por proteção. Durações: ${CONFIG.groups.IBOV.auctionSec / 60} min para ações do Ibovespa/IBrX com oscilação moderada, ${CONFIG.auctionDuration.bigSec / 60} min se ≥ 9%, ${CONFIG.auctionDuration.extremeSec / 60} a ${CONFIG.auctionDuration.extreme2Sec / 60} min se ≥ 50%, ${CONFIG.auctionDuration.qtySec / 60} min por quantidade, ${CONFIG.auctionDuration.futSec / 60} min em futuros e ${CONFIG.auctionDuration.optSec / 60} min em opções. Tudo fica editável no objeto CONFIG, no topo do código.</p>
    </div>
  </div>`;
}
function paramHTML() {
  const G = CONFIG.groups, pc = s => !s ? 'nenhum' : (s.pct != null ? '±' + fnum(s.pct * 100, s.pct * 100 % 1 ? 1 : 0) + '%' : (s.abs != null ? '±' + fnum(s.abs, 2) + ' p.p.' : 'choque de vol. ' + (s.volShock >= 0.1 ? 'alto' : 'moderado')));
  const rows = Object.keys(G).map(k => { const g = G[k]; return `<tr><td>${g.label}</td><td>${pc(g.rej)}${g.rejOnSettle ? ' sobre o ajuste' : ''}</td><td>${pc(g.ult)}</td><td>${pc(g.med)}</td><td>${pc(g.est)}</td><td>${pc(g.protAuction)}</td><td>${pc(g.protCall)}</td><td>${({ CLAST: 'C-LAST', LTP: 'LTP', MOSTRECENT: 'Most recent', TEORICO: 'Teórico (assíncrono)' })[g.priceBase]}</td></tr>`; }).join('');
  return `<table class="ptab"><thead><tr><th>Grupo</th><th>Rejeição</th><th>Leilão (último)</th><th>Leilão (médio)</th><th>Estático</th><th>Proteção leilão</th><th>Proteção calls</th><th>Preço-base</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderGuide() { setHTML('guideBody', guideHTML()); setHTML('paramBody', paramHTML()); }
function renderLessons() {
  const done = lesDone();
  const card = l => { const ok = done.has(l.id); return `<article class="card les-card${ok ? ' done' : ''}">` +
    `<div class="les-top"><span class="les-n">Aula ${LESSONS.indexOf(l) + 1}</span>${ok ? '<span class="les-ok">✓ Concluída</span>' : ''}</div>` +
    `<h3>${l.title}</h3><p class="les-sub">${l.sub}</p><p class="les-goal"><b>Você vai ver</b> ${l.goal}</p>` +
    `<div class="les-foot"><button class="btn" data-les="${l.id}">${ok ? 'Refazer' : 'Começar aula'}</button><span class="les-meta">${l.steps.length} etapas, com teste no fim</span></div></article>`; };
  const groups = Object.keys(LES_GRP);
  if (!UI.lesGrp || groups.indexOf(UI.lesGrp) === -1) UI.lesGrp = groups[0];
  $('lesTabs').innerHTML = groups.map(g => `<button data-g="${g}" role="tab" aria-selected="${g === UI.lesGrp}" class="${g === UI.lesGrp ? 'on' : ''}">${LES_GRP[g].t}</button>`).join('');
  $('lesGrid').innerHTML = groups.map(g => `<div class="les-pane" data-g="${g}"${g === UI.lesGrp ? '' : ' hidden'}><p class="grp-d">${LES_GRP[g].d}</p><div class="les-grid">${LESSONS.filter(l => l.grp === g).map(card).join('')}</div></div>`).join('');
}

/* ----------------------------- guia de opções: textos do simulador, exemplos e laboratório ----------------------------- */
const brl = (x, d = 2) => 'R$ ' + fnum(x, d);
const LAB = { cp: 'C', side: 1, S: 38.5, K: 40, Td: 15, v: 0.31, r: 0.1425, res: null };
function renderOptions() {
  const S = CONFIG.schedule.options, G = CONFIG.groups.OPC, c = CONFIG.instruments.find(x => x.ticker === 'PETRJ400'), p = CONFIG.instruments.find(x => x.ticker === 'PETRV370');
  setText('opLot', fq(c.lot));
  setText('opHours', `pré-abertura às ${S.preOpen}, negociação das ${S.open} às ${S.closeCall} e call de fechamento até ${S.close}, como as ações`);
  setText('opTun', `O centro é o prêmio teórico pelo modelo, calculado com o preço do ativo-objeto, e os limites vêm de choques de volatilidade sobre a máxima e a mínima do objeto nos últimos ${CONFIG.option.windowSec} s. A proteção vale ${pctSpec(G.protAuction)} nos leilões e ${pctSpec(G.protCall)} nos calls.`);
  setText('opSimp', `juros de ${fnum(CONFIG.option.r * 100, 2)}% ao ano tratados como taxa contínua, ${CONFIG.option.daysToExpiry} dias úteis até o vencimento, nenhum provento e volatilidade fixa por opção (${fnum(c.iv * 100, 0)}% na ${c.ticker} e ${fnum(p.iv * 100, 0)}% na ${p.ticker})`);
  setHTML('opExamples', opExamplesHTML());
  setHTML('opFlow', flowHTML()); setHTML('opMny', moneyHTML()); setHTML('opStrat', stratHTML());
  renderStory();
  setHTML('opActions', LESSONS.filter(l => l.grp === 'opcao').map(l => `<button class="btn" data-les="${l.id}">Aula ${LESSONS.indexOf(l) + 1}: ${l.title}</button>`).join('') + '<button class="btn primary" data-focus="PETRJ400">Ver PETRJ400 no simulador</button>');
}
/* ----------------------------- guia de opções: capítulos em acordeão -----------------------------
   Só um capítulo fica aberto por vez; os outros mostram só o título. Isso evita que o guia inteiro
   (sete capítulos, com laboratório e gráficos) apareça de uma vez, sempre expandido. */
function opChapters() { return Array.from(document.querySelectorAll('#opcoes .op-ch')); }
function toggleChapter(id) {
  const alvo = $(id); if (!alvo) return;
  const corpo = alvo.querySelector('.op-ch-body'); if (!corpo) return;
  const abrir = corpo.hidden;
  for (const ch of opChapters()) {
    const b = ch.querySelector('.op-ch-body'), h = ch.querySelector('.op-ch-h');
    const on = ch === alvo && abrir;
    b.hidden = !on; h.setAttribute('aria-expanded', String(on));
  }
  syncOpToc();
  // gráficos em canvas dentro do capítulo 4 e 5: redesenha depois que o layout assume o tamanho real
  if (abrir && (id === 'op-4' || id === 'op-5')) requestAnimationFrame(() => requestAnimationFrame(redrawGuide));
}
function openChapter(id) {
  const corpo = $(id) && $(id).querySelector('.op-ch-body');
  if (corpo && corpo.hidden) toggleChapter(id);
}
function syncOpToc() {
  const atual = opChapters().find(ch => { const b = ch.querySelector('.op-ch-body'); return b && !b.hidden; });
  for (const a of document.querySelectorAll('#opcoes .op-toc a')) {
    const on = !!atual && a.getAttribute('href') === '#' + atual.id;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }
}
/* exemplos de exercício com os prêmios de fechamento das opções do simulador */
function opExamplesHTML() {
  const E = UI.E, c = E.by.PETRJ400, p = E.by.PETRV370, lot = c.lot, pc = c.prevClose, pp = p.prevClose, kc = c.strike, kp = p.strike;
  const cu = kc + 2, cd = kc - 1, pd = kp - 2, pu = kp + 1;
  return `<article class="card op-exc"><h4>Exemplo com a call</h4><p>Você compra 1 lote de ${fq(lot)} ${c.ticker} a ${brl(pc)}, o fechamento anterior no simulador, e paga ${brl(pc * lot)}.</p><ul>` +
    `<li>PETR4 termina a ${brl(cu)}: você exerce, compra ${fq(lot)} ações a ${brl(kc)} que valem ${brl(cu)}, e o resultado é ${brl((cu - kc) * lot)} − ${brl(pc * lot)} = <b>${brl((cu - kc - pc) * lot)}</b>.</li>` +
    `<li>PETR4 termina a ${brl(cd)}: a call vence sem valor, e a perda é o prêmio, <b>${brl(pc * lot)}</b>.</li>` +
    `<li>O ponto de equilíbrio é ${brl(kc + pc)}: o strike mais o prêmio.</li></ul></article>` +
    `<article class="card op-exc"><h4>Exemplo com a put</h4><p>Você compra 1 lote de ${fq(lot)} ${p.ticker} a ${brl(pp)}, o fechamento anterior no simulador, e paga ${brl(pp * lot)}.</p><ul>` +
    `<li>PETR4 termina a ${brl(pd)}: você exerce, vende ${fq(lot)} ações a ${brl(kp)} que valem ${brl(pd)}, e o resultado é ${brl((kp - pd) * lot)} − ${brl(pp * lot)} = <b>${brl((kp - pd - pp) * lot)}</b>.</li>` +
    `<li>PETR4 termina a ${brl(pu)}: a put vence sem valor, e a perda é o prêmio, <b>${brl(pp * lot)}</b>.</li>` +
    `<li>O ponto de equilíbrio é ${brl(kp - pp)}: o strike menos o prêmio.</li></ul></article>`;
}
/* laboratório: Black-Scholes com os controles da seção */
function labCalc() {
  const { cp, S, K, Td, v, r } = LAB, T = Td / 252, price = Math.round(bsPrice(cp, S, K, T, r, v) * 100) / 100; // prêmio em centavos, como na tela de negociação
  let delta;
  if (T <= 0 || v <= 0) delta = cp === 'C' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  else { const d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)); delta = cp === 'C' ? ncdf(d1) : ncdf(d1) - 1; }
  const intr = Math.max(0, cp === 'C' ? S - K : K - S);
  return { price, delta, intr, ext: price - intr, be: cp === 'C' ? K + price : K - price };
}
function labMoney() { const { cp, S, K } = LAB, m = S / K - 1; if (Math.abs(m) <= 0.015) return 'no dinheiro'; return (cp === 'C' ? m > 0 : m < 0) ? 'dentro do dinheiro' : 'fora do dinheiro'; }
function labReading(R, lot) {
  const { cp, side, S, K, Td } = LAB, p = brl(R.price), be = brl(R.be), k = brl(K);
  let s;
  if (cp === 'C' && side > 0) s = `Pagando ${p} por opção (${brl(R.price * lot)} por lote), o titular só tem lucro no vencimento se o ativo terminar acima de ${LB(be)}. Abaixo do strike (${k}), a call vence sem valor, e a perda é o prêmio pago.`;
  else if (cp === 'C') s = `Recebendo ${p} por opção, o lançador fica com o prêmio inteiro se o ativo terminar abaixo de ${LB(k)}. Acima de ${be}, ele perde, e a perda cresce sem limite enquanto o ativo sobe. Por isso o lançador descoberto deposita garantias.`;
  else if (side > 0) s = `Pagando ${p} por opção (${brl(R.price * lot)} por lote), o titular tem lucro no vencimento se o ativo terminar abaixo de ${LB(be)}. Acima do strike (${k}), a put vence sem valor. O maior ganho possível, com o ativo a zero, é ${brl(K - R.price)} por opção.`;
  else s = `Recebendo ${p} por opção, o lançador fica com o prêmio se o ativo terminar acima de ${LB(k)}. Abaixo de ${be}, ele perde; no pior caso, com o ativo a zero, a perda é ${brl(K - R.price)} por opção.`;
  if (R.price >= 0.01) { const lev = R.delta * S / R.price; if (Math.abs(lev) >= 0.5) s += `<br>Alavancagem: se o ativo subir 1% agora, o prêmio ${lev > 0 ? 'sobe' : 'cai'} cerca de ${fnum(Math.abs(lev), Math.abs(lev) < 10 ? 1 : 0)}% pelo modelo.`; }
  else s += '<br>O prêmio está perto de zero: pelo modelo, a chance de a opção terminar dentro do dinheiro é muito pequena.';
  if (R.ext < -0.005) s += '<br>Repare: o prêmio ficou abaixo do valor intrínseco. Numa put europeia bem dentro do dinheiro, isso acontece por causa dos juros: receber o strike só no vencimento vale menos que recebê-lo hoje.';
  if (Td === 0) s += '<br>No dia do vencimento, o prêmio é só o valor intrínseco: não sobra tempo para a opção ganhar valor.';
  return s;
}
function labUpdate() {
  const R = LAB.res = labCalc(), { cp, S, K, Td, v, r } = LAB, lot = CONFIG.instruments.find(x => x.type === 'opt').lot;
  setText('labSv', brl(S)); setText('labKv', brl(K)); setText('labTv', Td === 0 ? 'hoje é o vencimento' : (Td === 1 ? '1 dia útil' : `${Td} dias úteis`));
  setText('labVv', fnum(v * 100, 0) + '% ao ano'); setText('labRv', fnum(r * 100, 2) + '% ao ano');
  setText('labPrem', brl(R.price)); setText('labLot', `${brl(R.price * lot)} por lote de ${fq(lot)}`);
  setText('labIntr', brl(R.intr)); setText('labExt', brl(Math.max(0, R.ext)));
  const m = labMoney(); setText('labMny', m);
  setText('labMnyTxt', `ativo a ${fpct(S / K - 1, 1)} do strike`);
  setText('labDelta', fnum(R.delta, 2)); setText('labDeltaTxt', `o prêmio ${R.delta >= 0 ? 'sobe' : 'cai'} cerca de ${brl(Math.abs(R.delta))} a cada R$ 1,00 que o ativo sobe`);
  setText('labBE', brl(R.be)); setText('labBETxt', cp === 'C' ? 'strike mais o prêmio' : 'strike menos o prêmio');
  setHTML('labRead', labReading(R, lot));
  drawLab();
  setHTML('opChain', chainHTML()); drawDecay(); drawVolc(); // grade e gráficos usam os mesmos números
}
function bsDelta(cp, S, K, T, r, v) {
  if (T <= 0 || v <= 0) return cp === 'C' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)); return cp === 'C' ? ncdf(d1) : ncdf(d1) - 1;
}
const opt = tk => CONFIG.instruments.find(x => x.ticker === tk);
/* quem paga o quê: titular à esquerda, lançador à direita; dinheiro em dourado, direito ou ações em azul */
function flowSVG(top, bot) {
  const lbl = (o, y1, y2) => `<text class="fl-l1 ${o.kind}" x="160" y="${y1}" text-anchor="middle">${o.t1}</text><text class="fl-l2" x="160" y="${y2}" text-anchor="middle">${o.t2}</text>`;
  return '<svg class="fl" viewBox="0 0 320 124" aria-hidden="true">' +
    '<rect class="fl-box" x="2" y="32" width="98" height="60" rx="10"/><text class="fl-who" x="51" y="59" text-anchor="middle">Titular</text><text class="fl-what" x="51" y="76" text-anchor="middle">comprou a opção</text>' +
    '<rect class="fl-box" x="220" y="32" width="98" height="60" rx="10"/><text class="fl-who" x="269" y="59" text-anchor="middle">Lançador</text><text class="fl-what" x="269" y="76" text-anchor="middle">vendeu a opção</text>' +
    `<path class="fl-${top.kind}" d="M106 48H207"/><path class="fl-${top.kind}h" d="M214 48l-9-5v10z"/>` + lbl(top, 28, 41) +
    `<path class="fl-${bot.kind}" d="M214 78H113"/><path class="fl-${bot.kind}h" d="M106 78l9-5v10z"/>` + lbl(bot, 97, 110) + '</svg>';
}
function flowHTML() {
  const c = opt('PETRJ400'), p = opt('PETRV370'), lot = c.lot, pc = UI.E.by.PETRJ400.prevClose;
  const card = (h, svg, txt) => `<div class="card fl-card"><h4>${h}</h4>${svg}<p>${txt}</p></div>`;
  return card('No dia do negócio', flowSVG({ t1: `prêmio ${brl(pc * lot, 0)}`, t2: `${fq(lot)} × ${brl(pc)}`, kind: 'm' }, { t1: 'o direito', t2: `${fq(lot)} opções`, kind: 'g' }), 'O titular paga o prêmio à vista e recebe o direito. O lançador recebe o prêmio e assume a obrigação.') +
    card('Se a call for exercida', flowSVG({ t1: brl(c.strike * lot, 0), t2: `${fq(lot)} × ${brl(c.strike)}`, kind: 'm' }, { t1: `${fq(lot)} ações`, t2: 'de PETR4', kind: 'g' }), 'O titular paga o strike e recebe as ações, mesmo que elas valham mais no mercado.') +
    card('Se a put for exercida', flowSVG({ t1: `${fq(lot)} ações`, t2: 'de PETR4', kind: 'g' }, { t1: brl(p.strike * lot, 0), t2: `${fq(lot)} × ${brl(p.strike)}`, kind: 'm' }), 'O titular entrega as ações e recebe o strike, mesmo que elas valham menos no mercado.');
}
/* faixa de preço: dentro, no ou fora do dinheiro, para call e put de mesmo strike */
function moneyHTML() {
  const K = opt('PETRJ400').strike, S = opt('PETR4').prevClose, lo = K - 6, hi = K + 6, band = 0.6, pos = x => ((x - lo) / (hi - lo) * 100).toFixed(2) + '%';
  const f1 = K - band - lo, f2 = 2 * band, f3 = hi - K - band;
  const row = (a, c) => `<div class="mny-bar"><span class="z ${a}" style="flex:${f1}">${a === 'off' ? 'fora do dinheiro' : 'dentro do dinheiro'}</span><span class="z atm" style="flex:${f2}">no</span><span class="z ${c}" style="flex:${f3}">${c === 'off' ? 'fora do dinheiro' : 'dentro do dinheiro'}</span></div>`;
  const ticks = []; for (let x = lo; x <= hi; x += 2) ticks.push(`<span class="${x === K ? 'k' : ''}" style="left:${pos(x)}">${x === K ? 'strike ' : ''}${fnum(x, 0)}</span>`);
  return `<div class="mny"><div class="mny-labs"><span>Call</span><span>Put</span></div><div class="mny-track">${row('off', 'itm')}${row('itm', 'off')}<div class="mny-axis">${ticks.join('')}</div><div class="mny-mark" style="left:${pos(S)}"><span>PETR4 a ${brl(S)}</span></div></div></div>`;
}
/* grade de strikes do mesmo vencimento, calculada com os números do laboratório */
function chainHTML() {
  const { S, Td, v, r } = LAB, T = Td / 252, k0 = Math.round(S), rows = [];
  for (let K = k0 - 5; K <= k0 + 5; K++) {
    if (K <= 0) continue;
    const c = Math.round(bsPrice('C', S, K, T, r, v) * 100) / 100, p = Math.round(bsPrice('P', S, K, T, r, v) * 100) / 100;
    rows.push({ K, c, p, ci: Math.min(c, Math.max(0, S - K)), pi: Math.min(p, Math.max(0, K - S)), dc: bsDelta('C', S, K, T, r, v), dp: bsDelta('P', S, K, T, r, v) });
  }
  const mx = Math.max(0.01, ...rows.map(x => Math.max(x.c, x.p)));
  const atm = rows.reduce((a, b) => (Math.abs(b.K - S) < Math.abs(a.K - S) ? b : a));
  const bar = (tot, intr, side) => { const w = tot / mx * 100, wi = tot > 0 ? intr / tot * w : 0, a = `<i class="in" style="width:${wi.toFixed(1)}%"></i>`, b = `<i class="ex" style="width:${(w - wi).toFixed(1)}%"></i>`; return `<div class="cb ${side}">${side === 'c' ? b + a : a + b}</div>`; };
  const td = (cp, K, cls, html) => `<td class="${cls}" data-cp="${cp}" data-k="${K}">${html}</td>`;
  return '<table class="chain"><thead><tr><th colspan="4">Calls (opções de compra)</th><th>Strike</th><th colspan="4">Puts (opções de venda)</th></tr><tr><th>Código</th><th>Delta</th><th>Prêmio</th><th></th><th></th><th></th><th>Prêmio</th><th>Delta</th><th>Código</th></tr></thead><tbody>' +
    rows.map(x => {
      const c = (x.K < S ? ' itm' : '') + (LAB.cp === 'C' && LAB.K === x.K ? ' sel' : ''), p = (x.K > S ? ' itm' : '') + (LAB.cp === 'P' && LAB.K === x.K ? ' sel' : '');
      return `<tr class="${x === atm ? 'atm' : ''}">` + td('C', x.K, 'code' + c, `PETRJ${x.K * 10}`) + td('C', x.K, c.trim(), fnum(x.dc, 2)) + td('C', x.K, c.trim(), fnum(x.c, 2)) + td('C', x.K, 'bar' + c, bar(x.c, x.ci, 'c')) +
        `<td class="k">${fnum(x.K, 2)}</td>` + td('P', x.K, 'bar' + p, bar(x.p, x.pi, 'p')) + td('P', x.K, p.trim(), fnum(x.p, 2)) + td('P', x.K, p.trim(), fnum(x.dp, 2)) + td('P', x.K, 'code' + p, `PETRV${x.K * 10}`) + '</tr>';
    }).join('') + '</tbody></table>';
}
/* gráfico de linhas simples para o guia: rótulos no fim de cada linha, marcador vertical opcional */
function miniChart(cv, S, o) {
  if (!cv) return; const { ctx, w: W, h: H } = fitSmall(cv), P = UI.pal; if (W < 80 || H < 60) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of S) for (const [x, y] of s.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (o.hline) { y0 = Math.min(y0, o.hline.y); y1 = Math.max(y1, o.hline.y); }
  if (o.y0 != null) y0 = Math.min(y0, o.y0);
  const pad = (y1 - y0) * 0.1 || 0.1; y1 += pad; if (o.y0 == null) y0 -= pad;
  const pl = 42, pr = o.pr != null ? o.pr : 96, pt = 12, pb = o.xtitle ? 36 : 22, pw = W - pl - pr, ph = H - pt - pb;
  const X = x => pl + (o.xrev ? x1 - x : x - x0) / ((x1 - x0) || 1) * pw, Y = y => pt + (1 - (y - y0) / ((y1 - y0) || 1)) * ph;
  const f11 = '11px ' + FONT, b11 = '600 11px ' + FONT;
  ctx.font = f11; ctx.lineWidth = 1;
  const ys = niceStep(y1 - y0, Math.max(2, ph / 34)); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + 1e-9; y += ys) { const yy = Math.round(Y(y)) + 0.5; ctx.strokeStyle = rgba(P.line2, 0.35); ctx.beginPath(); ctx.moveTo(pl, yy); ctx.lineTo(pl + pw, yy); ctx.stroke(); ctx.fillStyle = P.faint; ctx.fillText(o.yfmt(Math.abs(y) < ys * 1e-6 ? 0 : y, ys), pl - 6, yy); }
  const xs = niceStep(x1 - x0, Math.max(2, pw / 64)); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + 1e-9; x += xs) { ctx.fillStyle = P.faint; ctx.fillText(o.xfmt(x), X(x), pt + ph + 5); }
  if (o.xtitle) { ctx.fillStyle = P.muted; ctx.fillText(o.xtitle, pl + pw / 2, pt + ph + 20); }
  if (o.hline) { const yy = Math.round(Y(o.hline.y)) + 0.5; ctx.strokeStyle = P.amber; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(pl, yy); ctx.lineTo(pl + pw, yy); ctx.stroke(); ctx.setLineDash([]); ctx.font = b11; ctx.fillStyle = P.amber; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(o.hline.label, pl + pw + 6, yy); ctx.font = f11; }
  if (o.mark && o.mark.x >= x0 && o.mark.x <= x1) {
    const xx = Math.round(X(o.mark.x)) + 0.5, right = xx > pl + pw - 80; ctx.strokeStyle = P.accent; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xx, pt); ctx.lineTo(xx, pt + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = b11; ctx.fillStyle = P.accent; ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText(o.mark.label, xx + (right ? -4 : 4), pt); ctx.font = f11;
  }
  const ends = [];
  for (const s of S) {
    ctx.strokeStyle = s.col; ctx.lineWidth = s.w || 2; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round'; ctx.beginPath();
    s.pts.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    if (s.label) { const [lx, ly] = s.pts[s.pts.length - 1]; ends.push({ x: X(lx), y: Y(ly), t: s.label, col: s.col }); }
  }
  ends.sort((a, b) => a.y - b.y); for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
  ctx.font = b11; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; for (const e of ends) { ctx.fillStyle = e.col; ctx.fillText(e.t, e.x + (o.dots ? 15 : 7), e.y); }
  if (o.dots) for (const d of o.dots) { const px = X(d.x), py = Y(d.y); ctx.fillStyle = P.panel; ctx.beginPath(); ctx.arc(px, py, 10, 0, 7); ctx.fill(); ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(px, py, 8.5, 0, 7); ctx.fill(); ctx.fillStyle = P.onacc; ctx.font = '600 10px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(d.n), px, py + 0.5); }
}
const moneyFmt = (y, s) => fnum(y, s < 1 ? 2 : 0);
function drawDecay() {
  const { S, v, r, Td } = LAB, q = x => Math.round(x * 4) / 4;
  const lines = [[q(S * 0.94), 'dentro', UI.pal.up], [q(S), 'no dinheiro', UI.pal.amber], [q(S * 1.06), 'fora', UI.pal.gray]];
  const series = lines.map(([K, t, col]) => { const pts = []; for (let d = 60; d >= 0; d--) pts.push([d, bsPrice('C', S, K, d / 252, r, v)]); return { pts, col, w: 2, label: `${t} (${fnum(K, 2)})` }; });
  miniChart($('opDecay'), series, { xrev: true, y0: 0, xfmt: x => fnum(x, 0), yfmt: moneyFmt, xtitle: 'dias úteis até o vencimento', mark: Td <= 60 ? { x: Td, label: 'laboratório' } : null, pr: 118 });
}
function drawVolc() {
  const { S, r, Td, v } = LAB, K = Math.round(S * 4) / 4, T = Math.max(Td, 1) / 252;
  const mk = cp => { const pts = []; for (let s = 5; s <= 80; s++) pts.push([s, bsPrice(cp, S, K, T, r, s / 100)]); return pts; };
  miniChart($('opVolc'), [{ pts: mk('C'), col: UI.pal.up, w: 2, label: 'call' }, { pts: mk('P'), col: UI.pal.down, w: 2, label: 'put' }],
    { y0: 0, xfmt: x => fnum(x, 0) + '%', yfmt: moneyFmt, xtitle: `volatilidade ao ano (strike ${fnum(K, 2)})`, mark: v * 100 <= 80 ? { x: v * 100, label: 'laboratório' } : null, pr: 56 });
}
/* uma call do começo ao fim: PETR4 dia a dia (trajetória ilustrativa) e o prêmio pelo modelo */
const STORY = [38.50, 38.70, 38.40, 39.10, 39.60, 40.40, 40.90, 40.60, 40.80, 40.50, 40.70, 40.60, 40.80, 40.70, 41.00, 41.20];
function storyData() {
  const c = opt('PETRJ400'), n = STORY.length - 1;
  return STORY.map((S, d) => ({ d, S, prem: Math.round(bsPrice('C', S, c.strike, (n - d) / 252, CONFIG.option.r, c.iv) * 100) / 100, intr: Math.max(0, S - c.strike) }));
}
function renderStory() {
  const D = storyData(), c = opt('PETRJ400'), lot = c.lot, K = c.strike, a = D[0], b = D[5], c1 = D[8], c2 = D[12], e = D[D.length - 1], res = (e.intr - a.prem) * lot;
  setHTML('opStoryBeats', [
    `<b>No dia da compra</b>, você paga ${brl(a.prem)} por opção, ${brl(a.prem * lot)} pelo lote. PETR4 está em ${brl(a.S)}, abaixo do strike: a call está fora do dinheiro, e o prêmio é todo valor extrínseco.`,
    `<b>${b.d} dias úteis depois</b>, PETR4 sobe para ${brl(b.S)} (${fpct(b.S / a.S - 1)}). A call vai a ${brl(b.prem)} (${fpct(b.prem / a.prem - 1, 0)}): essa é a alavancagem.`,
    `<b>Do ${c1.d}º ao ${c2.d}º dia útil</b>, PETR4 anda de lado e está em ${brl(c1.S)} nos dois dias, mas a call cai de ${brl(c1.prem)} para ${brl(c2.prem)}. O ativo não mudou; o que sumiu foi valor extrínseco.`,
    `<b>No vencimento</b>, PETR4 fecha em ${brl(e.S)}, e a call vale só o intrínseco, ${brl(e.intr)}. Exercendo (comprar ${fq(lot)} ações a ${brl(K)}) ou vendendo a call antes do fim, o resultado é (${fnum(e.intr, 2)} − ${fnum(a.prem, 2)}) × ${fq(lot)} = <b>${brl(res)}</b>. Do outro lado, o lançador recebeu ${brl(a.prem * lot)} e entrega por ${brl(K)} ações que valem ${brl(e.S)}: perde os mesmos ${brl(Math.abs(res))}.`
  ].map(x => `<li><span>${x}</span></li>`).join(''));
  drawStory();
}
function drawStory() {
  const D = storyData(), K = opt('PETRJ400').strike, n = D.length - 1;
  miniChart($('opStoryS'), [{ pts: D.map(x => [x.d, x.S]), col: UI.pal.text, w: 2, label: 'PETR4' }], { xfmt: x => fnum(x, 0), yfmt: moneyFmt, hline: { y: K, label: 'strike' }, pr: 64 });
  miniChart($('opStoryP'), [{ pts: D.map(x => [x.d, x.intr]), col: UI.pal.muted, w: 1.6, dash: [2, 3], label: 'intrínseco' }, { pts: D.map(x => [x.d, x.prem]), col: UI.pal.accent, w: 2.4, label: 'prêmio' }],
    { y0: 0, xfmt: x => fnum(x, 0), yfmt: moneyFmt, xtitle: 'dias úteis desde a compra', pr: 64, dots: [{ x: 0, y: D[0].prem, n: 1 }, { x: 5, y: D[5].prem, n: 2 }, { x: 8, y: D[8].prem, n: 3 }, { x: 12, y: D[12].prem, n: 3 }, { x: n, y: D[n].prem, n: 4 }] });
}
/* resultado no vencimento de uma posição, desenhado em SVG (estratégias) */
function payoffSVG(fn, lo, hi, marks) {
  const n = 64, xs = [], ys = [];
  for (let j = 0; j <= n; j++) { const x = lo + (hi - lo) * j / n; xs.push(x); ys.push(fn(x)); }
  let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys); const pad = (y1 - y0) * 0.12 || 0.5; y0 -= pad; y1 += pad;
  const W = 240, H = 130, pl = 6, pr = 6, pt = 8, pb = 22, X = x => pl + (x - lo) / (hi - lo) * (W - pl - pr), Y = y => pt + (1 - (y - y0) / (y1 - y0)) * (H - pt - pb);
  const zy = Y(0).toFixed(1), area = f => `M${X(lo).toFixed(1)} ${zy} ` + xs.map((x, j) => `L${X(x).toFixed(1)} ${Y(f(ys[j])).toFixed(1)}`).join(' ') + ` L${X(hi).toFixed(1)} ${zy}Z`;
  return `<svg class="pf" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="pf-gain" d="${area(y => Math.max(0, y))}"/><path class="pf-loss" d="${area(y => Math.min(0, y))}"/><path class="pf-zero" d="M${pl} ${zy}H${W - pr}"/>` +
    marks.map(m => `<path class="pf-k" d="M${X(m.x).toFixed(1)} ${pt}V${H - pb}"/><text x="${X(m.x).toFixed(1)}" y="${H - 7}" text-anchor="middle">${m.t}</text>`).join('') +
    `<path class="pf-line" d="M${xs.map((x, j) => `${X(x).toFixed(1)} ${Y(ys[j]).toFixed(1)}`).join(' L')}"/></svg>`;
}
function stratHTML() {
  const S0 = opt('PETR4').prevClose, cI = UI.E.by.PETRJ400, pI = UI.E.by.PETRV370, Kc = cI.strike, Kp = pI.strike, c = cI.prevClose, p = pI.prevClose, lo = S0 * 0.8, hi = S0 * 1.2;
  const card = (t, why, nums, fn, K, risk) => `<article class="card st-card"><div><h4>${t}</h4><p>${why}</p><div class="st-nums">${nums.map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('')}</div><p class="st-risk">${risk}</p></div>${payoffSVG(fn, lo, hi, [{ x: K, t: `strike ${fnum(K, 2)}` }])}</article>`;
  return card('Comprar uma call', `Para apostar na alta arriscando só o prêmio. Você paga ${brl(c)} pela ${cI.ticker} e ganha se PETR4 passar de ${brl(Kc + c)} no vencimento.`,
      [['Ganho máximo', 'sem limite'], ['Perda máxima', brl(c)], ['Equilíbrio', brl(Kc + c)]], x => Math.max(0, x - Kc) - c, Kc,
      'Se PETR4 não subir o bastante até o vencimento, o prêmio inteiro se perde.') +
    card('Put de proteção', `Para quem tem a ação e quer um seguro contra a queda. Com PETR4 comprada a ${brl(S0)}, você paga ${brl(p)} pela ${pI.ticker} e garante vender por ${brl(Kp)}.`,
      [['Ganho máximo', 'sem limite'], ['Perda máxima', brl(S0 - Kp + p)], ['Equilíbrio', brl(S0 + p)]], x => (x - S0) + Math.max(0, Kp - x) - p, Kp,
      'O seguro custa o prêmio, pago mesmo que a ação não caia.') +
    card('Venda coberta', `Para quem tem a ação e aceita vendê-la pelo strike em troca do prêmio. Com PETR4 comprada a ${brl(S0)}, você recebe ${brl(c)} pela ${cI.ticker}.`,
      [['Ganho máximo', brl(Kc - S0 + c)], ['Perda máxima', `${brl(S0 - c)}*`], ['Equilíbrio', brl(S0 - c)]], x => (x - S0) - Math.max(0, x - Kc) + c, Kc,
      '* Se a ação fosse a zero; o prêmio só amortece a queda. E se a ação disparar, você entrega pelo strike e fica de fora da alta acima dele.') +
    card('Venda de put', `Para quem aceita comprar a ação pelo strike e quer receber para esperar. Você recebe ${brl(p)} pela ${pI.ticker}.`,
      [['Ganho máximo', brl(p)], ['Perda máxima', `${brl(Kp - p)}*`], ['Equilíbrio', brl(Kp - p)]], x => p - Math.max(0, Kp - x), Kp,
      '* Se a ação fosse a zero. Se ela despencar, você é obrigado a comprar pelo strike, e a posição exige garantias na bolsa.');
}
function syncLab() {
  $('labS').value = LAB.S; $('labK').value = LAB.K; $('labT').value = LAB.Td; $('labV').value = Math.round(LAB.v * 100); $('labR').value = LAB.r * 100;
  for (const b of $('labType').children) b.classList.toggle('on', b.dataset.v === LAB.cp);
  for (const b of $('labSide').children) b.classList.toggle('on', +b.dataset.v === LAB.side);
  labUpdate();
}
function labPreset(k) {
  const d = CONFIG.instruments.find(x => x.ticker === (k === 'put' ? 'PETRV370' : 'PETRJ400')), P = UI.E.by.PETR4;
  Object.assign(LAB, { cp: d.cp, side: 1, K: d.strike, v: d.iv, Td: CONFIG.option.daysToExpiry, r: CONFIG.option.r, S: Math.round(P.refT() * P.tick / 0.05) * 0.05 });
  syncLab();
}
function drawLab() {
  const cv = $('labChart'); if (!cv || !LAB.res) return;
  const { ctx, w: W, h: H } = fitSmall(cv), P = UI.pal; if (W < 80 || H < 80) return;
  const { cp, side, S, K, Td, v, r } = LAB, prem = LAB.res.price, T = Td / 252;
  const lo = Math.max(0.01, Math.min(S, K) * 0.72), hi = Math.max(S, K) * 1.28, n = Math.max(60, Math.min(240, Math.floor(W / 3)));
  const pay = x => side * (Math.max(0, cp === 'C' ? x - K : K - x) - prem), now = x => side * (bsPrice(cp, x, K, T, r, v) - prem);
  const xs = [], A = [], B = [];
  for (let j = 0; j <= n; j++) { const x = lo + (hi - lo) * j / n; xs.push(x); A.push(pay(x)); B.push(now(x)); }
  let y0 = Math.min(0, ...A, ...B), y1 = Math.max(0, ...A, ...B); const pad = (y1 - y0) * 0.1 || 0.5; y0 -= pad; y1 += pad;
  const padL = 48, padR = 12, padT = 22, padB = 24, pw = W - padL - padR, ph = H - padT - padB;
  const X = x => padL + (x - lo) / (hi - lo) * pw, Y = y => padT + (1 - (y - y0) / (y1 - y0)) * ph;
  ctx.font = '11px ' + FONT; ctx.lineWidth = 1;
  const ys = niceStep(y1 - y0, Math.max(3, ph / 42)); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / ys) * ys; y <= y1; y += ys) { const yy = Math.round(Y(y)) + 0.5; ctx.strokeStyle = rgba(P.line2, 0.35); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + pw, yy); ctx.stroke(); ctx.fillStyle = P.faint; ctx.fillText(fnum(Math.abs(y) < ys * 1e-6 ? 0 : y, ys < 1 ? 2 : 0), padL - 6, yy); }
  const xst = niceStep(hi - lo, Math.max(3, pw / 90)); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = Math.ceil(lo / xst) * xst; x <= hi; x += xst) { ctx.fillStyle = P.faint; ctx.fillText(fnum(x, xst < 1 ? 2 : 0), X(x), padT + ph + 6); }
  // lucro (verde) e prejuízo (vermelho) do resultado no vencimento
  const zy = Y(0), area = () => { ctx.beginPath(); ctx.moveTo(X(xs[0]), zy); for (let j = 0; j <= n; j++) ctx.lineTo(X(xs[j]), Y(A[j])); ctx.lineTo(X(xs[n]), zy); ctx.closePath(); };
  ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, pw, zy - padT); ctx.clip(); area(); ctx.fillStyle = rgba(P.up, 0.14); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(padL, zy, pw, padT + ph - zy); ctx.clip(); area(); ctx.fillStyle = rgba(P.down, 0.12); ctx.fill(); ctx.restore();
  ctx.strokeStyle = P.muted; ctx.beginPath(); ctx.moveTo(padL, Math.round(zy) + 0.5); ctx.lineTo(padL + pw, Math.round(zy) + 0.5); ctx.stroke();
  // strike (no alto) e equilíbrio (embaixo)
  const vline = (x, col, dash, label, top) => {
    if (x < lo || x > hi) return; const xx = Math.round(X(x)) + 0.5, right = xx > padL + pw - 110;
    ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 11px ' + FONT; ctx.fillStyle = col; ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = top ? 'bottom' : 'top';
    ctx.fillText(label, xx + (right ? -5 : 5), top ? padT - 5 : padT + ph - 16); ctx.font = '11px ' + FONT;
  };
  vline(K, P.amber, [4, 3], `strike ${fnum(K, 2)}`, true);
  vline(LAB.res.be, P.muted, [1, 3], `equilíbrio ${fnum(LAB.res.be, 2)}`, false);
  // curvas: hoje (tracejada) e no vencimento (cheia)
  const curve = (V, col, w, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.lineJoin = 'round'; ctx.beginPath(); for (let j = 0; j <= n; j++) { const px = X(xs[j]), py = Y(V[j]); if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; };
  curve(B, P.accent, 1.8, [6, 4]); curve(A, P.text, 2.2, []);
  // preço atual do ativo, na curva de hoje
  if (S >= lo && S <= hi) {
    const px = X(S), py = Y(now(S)); ctx.fillStyle = P.panel; ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fill(); ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
    ctx.font = '600 11px ' + FONT; ctx.fillStyle = P.accent; ctx.textAlign = px > padL + pw - 110 ? 'right' : 'left'; ctx.textBaseline = py < padT + 24 ? 'top' : 'bottom';
    ctx.fillText(`ativo hoje ${fnum(S, 2)}`, px + (ctx.textAlign === 'right' ? -8 : 8), py + (ctx.textBaseline === 'top' ? 8 : -8));
  }
}
function wireOptions() {
  const bind = (id, f) => $(id).addEventListener('input', () => { f(+$(id).value); labUpdate(); });
  bind('labS', x => { LAB.S = x; }); bind('labK', x => { LAB.K = x; }); bind('labT', x => { LAB.Td = x; }); bind('labV', x => { LAB.v = x / 100; }); bind('labR', x => { LAB.r = x / 100; });
  for (const b of $('labType').children) b.onclick = () => { LAB.cp = b.dataset.v; syncLab(); };
  for (const b of $('labSide').children) b.onclick = () => { LAB.side = +b.dataset.v; syncLab(); };
  $('labLive').onclick = () => { const P = UI.E.by.PETR4; LAB.S = Math.round(P.refT() * P.tick / 0.05) * 0.05; syncLab(); };
  $('opcoes').addEventListener('click', e => {
    const h = e.target.closest('.op-ch-h'); if (h) { toggleChapter(h.closest('.op-ch').id); return; }
    const pre = e.target.closest('[data-pre]'); if (pre) { labPreset(pre.dataset.pre); return; }
    const les = e.target.closest('[data-les]'); if (les) { startLesson(les.dataset.les); markTab('grafico'); goSection('colCenter', true); return; }
    const foc = e.target.closest('[data-focus]'); if (foc) { exitLesson(); setFocus(foc.dataset.focus); markTab('grafico'); goSection('colCenter', true); }
  });
  $('opcoes').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const h = e.target.closest('.op-ch-h'); if (!h) return;
    e.preventDefault(); toggleChapter(h.closest('.op-ch').id);
  });
  syncOpToc();
  $('opChain').addEventListener('click', e => {
    const td = e.target.closest('td[data-cp]'); if (!td) return;
    LAB.cp = td.dataset.cp; LAB.K = +td.dataset.k; syncLab();
    if ($('opLab').getBoundingClientRect().top < 0) $('opLab').scrollIntoView({ block: 'start', behavior: UI.reduced ? 'auto' : 'smooth' });
  });
  try { const ro = new ResizeObserver(() => redrawGuide()); for (const id of ['labChartWrap', 'opDecayWrap', 'opVolcWrap', 'opStorySWrap', 'opStoryPWrap']) ro.observe($(id)); } catch (e) { /* sem ResizeObserver: fica o evento de resize */ }
  window.addEventListener('resize', () => redrawGuide());
}
function redrawGuide() { drawLab(); drawDecay(); drawVolc(); drawStory(); }
function showSummary() {
  const E = UI.E; UI.paused = true;
  openModal(`<div class="modal-h"><h2>Fim do pregão</h2><button class="btn" data-close>Fechar</button></div>
  <div class="modal-b"><div class="sum-grid nums" style="padding:0">${numsHTML()}</div>
  <h3>Linha do tempo do dia</h3><div class="sum-tl"><div class="tl-wrap" style="position:relative"><canvas id="tlSum"></canvas></div></div></div>
  <div class="modal-f"><button class="btn" id="mRep">Repetir este pregão</button><button class="btn primary" id="mNew">Novo pregão</button></div>`);
  requestAnimationFrame(() => drawTimeline($('tlSum'), true));
  $('mRep').onclick = () => { closeModal(); exitLesson(); newSession(UI.seed); };
  $('mNew').onclick = () => { closeModal(); exitLesson(); newSession(rndSeed()); };
}

/* ----------------------------- tour ----------------------------- */
const TOUR = [
  { el: 'colMap', tab: 'mercado', h: 'Mapa do pregão', p: 'Cada bloco é um ativo. Borda dourada com anel: em leilão. Tracejado: call. Cinza hachurado: parado. Quem entra em leilão sobe para a faixa do topo. Toque num bloco para colocá-lo em foco.' },
  { el: 'chartWrap', tab: 'grafico', h: 'Gráfico-túnel', p: 'O preço anda em degraus dentro do tubo dourado, o túnel de leilão. Se um negócio sairia fora dele, abre-se um bloco de leilão. A área vinho é onde as ofertas são recusadas; a faixa verde-petróleo é a proteção.' },
  { el: 'reguaWrap', tab: 'grafico', h: 'Régua de túneis', p: 'Cada oferta nova entra pela direita até o seu preço. Aceita vira um traço; rejeitada bate na parede vinho e ricocheteia; a que geraria negócio fora do túnel fecha o portão dourado.' },
  { el: 'panelBox', tab: 'grafico', h: 'Painel do leilão', p: 'Durante um leilão: contagem regressiva, preço teórico, faixa de proteção e as quatro luzes que explicam cada prorrogação. Fora dele, este espaço mostra os limites de cada túnel agora.' }
];
let tourK = -1;
function maybeTour() { let seen = false; try { seen = localStorage.getItem('b3tuneis.tour.v1') === '1'; } catch (e) { seen = false; } if (!seen) setTimeout(() => { if (!LS.les) tourStep(0); }, 700); }
function tourStep(k) {
  const ring = $('tourRing'), box = $('tour');
  if (k >= TOUR.length || k < 0) { tourK = -1; ring.hidden = true; box.hidden = true; try { localStorage.setItem('b3tuneis.tour.v1', '1'); } catch (e) { /* sem armazenamento: tudo bem */ } return; }
  tourK = k; const s = TOUR[k];
  box.innerHTML = `<h4>${s.h}</h4><p>${s.p}</p><div class="tf"><span>${k + 1} de ${TOUR.length}</span><div style="display:flex;gap:6px"><button class="btn" id="tSkip">Pular</button><button class="btn primary" id="tNext">${k === TOUR.length - 1 ? 'Começar' : 'Próximo'}</button></div></div>`;
  box.hidden = false; ring.hidden = false;
  $('tSkip').onclick = () => tourStep(99); $('tNext').onclick = () => tourStep(k + 1);
  // traz o alvo para a tela; o anel e o cartão acompanham a rolagem (tourPlace)
  const el = $(s.el), r = el.getBoundingClientRect(), vh = window.innerHeight;
  if (r.top < barBottom() || r.bottom > vh - 8) el.scrollIntoView({ block: r.height > vh * 0.6 ? 'start' : 'center', behavior: UI.reduced ? 'auto' : 'smooth' });
  tourPlace();
}
function tourPlace() {
  if (tourK < 0) return;
  const ring = $('tourRing'), box = $('tour'), r = $(TOUR[tourK].el).getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  const y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, vh);
  Object.assign(ring.style, { left: r.left - 3 + 'px', top: y0 - 3 + 'px', width: r.width + 6 + 'px', height: Math.max(0, y1 - y0) + 6 + 'px' });
  const bw = Math.min(320, vw - 24); box.style.maxWidth = bw + 'px';
  const bh = box.offsetHeight;
  let left = r.right + 12, top = r.top + 12;
  if (left + bw > vw - 8) left = Math.max(12, Math.min(vw - bw - 12, r.left + 12));
  if (left < r.right && left + bw > r.left) { top = r.bottom + 10 + bh > vh - 8 ? Math.max(12, r.top + 12) : r.bottom + 10; if (r.height > vh * 0.5) top = Math.max(12, Math.min(vh - bh - 12, r.top + r.height * 0.5 - bh / 2)); }
  box.style.left = left + 'px'; box.style.top = clamp(top, 12, Math.max(12, vh - bh - 12)) + 'px';
}

/* ----------------------------- aviso rápido ----------------------------- */
let toastT = null;
function showToast(msg, ms) {
  const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT);
  if (ms !== 0) toastT = setTimeout(() => { el.hidden = true; }, ms || 5200);
}
function hideToast() { clearTimeout(toastT); $('toast').hidden = true; }

/* ----------------------------- cenários ----------------------------- */
const SCEN = [
  { k: 'ffPrice', t: 'Dedo gordo no preço', d: 'Oferta com preço 10 vezes maior bate no túnel de rejeição' },
  { k: 'ffQty', t: 'Dedo gordo na quantidade', d: 'Quantidade acima do limite por oferta é recusada' },
  { k: 'whale', t: 'Baleia varre o livro', d: 'Ordem grande atravessa o túnel do último preço' },
  { k: 'escada', t: 'Escada de negócios', d: 'Cada passo passa no último preço; a soma estoura a média' },
  { k: 'qtyAuction', t: 'Leilão por quantidade', d: 'Oferta muito acima do normal abre leilão de 5 min' },
  { k: 'news', t: 'Notícia forte', d: 'Valor justo salta; teórico fora da proteção prorroga' },
  { k: 'optjump', t: 'Salto em PETR4 mexe nas opções', d: 'O túnel da opção se desloca sem negócio nela' },
  { k: 'cheap', t: 'Ação barata: amplitude mínima', d: 'PQNO3: 1,5% daria R$ 0,03; vale R$ 0,10' },
  { k: 'cb', t: 'Circuit breaker', d: 'Queda generalizada até o Ibovespa cair 10%' },
  '-',
  { k: 'gap', t: 'Notícia na madrugada', d: 'Novo pregão: PETR4 abre com gap e o call prorroga' },
  { k: 'close', t: 'Fechamento disputado', d: 'Vai para 16:54; o call de fechamento prorroga' },
  { k: 'after', t: 'Ir para o after-market', d: 'Vai para 17:29; oscilação máxima de ±2%' }
];
function buildScenMenu() {
  $('mScen').innerHTML = SCEN.map(s => s === '-' ? '<hr>' : `<button role="menuitem" data-k="${s.k}">${s.t}<small>${s.d}</small></button>`).join('');
}
function needCont(i) {
  if (i.state === ST.CONT) return true;
  const E = UI.E;
  showToast(E.t < E.T.open && !i.isFut ? `${i.ticker} ainda não está em negociação contínua. Use "Pular para 10:00" e tente de novo.` : `${i.ticker} precisa estar em negociação contínua (agora: ${stateText(i).toLowerCase()}).`);
  return false;
}
function runScenario(k) {
  exitLesson();
  const E = UI.E; let i = UI.focus; const dir = Math.random() < 0.5 ? 1 : -1;
  switch (k) {
    case 'ffPrice': E.doFFPrice(i, 1); showToast(`${i.ticker}: compra digitada a 10 vezes o preço. Veja a faísca vinho no gráfico, o ricochete na régua e a linha no feed.`); break;
    case 'ffQty': E.doFFQty(i, dir); showToast(`${i.ticker}: quantidade acima de ${fq(i.qtyReject)} ${unitQ(i)} é recusada na entrada, antes de qualquer checagem de preço.`); break;
    case 'whale': if (!needCont(i)) return; E.doWhale(i, dir); showToast(`${i.ticker}: a baleia varre o livro; o negócio que sairia além do tubo dourado vira leilão.`); break;
    case 'escada': {
      if (!i.g.med) { setFocus('PETR4'); i = UI.focus; }
      if (!needCont(i)) return; E.doEscada(i, dir);
      showToast(`Escada em ${i.ticker}: observe a linha índigo (média de ${CONFIG.vwapWindowSec} s). Os degraus passam no tubo dourado, mas a soma estoura o túnel de preço médio.`, 8000); break;
    }
    case 'qtyAuction': if (!needCont(i)) return; E.doQtyAuction(i, dir); showToast(`${i.ticker}: oferta acima de ${fq(i.qtyAuction)} ${unitQ(i)} abre leilão por quantidade. A mesma corretora concentrando lotes também aciona a proteção por quantidade.`, 8000); break;
    case 'news': {
      if (i.isOpt) { setFocus(i.underlying); i = UI.focus; }
      if (!needCont(i)) return;
      if (i.type === 'etf') { E.doMacro(dir, 0.03); showToast('ETF segue a carteira: a notícia veio para o mercado todo.'); }
      else { E.doNews(i, dir, i.tunnelGroup === 'DI1' ? 0.3 : (i.isFut ? 0.025 : 0.065)); showToast(`${i.ticker}: o valor justo saltou. O leilão abre, e se o teórico ficar fora da faixa verde-petróleo de proteção, o fim é prorrogado.`, 8000); }
      break;
    }
    case 'optjump': {
      const u = E.by.PETR4; if (!needCont(u)) return;
      setFocus('PETRJ400'); E.doNews(u, 1, 0.045);
      showToast('PETR4 salta ~4,5%. Em PETRJ400 o centro do túnel (teórico) sobe na hora, sem negócio na opção; as ofertas antigas ficam para trás. Compare com o mini-gráfico de PETR4.', 9000); break;
    }
    case 'cheap': {
      setFocus('PQNO3'); const q = UI.focus;
      showToast('PQNO3 custa R$ 1,85: 1,5% daria só R$ 0,03 por lado. Vale a amplitude mínima de R$ 0,10 (veja "Limites agora" e o tubo dourado).', 9000);
      if (q.state === ST.CONT) setTimeout(() => { if (UI.E === E && q.state === ST.CONT) E.doWhale(q, dir); }, 1500);
      break;
    }
    case 'cb': {
      const go = () => { E.startCrash(); UI.slowmo = false; $('cSlow').checked = false; setSpeed('rapido'); showToast('Estresse simulado: o valor justo de todo o mercado cai. Ações passam por leilões até o Ibovespa chegar a −10% e o circuit breaker parar tudo. Câmera lenta desligada.', 9000); };
      if (E.t < E.T.open + 300) { jumpTo(E.T.open + 300, 'Indo para 10:05…', go); } else if (E.t >= E.T.closeCall - 1800) { showToast('Tarde demais para o circuit breaker hoje (ele não vale no fim do pregão). Comece um novo pregão.'); } else go();
      break;
    }
    case 'gap': {
      newSession(rndSeed(), { gapTicker: 'PETR4', gapPct: 0.075, focus: 'PETR4' });
      jumpTo(DAY('09:58:30'), 'Indo para 09:58:30…', () => showToast('PETR4 teve notícia durante a madrugada: o teórico do call está ~7,5% acima do fechamento, além da proteção dos calls (±5%). Às 10:00 a abertura é prorrogada.', 9000));
      break;
    }
    case 'close': {
      if (i.isFut || i.state === ST.CLOSED) { setFocus('PETR4'); i = UI.focus; }
      const tk = i.ticker;
      if (E.t >= E.T.closeCall - 30) { showToast('O call de fechamento já começou. Para repetir, comece um novo pregão.'); return; }
      E.forceLate = tk;
      jumpTo(DAY('16:54:00'), 'Indo para 16:54…', () => showToast(`${tk}: ofertas tardias vão chegar nas janelas finais do call de fechamento. Veja a escada de prorrogações (60, 30 e 15 s) no painel do leilão.`, 9000));
      break;
    }
    case 'after': {
      if (E.t >= DAY('17:59')) { showToast('O after-market de hoje já acabou.'); return; }
      jumpTo(DAY('17:29:30'), 'Indo para 17:29:30…', () => { const f = UI.focus; if (!(f.type === 'stock' && f.tunnelGroup === 'IBOV')) setFocus('PETR4'); showToast('After-market: só ações do Ibovespa/IBrX-100, dentro de ±2% do fechamento. Tente enviar uma oferta fora da faixa pela boleta.', 9000); });
      break;
    }
  }
}

/* ----------------------------- foco, sessão, abas ----------------------------- */
function rndSeed() { return (Math.random() * 4294967296) >>> 0; }
function setFocus(tk) {
  const E = UI.E, i = E.by[tk]; if (!i) return;
  UI.focus = i; E.focusTk = tk;
  const ch = UI.chart; ch.yTk = null; ch.ymin = NaN; ch.live = true; ch.hover = null;
  UI.parts = []; UI.sparks = []; UI.reg.base = null; UI.gate.v = inAuctionLike(i) ? 1 : 0; UI.lights = {};
  $('miniWrap').hidden = !i.isOpt; if (i.isOpt) setText('miniLbl', `${i.underlying}, ativo-objeto (mesmo eixo de tempo)`);
  UI.panelKey = null; UI.ttKey = null; UI.metaKey = null;
  buildLegendChips(); setBolDefaults();
  refreshDOM(true);
}
function buildLegendChips() {
  const i = UI.focus, sh = UI.chart.show, m = UI.mobile, items = [['ult', m ? 'Leilão' : (i.isOpt ? 'Leilão (assíncrono)' : (i.g.stepped ? 'Leilão (em degraus)' : 'Túnel de leilão'))], ['med', m ? 'Médio' : 'Preço médio'], ['est', 'Estático'], ['rej', 'Rejeição'], ['prot', 'Proteção']]
    .filter(([k]) => !((k === 'med' && !i.g.med) || (k === 'est' && !i.g.est)));
  $('chartLegend').innerHTML = items.map(([k, t]) => `<button class="lg ${k}${sh[k] ? '' : ' off'}" data-k="${k}" aria-pressed="${sh[k]}"><i></i>${t}</button>`).join('');
  requestAnimationFrame(syncPadT);
}
function syncPadT() { const h = $('chartLegend').offsetHeight; if (h > 0) UI.chart.padT = Math.round(h + 12); }
function newSession(seed, opts) {
  opts = opts || {};
  UI.seed = seed >>> 0; UI.ff = null; hideToast();
  const E = new Engine(UI.seed, { intensity: opts.intensity || UI.intensity, gapTicker: opts.gapTicker, gapPct: opts.gapPct });
  UI.E = E; E.silent = true;
  const start = DAY(CONFIG.startTime);
  while (E.t < start - 1e-9) E.step(Math.min(1, start - E.t));
  E.silent = false; E.events.length = 0;
  UI.acc = 0; UI.summaryShown = false; UI.lastFeedId = 0; UI.own = []; UI.cbMin = false; UI.ownKey = ''; UI.paused = false;
  $('feed').innerHTML = ''; setText('myoMsg', '');
  buildMap();
  UI.focus = E.by.PETR4;
  setFocus(opts.focus || 'PETR4');
}
/* ----------------------------- página: rolagem até as seções e partes à vista ----------------------------- */
const TAB_SEC = { mercado: 'colMap', grafico: 'colCenter', livro: 'colRight', eventos: 'bottom' };
function barBottom() { const r = $('bar').getBoundingClientRect(); return Math.max(0, r.bottom); }
function markTab(t) {
  UI.tab = t; document.body.dataset.tab = t;
  for (const b of $('mtabs').children) b.classList.toggle('on', b.dataset.t === t);
  for (const b of $('segCompact').children) b.classList.toggle('on', b.dataset.v === t);
  applyCompact();
}
/* ----------------------------- modo compacto (desktop): um painel do simulador por vez -----------------------------
   Opcional (fica salvo neste navegador). Reaproveita o mesmo UI.tab que já existe para o rodapé do celular. */
const COMPACT_KEY = 'b3tuneis.compacto';
function readCompact() { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch (e) { return false; } }
function applyCompact() {
  const on = UI.compact, t = UI.tab;
  $('colMap').hidden = on && t !== 'mercado';
  $('focusGrid').hidden = on && t !== 'grafico' && t !== 'livro';
  $('focusGrid').classList.toggle('solo', on && (t === 'grafico' || t === 'livro'));
  $('colCenter').hidden = on && t === 'livro';
  $('colRight').hidden = on && t === 'grafico';
  $('eventsGrid').hidden = on && t !== 'eventos';
}
function setCompact(on) {
  UI.compact = on;
  try { localStorage.setItem(COMPACT_KEY, on ? '1' : '0'); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
  $('bCompact').setAttribute('aria-pressed', String(on));
  $('bCompact').classList.toggle('primary', on);
  $('bCompact').textContent = on ? 'Ver tudo' : 'Modo compacto';
  $('segCompact').hidden = !on;
  applyCompact();
}
/* rola até a seção; sem 'force', não mexe se o topo dela já estiver na metade de cima da tela */
function goSection(id, force) {
  const el = $(id); if (!el) return;
  if (!force) { const r = el.getBoundingClientRect(); if (r.top >= barBottom() - 4 && r.top <= window.innerHeight * 0.45) return; }
  el.scrollIntoView({ block: 'start', behavior: UI.reduced ? 'auto' : 'smooth' });
}
function setTab(t) { markTab(t); goSection(TAB_SEC[t], true); }
function showFocus() { markTab('grafico'); goSection('colCenter'); }
/* ----------------------------- páginas de conteúdo: Aulas, Como funciona, Opções, Parâmetros -----------------------------
   Só uma fica visível por vez, escolhida pelo menu principal. O simulador (acima) continua sempre à vista;
   é só o material de leitura, abaixo dele, que passa a abrir um de cada vez, em vez de tudo empilhado. */
const PAGE_IDS = ['aulas', 'como-funciona', 'opcoes', 'parametros'];
function openPage(id) {
  if (PAGE_IDS.indexOf(id) === -1) return;
  for (const pid of PAGE_IDS) { const el = $(pid); if (el) el.hidden = pid !== id; }
  syncSiteNav();
  goSection(id, true);
}
function syncSiteNav() {
  for (const a of document.querySelectorAll('.site-nav a')) {
    const id = a.getAttribute('href').slice(1), el = $(id);
    const on = PAGE_IDS.indexOf(id) !== -1 && el && !el.hidden;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}
let pageQ = false;
function onPage() { if (!pageQ) { pageQ = true; requestAnimationFrame(pageTick); } }
function pageTick() {
  pageQ = false;
  const vh = window.innerHeight, near = id => { const r = $(id).getBoundingClientRect(); return r.bottom > -150 && r.top < vh + 150; };
  const V = UI.vis; V.map = near('colMap'); V.focus = near('colCenter'); V.rail = near('colRight'); V.trades = near('secTrades'); V.events = near('bottom');
  const s = $('simulador').getBoundingClientRect(), inSim = s.top < vh * 0.6 && s.bottom > vh * 0.4;
  document.body.classList.toggle('in-sim', inSim);
  if (inSim && !UI.tourAsked) { UI.tourAsked = true; maybeTour(); }
  if (UI.mobile && !UI.compact) { // atalhos do rodapé acompanham a seção à vista; no modo compacto só o clique manda
    const y = vh * 0.4, top = barBottom(); let cur = null;
    for (const t in TAB_SEC) { const r = $(TAB_SEC[t]).getBoundingClientRect(); if (r.top <= y && r.bottom > top + 40) cur = t; }
    if (cur && cur !== UI.tab) markTab(cur);
  }
  lesPlace(); tourPlace();
}
function setSpeed(v) { UI.speed = v; for (const b of $('segSpeed').children) b.classList.toggle('on', b.dataset.v === v); }
function setZoomButtons() { const ch = UI.chart, v = ch.day ? 'day' : String(ch.zoom); for (const b of $('segZoom').children) b.classList.toggle('on', b.dataset.v === v); }
function setMobile() {
  UI.mobile = window.matchMedia('(max-width: 1023px)').matches;
  if (!document.body.dataset.tab) document.body.dataset.tab = UI.tab;
}

/* ----------------------------- ligações ----------------------------- */
function wire() {
  $('bPause').onclick = () => togglePause();
  for (const b of $('segSpeed').children) b.onclick = () => setSpeed(b.dataset.v);
  $('cSlow').onchange = e => { UI.slowmo = e.target.checked; };
  $('bScen').onclick = e => { e.stopPropagation(); const open = $('mScen').hidden; closeMenus(); $('mScen').hidden = !open; $('bScen').setAttribute('aria-expanded', String(open)); };
  $('mScen').onclick = e => { const b = e.target.closest('button[data-k]'); if (!b) return; closeMenus(); runScenario(b.dataset.k); showFocus(); };
  document.addEventListener('click', e => { if (!e.target.closest('.dd')) closeMenus(); });
  for (const b of $('segInt').children) b.onclick = () => { UI.intensity = b.dataset.v; UI.E.setIntensity(b.dataset.v); for (const x of $('segInt').children) x.classList.toggle('on', x === b); };
  $('bSkip').onclick = () => exitLesson() || jumpTo(UI.E.T.open, 'Pulando para 10:00…', () => showToast('10:00: fim do call de abertura. Quem teve alteração no último minuto ou teórico fora da proteção foi prorrogado.', 7000));
  $('bNew').onclick = () => { exitLesson(); newSession(rndSeed()); };
  $('bLegend').onclick = () => openPage('como-funciona');
  $('bCompact').onclick = () => setCompact(!UI.compact);
  for (const b of $('segCompact').children) b.onclick = () => setTab(b.dataset.v);
  // links internos (cabeçalho, abertura): abre a página certa (se for o caso) e rola até a seção
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const id = a.getAttribute('href').slice(1); if (!id || !$(id)) return;
    e.preventDefault();
    if (PAGE_IDS.indexOf(id) !== -1) { openPage(id); return; }
    if (/^op-\d$/.test(id)) openChapter(id);
    goSection(id, true);
  });
  window.addEventListener('scroll', onPage, { passive: true });
  window.addEventListener('resize', onPage);
  $('modalOver').addEventListener('click', e => { if (e.target === $('modalOver') || e.target.closest('[data-close]')) closeModal(); });
  for (const b of $('segMap').children) b.onclick = () => { UI.mapView = b.dataset.v; for (const x of $('segMap').children) x.classList.toggle('on', x === b); $('mapGroups').hidden = UI.mapView !== 'blocos'; $('aucStrip').hidden = UI.mapView !== 'blocos'; $('mapList').hidden = UI.mapView !== 'lista'; updateMap(); };
  $('mapList').addEventListener('click', e => { const tr = e.target.closest('tr[data-tk]'); if (tr) { setFocus(tr.dataset.tk); showFocus(); } });
  for (const b of $('segZoom').children) b.onclick = () => { const v = b.dataset.v, ch = UI.chart; if (v === 'day') ch.day = true; else { ch.day = false; ch.zoom = +v; ch.live = true; } ch.ymin = NaN; setZoomButtons(); };
  $('bLive').onclick = () => { const ch = UI.chart; ch.live = true; if (ch.day) { ch.day = false; } ch.ymin = NaN; setZoomButtons(); };
  $('bFull').onclick = () => { const ch = UI.chart; ch.full = !ch.full; $('bFull').setAttribute('aria-pressed', String(ch.full)); $('bFull').classList.toggle('primary', ch.full); };
  $('chartLegend').onclick = e => { const b = e.target.closest('.lg'); if (!b) return; const k = b.dataset.k; UI.chart.show[k] = !UI.chart.show[k]; b.classList.toggle('off', !UI.chart.show[k]); b.setAttribute('aria-pressed', String(UI.chart.show[k])); };
  // gráfico: arrastar para o passado, mira com mouse ou toque
  const w = $('chartWrap');
  w.addEventListener('pointerdown', e => { if (e.target.closest('.chart-legend')) return; UI.chart.drag = { x: e.clientX, end: UI.chart.viewEnd, moved: false, id: e.pointerId }; });
  w.addEventListener('pointermove', e => {
    const r = w.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = UI.chart.drag, ch = UI.chart;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 6) { d.moved = true; try { w.setPointerCapture(e.pointerId); } catch (er) { /* ok */ } }
      if (d.moved && !ch.day) { ch.live = false; const lo = UI.E.T.fPre + ch.span * 0.5, hi = UI.E.t + ch.span * 0.6; ch.viewEnd = clamp(d.end - dx / ch.pw * ch.span, lo, hi); ch.hover = null; }
    }
    if (e.pointerType === 'mouse' && !(d && d.moved)) ch.hover = { x, y };
  });
  const up = e => { const d = UI.chart.drag; UI.chart.drag = null; if (d && !d.moved && e.pointerType !== 'mouse' && e.type === 'pointerup') { const r = w.getBoundingClientRect(); UI.chart.hover = UI.chart.hover ? null : { x: e.clientX - r.left, y: e.clientY - r.top }; } };
  w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
  w.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') UI.chart.hover = null; });
  w.addEventListener('dblclick', () => { UI.chart.live = true; UI.chart.day = false; setZoomButtons(); });
  // boleta
  for (const b of $('bolSide').children) b.onclick = () => { setBolSide(+b.dataset.s); updateBoleta(); };
  for (const b of $('bolType').children) b.onclick = () => { if (b.disabled) return; setBolType(+b.dataset.t); updateBoleta(); };
  $('bolP').addEventListener('input', updateBoleta); $('bolQ').addEventListener('input', updateBoleta);
  $('bolQ').addEventListener('blur', () => { const q = parseQty($('bolQ').value); if (q) $('bolQ').value = fq(q); });
  $('bolShorts').onclick = e => { const b = e.target.closest('button[data-k]'); if (b) bolShortcut(b.dataset.k); };
  $('bookBody').onclick = e => { const r = e.target.closest('.br[data-p]'); if (r) bookPick(+r.dataset.p, +r.dataset.s); };
  $('bolSend').onclick = sendOrder;
  $('myoList').onclick = e => { const b = e.target.closest('button[data-a]'); if (b) ownAction(b.dataset.a, b.dataset.tk, +b.dataset.id); };
  // rodapé
  for (const b of $('btabs').querySelectorAll(':scope > button')) b.onclick = () => {
    UI.btab = b.dataset.v; for (const x of $('btabs').querySelectorAll(':scope > button')) x.classList.toggle('on', x === b);
    $('paneFeed').hidden = UI.btab !== 'feed'; $('paneTl').hidden = UI.btab !== 'timeline'; $('paneNums').hidden = UI.btab !== 'numeros'; $('ffil').hidden = UI.btab !== 'feed';
    refreshDOM(true);
  };
  $('ffil').innerHTML = FEED_FILTERS.map(([k, t]) => `<button data-v="${k}" class="${k === 'todos' ? 'on' : ''}">${t}</button>`).join('');
  $('ffil').onclick = e => { const b = e.target.closest('button[data-v]'); if (!b) return; UI.feedFilter = b.dataset.v; applyFeedFilter(); };
  $('tl').addEventListener('click', e => {
    const cv = $('tl'), m = cv._tl; if (!m) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const row = Math.floor(y / m.rowH), i = UI.E.insts[row]; if (!i) return;
    setFocus(i.ticker);
    if (x > m.lab) goToTime(m.t0 + (x - m.lab) / (m.W - m.lab - 8) * (m.t1 - m.t0));
    showFocus();
  });
  for (const b of $('mtabs').children) b.onclick = () => setTab(b.dataset.t);
  $('cbMin').onclick = () => { UI.cbMin = true; updateCB(); };
  $('cbMini').onclick = () => { UI.cbMin = false; updateCB(); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('modalOver').hidden) closeModal(); closeMenus(); if (!$('tour').hidden) tourStep(99); }
    if (e.key === ' ' && !e.target.closest('input,button,select,textarea')) { e.preventDefault(); togglePause(); }
  });
  const mq = window.matchMedia('(max-width: 1023px)');
  const onMq = () => { setMobile(); buildLegendChips(); refreshDOM(true); };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
  const dm = window.matchMedia('(prefers-color-scheme: dark)'), repal = () => { readPalette(); buildLegendChips(); renderGuide(); redrawGuide(); };
  if (dm.addEventListener) dm.addEventListener('change', repal);
  try { new MutationObserver(repal).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* ok */ }
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)'); UI.reduced = rm.matches;
  if (rm.addEventListener) rm.addEventListener('change', () => { UI.reduced = rm.matches; });
}
function togglePause() {
  if (LS.les && !LS.running) { showToast('Durante a aula, o pregão avança pelo botão do cartão da aula.', 3500); return; }
  UI.paused = !UI.paused; refreshDOM(false);
}
function init() {
  readPalette();
  setMobile();
  UI.cc = mkCanvas('chart'); UI.rc = mkCanvas('regua'); UI.mc = mkCanvas('mini'); UI.dc = mkCanvas('daybar');
  try { new ResizeObserver(syncPadT).observe($('chartLegend')); } catch (e) { /* ok */ }
  buildScenMenu(); wire(); wireLessons(); setSpeed('normal'); setZoomButtons();
  for (const x of $('segInt').children) x.classList.toggle('on', x.dataset.v === UI.intensity);
  setCompact(readCompact());
  markTab('grafico');
  renderGuide(); renderLessons();
  setText('heroFacts', `${CONFIG.instruments.length} ativos fictícios · ${LESSONS.length} aulas guiadas · ${SCEN.filter(s => s !== '-').length} cenários prontos`);
  const setBarH = () => document.documentElement.style.setProperty('--barH', Math.round($('bar').offsetHeight) + 'px');
  setBarH(); try { new ResizeObserver(setBarH).observe($('bar')); } catch (e) { /* ok */ }
  newSession(rndSeed());
  renderOptions(); wireOptions(); labPreset('call');
  syncSiteNav();
  // link direto com #aulas, #opcoes, #op-4 etc.: abre a página (e o capítulo) certos antes de rolar
  const hash = location.hash.slice(1);
  if (PAGE_IDS.indexOf(hash) !== -1) openPage(hash);
  else if (/^op-\d$/.test(hash)) { openPage('opcoes'); openChapter(hash); goSection(hash, true); }
  requestAnimationFrame(frame);
  pageTick();                      // o tour começa quando o simulador aparece na tela
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildLegendChips());
}
