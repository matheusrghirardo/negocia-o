'use strict';
/* ============================================================================
   INTERFACE (parte 3): modo aula. Menu, cartão da aula, destaque e execução
   do roteiro. O motor chama LS via E.hook a cada passo de simulação, então a
   aula pausa exatamente no instante em que a condição do roteiro se cumpre.
   ============================================================================ */
const LS = { les: null, k: -1, ctx: null, running: false, runT0: 0, runMax: 900, next: null, fail: false, saved: null, hl: null, min: false, prep: false };
const LESSON_SCROLL = { chartWrap: 'colCenter', reguaWrap: 'colCenter', apLights: 'panelBox' }; // para onde rolar em cada destaque

/* aulas concluídas: ficam marcadas neste navegador (sem armazenamento, só nesta visita) */
const LES_DONE_KEY = 'b3tuneis.aulas.v1', lesDoneMem = new Set();
function lesDone() { const s = new Set(lesDoneMem); try { for (const id of JSON.parse(localStorage.getItem(LES_DONE_KEY) || '[]')) s.add(id); } catch (e) { /* sem armazenamento */ } return s; }
function lesMarkDone(id) {
  if (lesDone().has(id)) return;
  lesDoneMem.add(id);
  try { localStorage.setItem(LES_DONE_KEY, JSON.stringify([...lesDone()])); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
  renderLessons(); buildLesMenu();
}
function buildLesMenu() {
  const done = lesDone();
  const item = l => `<button role="menuitem" data-les="${l.id}">${LESSONS.indexOf(l) + 1}. ${l.title}${done.has(l.id) ? ' <span class="m-ok">✓</span>' : ''}<small>${l.sub}</small></button>`;
  $('mLes').innerHTML = '<div class="mnote">Micro-cenários guiados. O pregão pausa em cada etapa e explica, com os números da hora, o que aconteceu e por quê. Cada aula termina com um resumo e um teste rápido.</div>' +
    Object.keys(LES_GRP).map((g, k) => (k ? '<hr>' : '') + `<div class="mh">${LES_GRP[g].t}</div>` + LESSONS.filter(l => l.grp === g).map(item).join('')).join('');
}
function quizHTML() {
  const Q = LS.quiz; if (!Q) return '';
  const a = LS.qa;
  return `<div class="lq"><p class="lq-k">Teste rápido</p><p class="lq-q">${Q.q}</p><div class="lq-opts">` +
    Q.opts.map((o, j) => `<button class="lq-o${a == null ? '' : (j === Q.ok ? ' ok' : (j === a ? ' no' : ''))}" data-ls="quiz" data-o="${j}"${a != null ? ' disabled' : ''}>${o}</button>`).join('') + '</div>' +
    (a != null ? `<p class="lq-fb ${a === Q.ok ? 'ok' : 'no'}"><b>${a === Q.ok ? 'Isso.' : 'Não é essa.'}</b> ${Q.why}</p>` : '') + '</div>';
}
function closeMenus() {
  for (const [m, b] of [['mScen', 'bScen'], ['mLes', 'bLes']]) { $(m).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
}
function lesStep() { return LS.les ? LS.les.steps[LS.k] : null; }
function lesVal(v) { return typeof v === 'function' ? v(LS.ctx) : v; }

function startLesson(id) {
  const les = LESSONS.find(l => l.id === id); if (!les) return;
  if (!LS.les) LS.saved = { speed: UI.speed, slowmo: UI.slowmo, full: UI.chart.full };
  lesSetFull(false);               // toda aula começa na escala normal do gráfico
  closeMenus();
  if (!$('modalOver').hidden) closeModal();
  if (!$('tour').hidden) tourStep(99);
  if (UI.E) { UI.E.hook = null; }
  LS.les = les; LS.ctx = null; LS.k = -1; LS.running = false; LS.next = null; LS.fail = false; LS.prep = true; LS.min = false; LS.hl = null;
  newSession(les.seed, { gapTicker: les.gap.tk, gapPct: les.gap.pct, focus: les.focus, intensity: 'normal' });
  const E = UI.E; E.script = []; for (const tk of les.quiet) E.quiet.add(tk);
  LS.ctx = { E, les, i: E.by[les.focus], d: {} };
  UI.slowmo = false; $('cSlow').checked = false; setSpeed('normal');
  lesRender();
  jumpTo(DAY(les.start), 'Preparando a aula…', () => { if (LS.les !== les) return; LS.prep = false; lesShow(0); });
}
function lesShow(k) {
  const les = LS.les, c = LS.ctx; if (!les) return;
  while (k < les.steps.length - 1 && les.steps[k].skip && les.steps[k].skip(c)) k++;
  LS.k = k; LS.running = false; LS.fail = false; UI.E.hook = null; UI.paused = true;
  const st = les.steps[k]; LS.qa = null; LS.quiz = st.summary && les.quiz ? les.quiz(c) : null; // o teste é montado uma vez, com os números do fim da aula
  if (st.enter) st.enter(c);
  if (st.summary) lesMarkDone(les.id);
  if (UI.focus !== c.i) setFocus(les.focus);
  setSpeed('normal');
  lesRender(); refreshDOM(true); lesHighlight(les.steps[k].hl);
  const b = $('lsFoot').querySelector('.primary'); if (b && !UI.mobile) b.focus({ preventScroll: true });
}
function lesGo() {
  const s = lesStep(), c = LS.ctx; if (!s || LS.running || s.done) return;
  if (s.go) s.go(c);
  if (!s.run) { lesShow(LS.k + 1); return; }
  LS.running = true; LS.runT0 = c.E.t; LS.runMax = s.run.max || 900;
  setSpeed(s.run.speed || 'normal');
  c.E.hook = lesHook;
  lesHook();                       // a ação pode já ter cumprido a condição (ex.: leilão aberto na hora)
  if (LS.running) UI.paused = false;
  lesRender(); refreshDOM(false);
}
function lesHook() {
  const s = lesStep(), c = LS.ctx; if (!s || !s.run || !LS.running) return;
  if (s.run.tick) s.run.tick(c);
  if (s.run.until(c)) { c.E.hook = null; LS.running = false; UI.paused = true; LS.next = LS.k + 1; }
  else if (c.E.t - LS.runT0 > LS.runMax) { c.E.hook = null; LS.running = false; UI.paused = true; LS.fail = true; LS.failNew = true; }
}
function lesAfterFrame() {
  if (!LS.les) return;
  if (LS.next != null) { const n = LS.next; LS.next = null; lesShow(n); }
  else if (LS.failNew) { LS.failNew = false; lesRender(); }
}
function exitLesson() {
  if (!LS.les) return;
  const E = UI.E; if (E) { E.hook = null; E.quiet.clear(); E.setIntensity(UI.intensity); }
  LS.les = null; LS.ctx = null; LS.running = false; LS.next = null; LS.fail = false; LS.prep = false; LS.hl = null;
  if (LS.saved) { UI.slowmo = LS.saved.slowmo; $('cSlow').checked = UI.slowmo; setSpeed(LS.saved.speed); lesSetFull(LS.saved.full); LS.saved = null; }
  UI.paused = false;
  lesRender(); refreshDOM(true);
}

/* ----------------------------- cartão da aula ----------------------------- */
function lesRender(keepScroll) {
  const el = $('lesson'), les = LS.les;
  if (!les) { el.hidden = true; $('lsRing').hidden = true; document.body.classList.remove('les-on'); return; }
  el.hidden = false; document.body.classList.add('les-on'); el.classList.toggle('min', LS.min); el.classList.toggle('run', !!LS.running);
  const idx = LESSONS.indexOf(les), s = lesStep();
  $('lsKick').textContent = `Aula ${idx + 1} de ${LESSONS.length} · ${LES_GRP[les.grp].t}`;
  $('lsTitle').textContent = les.title;
  $('lsMin').textContent = LS.min ? '▴' : '▾';
  $('lsProg').innerHTML = les.steps.map((x, k) => `<i class="${k < LS.k ? 'done' : (k === LS.k ? 'on' : '')}"></i>`).join('');
  let body, foot;
  if (LS.prep || !s) { body = '<p class="ls-watch">Preparando o pregão da aula…</p>'; foot = '<button class="btn" data-ls="exit">Sair</button>'; }
  else if (LS.fail) {
    body = '<h4>O roteiro não se cumpriu</h4><p>Desta vez o mercado simulado não chegou ao ponto esperado (por exemplo, por causa de uma oferta enviada na boleta). Repita a aula: a semente é fixa e o roteiro volta ao normal.</p>';
    foot = '<button class="btn primary" data-ls="repeat">Repetir a aula</button><button class="btn" data-ls="exit">Sair</button>';
  } else if (s.summary) {
    const rc = les.recap ? les.recap(LS.ctx) : [];
    body = `<h4>Resumo da aula</h4><ul class="ls-recap">${rc.map(x => `<li>${x}</li>`).join('')}</ul>${quizHTML()}`;
    const nx = LESSONS[idx + 1]; foot = '<button class="btn" data-ls="repeat">Repetir</button>' + (nx ? `<button class="btn primary" data-ls="next">Próxima: ${nx.title}</button>` : '') + '<button class="btn" data-ls="exit">Sair da aula</button>';
  } else {
    body = (LS.k === 0 ? `<p class="ls-goal"><b>Nesta aula, você vai ver</b> ${les.goal}</p>` : '') + `<h4>${lesVal(s.t)}</h4><div class="ls-text">${s.x(LS.ctx)}</div>`;
    if (LS.running) { body += `<p class="ls-watch" id="lsWatch">${lesWatch()}</p>`; foot = '<span class="ls-run"><i></i>Observando</span><button class="btn" data-ls="fast">Avançar rápido</button>'; }
    else if (s.done) { const nx = LESSONS[idx + 1]; foot = '<button class="btn" data-ls="repeat">Repetir</button>' + (nx ? `<button class="btn primary" data-ls="next">Próxima: ${nx.title}</button>` : '') + '<button class="btn" data-ls="exit">Sair da aula</button>'; }
    else foot = `<button class="btn primary" data-ls="go">${lesVal(s.btn) || 'Continuar'}</button>`;
  }
  const lb = $('lsBody'); lb.innerHTML = body.replace(/R\$ /g, 'R$\u00a0'); $('lsFoot').innerHTML = foot;
  lb.scrollTop = keepScroll ? lb.scrollHeight : 0; // depois de responder o teste, mostra a explica\u00e7\u00e3o
  lesPlace();
}
function lesWatch() {
  const s = lesStep(), c = LS.ctx; if (!s || !c) return '';
  const i = c.i, a = i.auction;
  let w = s.run && s.run.watch ? lesVal(s.run.watch) + ' ' : '';
  if (a) w += `${a.kind === 'auction' ? 'Leilão' : 'Call'}: faltam <b>${mmss(a.plannedEnd - c.E.t)}</b> para o fim previsto (${hms(a.plannedEnd)}); teórico ${fpr(i, a.theo)}${a.prorr.length ? `; ${a.prorr.length} prorrogaç${a.prorr.length > 1 ? 'ões' : 'ão'}` : ''}.`;
  else if (!w) w = 'Observando o mercado…';
  return w;
}
function lesRefresh() {
  if (!LS.les) return;
  if (LS.running) { const w = $('lsWatch'); if (w) { const h = lesWatch().replace(/R\$ /g, 'R$\u00a0'); if (w._h !== h) { w._h = h; w.innerHTML = h; } } }
  lesPlace();
}
/* destaque: contorno pulsante em volta dos elementos do passo */
function lesHighlight(hl) {
  LS.hl = hl && hl.length ? hl : null;
  if (LS.hl) { // traz o destaque para a tela (no celular, acima do cartão da aula)
    const id = LESSON_SCROLL[LS.hl[0]] || LS.hl[0], e = $(id) || $('panelBox');
    if (e) {
      const r = e.getBoundingClientRect(), lim = UI.mobile ? window.innerHeight * 0.45 : window.innerHeight - 120;
      if (r.top < barBottom() - 4 || r.top > lim) e.scrollIntoView({ block: 'start', behavior: UI.reduced ? 'auto' : 'smooth' });
    }
  }
  lesPlace();
}
/* o cartão da aula fica na coluna da direita (no celular, preso embaixo); aqui só o contorno de destaque */
function lesPlace() {
  const el = $('lesson'), r = $('lsRing');
  if (!LS.les || el.hidden || !LS.hl || LS.prep || LS.fail) { r.hidden = true; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of LS.hl) {
    let e = $(id); if (!e && id === 'apLights') e = $('panelBox'); if (!e) continue;
    const b = e.getBoundingClientRect(); if (b.width < 4 || b.height < 4) continue;
    x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
  }
  if (!isFinite(x0)) { r.hidden = true; return; }
  const vh = window.innerHeight, vw = window.innerWidth;
  x0 = Math.max(x0, 2); y0 = Math.max(y0, barBottom() + 2); x1 = Math.min(x1, vw - 2); y1 = Math.min(y1, vh - 2);
  if (y1 - y0 < 10 || x1 - x0 < 10) { r.hidden = true; return; }
  Object.assign(r.style, { left: x0 - 3 + 'px', top: y0 - 3 + 'px', width: x1 - x0 + 6 + 'px', height: y1 - y0 + 6 + 'px' });
  r.hidden = false;
}
function wireLessons() {
  buildLesMenu();
  $('bLes').onclick = e => { e.stopPropagation(); const open = $('mLes').hidden; closeMenus(); $('mLes').hidden = !open; $('bLes').setAttribute('aria-expanded', String(open)); };
  $('mLes').onclick = e => { const b = e.target.closest('button[data-les]'); if (!b) return; closeMenus(); startLesson(b.dataset.les); showFocus(); };
  $('lesGrid').onclick = e => { const b = e.target.closest('button[data-les]'); if (!b) return; startLesson(b.dataset.les); markTab('grafico'); goSection('colCenter', true); };
  $('lesTabs').onclick = e => { const b = e.target.closest('button[data-g]'); if (!b || b.classList.contains('on')) return; UI.lesGrp = b.dataset.g; renderLessons(); };
  $('lesson').addEventListener('click', e => {
    const b = e.target.closest('[data-ls]');
    if (!b) { if (UI.mobile && e.target.closest('.ls-head')) { LS.min = !LS.min; lesRender(); } return; }
    const a = b.dataset.ls;
    if (a === 'go') lesGo();
    else if (a === 'fast') setSpeed('turbo');
    else if (a === 'repeat') startLesson(LS.les.id);
    else if (a === 'next') { const nx = LESSONS[LESSONS.indexOf(LS.les) + 1]; if (nx) startLesson(nx.id); }
    else if (a === 'exit') exitLesson();
    else if (a === 'min') { LS.min = !LS.min; lesRender(); }
    else if (a === 'quiz') { if (LS.qa == null && LS.quiz) { LS.qa = +b.dataset.o; lesRender(true); } }
  });
  window.addEventListener('resize', lesPlace);
}
init();
