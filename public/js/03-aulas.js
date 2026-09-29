'use strict';
/* ============================================================================
   AULAS: micro-cenários guiados
   Cada aula cria um pregão com semente fixa (o roteiro se repete igual), liga o
   "modo silencioso" no ativo da aula (sem ofertas tardias aleatórias: as
   prorrogações só acontecem quando o roteiro provoca) e avança por passos que
   pausam e explicam. Os textos usam os números do próprio pregão, lidos do
   motor no momento em que o passo aparece.

   Passo: { t: título, x: ctx => html, hl: [ids para destacar], btn: rótulo do botão,
            go: ctx => ação ao clicar, run: { until, tick, speed, max } (simula até a
            condição), skip: ctx => pular o passo, done: último passo }
   ============================================================================ */
const LB = s => `<b>${s}</b>`;
const LES_GRP = {
  tuneis: { t: 'Os túneis', d: 'O que cada túnel faz com uma oferta ou com um negócio.' },
  leilao: { t: 'Como o leilão termina', d: 'Proteção, alterações de última hora e o call de abertura.' },
  opcao: { t: 'Opções', d: 'Túneis que vêm do ativo-objeto. Se opções são novidade, comece pelo <a href="#opcoes">guia de opções</a>.' }
};
const FACT_NAME = { theo: '1) preço teórico', qty: '2) quantidade teórica', alloc: '3) atendimento de outra oferta', imb: '4) saldo não atendido' };
function lesAuc(c) { const i = c.i; return i.auction || i.auctions[i.auctions.length - 1] || null; }
function lesRemain(c) { const a = c.i.auction; return a ? a.plannedEnd - c.E.t : Infinity; }
function lesNProrr(c) { const a = lesAuc(c); return a ? a.prorr.length : 0; }
function lesEnded(c) { const a = lesAuc(c); return !!(a && a.ended); }
function lesStarted(c) { return !!c.i.auction; }
function qtyQ(i) { return Math.round(i.qtyAuction * 1.4 / i.lot) * i.lot; }
/* distância em ticks, do jeito que se fala: "1 centavo", "3 centavos", "2 ticks" */
function tickWords(i, n) {
  n = Math.abs(Math.round(n));
  if (i.cur === 'R$' && Math.abs(i.tick - 0.01) < 1e-9) return n === 1 ? '1 centavo' : `${fq(n)} centavos`;
  return n === 1 ? '1 tick' : `${fq(n)} ticks`;
}
function pctSpec(s) { return s.pct != null ? '±' + fnum(s.pct * 100, s.pct * 100 % 1 ? 1 : 0) + '%' : '±' + fnum(s.abs, 2) + ' p.p.'; }
/* negócios feitos depois de uma marca (para contar o que uma ordem executou) */
function markTrades(c) { const tt = c.i.tt; c.d.ttRef = tt[tt.length - 1] || null; }
function newTrades(c) { const tt = c.i.tt, k = c.d.ttRef ? tt.lastIndexOf(c.d.ttRef) : -1; return tt.slice(k + 1).filter(x => !x.auc); }
function tradeRange(i, f) { const lo = Math.min(...f.map(x => x.p)), hi = Math.max(...f.map(x => x.p)); return lo === hi ? `a ${fpr(i, lo)}` : `entre ${fp(i, lo)} e ${fp(i, hi)}`; }
/* escala completa do gráfico (a aula de rejeição precisa mostrar o túnel inteiro) */
function lesSetFull(v) { const ch = UI.chart; ch.full = !!v; ch.ymin = NaN; $('bFull').setAttribute('aria-pressed', String(!!v)); $('bFull').classList.toggle('primary', !!v); }

/* por que entrou em leilão */
function whyIn(i, a) {
  if (!a) return 'O ativo não entrou em leilão desta vez.';
  if (a.kind !== 'auction') return `${TRIG_LABEL[a.kind]}.`;
  const tr = a.trig, dur = fnum(a.dur0 / 60, 0);
  if (tr.kind === 'qtd') return `A oferta de ${LB(fq(tr.q) + ' ' + unitQ(i))} passou do limite de ${fq(tr.lim)}: ${i.ticker} entrou em ${LB('leilão por quantidade de ' + dur + ' min')}. Não importa o preço: é o tamanho que dispara.`;
  const dir = tr.dir > 0 ? 'acima' : 'abaixo';
  const ref = { ult: i.isOpt ? `o teórico da opção, ${fpr(i, tr.base)}` : `o preço-base, ${fpr(i, tr.base)}`,
    med: `a média dos últimos ${CONFIG.vwapWindowSec} s, ${fpr(i, tr.base)}`, est: `o fechamento anterior, ${fpr(i, tr.base)}` }[tr.kind];
  return `O próximo negócio sairia a ${LB(fpr(i, tr.p))}, ${tickWords(i, tr.p - tr.bound)} ${dir} do limite do ${TRIG_LABEL[tr.kind].toLowerCase()} (${LB(fpr(i, tr.bound))}, calculado sobre ${ref}). ` +
    `Esse negócio não aconteceu: ${i.ticker} entrou em ${LB('leilão de ' + dur + ' min')}, e o que sobrou da ordem foi para o livro do leilão.`;
}
/* por que foi prorrogado */
function whyProrr(i, a, p) {
  if (!p) return '';
  switch (p.code) {
    case 'prot_preco':
      return `No fim previsto (${hms(p.prevEnd)}), o teórico era ${LB(fpr(i, p.theo))}, ` +
        (p.theo >= a.prot.hi ? `igual ou acima do limite superior da proteção (${fpr(i, a.prot.hi)})` : `igual ou abaixo do limite inferior da proteção (${fpr(i, a.prot.lo)})`) +
        `. Por isso, ${LB('+1 min por proteção de preço')}: tempo para o mercado reagir antes de fechar num preço tão distante.`;
    case 'prot_qtd': return `No fim previsto (${hms(p.prevEnd)}), ${p.detail}. Por isso, ${LB('+1 min por proteção por quantidade')}.`;
    case 'alt60': case 'alt30': case 'alt15': {
      const w = { alt60: 'no último minuto', alt30: 'nos últimos 30 s', alt15: 'nos últimos 15 s' }[p.code];
      return `Houve alteração ${LB(w)} antes do fim previsto (${p.detail}). Por isso, ${LB('+1 min por alteração')}.`;
    }
    default: return `No fim previsto não havia preço teórico: nenhuma compra cruzava com venda. ${LB('+1 min')}.`;
  }
}
/* o que acontece durante o leilão: preço teórico, proteção e ofertas travadas */
function aucText(c) {
  const a = lesAuc(c), i = c.i; if (!a) return '';
  const th = a.theo != null ? fpr(i, a.theo) : null;
  return `Durante o leilão não há negócios. As ofertas se acumulam e o sistema calcula o ${LB('preço teórico')}, o que maximiza a quantidade negociada: ` +
    (th ? `agora ${LB(th)}, com ${fq(a.tq)} ${unitQ(i)}.` : 'por enquanto indefinido, porque compras e vendas ainda não cruzam.') +
    `<br>A faixa verde-petróleo é a ${LB('proteção')}: ${pctSpec(a.protSpec)} sobre ${fpr(i, a.prot.c)}, o último negócio antes do leilão, de ${LB(fp(i, a.prot.lo))} a ${LB(fp(i, a.prot.hi))}. ` +
    `O teórico está ${bandPos(a)}. Se estiver na borda ou fora dela no fim previsto (${hms(a.plannedEnd)}), o leilão prorroga. Até lá, ele ainda muda.` +
    (th ? `<br>Quem já está no preço fica ${LB('travado')}: compra a ${th} ou mais e venda a ${th} ou menos não podem ser canceladas nem reduzidas.` : '');
}
function bandPos(a) {
  if (a.theo == null) return 'indefinido (compras e vendas ainda não cruzam)';
  return a.theo >= a.prot.hi ? LB('fora da faixa, acima') : (a.theo <= a.prot.lo ? LB('fora da faixa, abaixo') : LB('dentro da faixa'));
}
/* fim do leilão */
function endText(i, a) {
  if (!a || !a.ended) return '';
  const n = a.prorr.length, call = a.kind === 'call_open';
  let s = a.price != null
    ? (call ? `O call terminou às ${LB(hms(a.t1))}: ${i.ticker} ${LB('abriu a ' + fpr(i, a.price))} (${fpct(a.price / i.prevCloseT - 1)}), com ${fq(a.qty)} ${unitQ(i)} num preço único.`
            : `O leilão encerrou às ${LB(hms(a.t1))}: ${LB(fq(a.qty) + ' ' + unitQ(i) + ' a ' + fpr(i, a.price))}, todas ao mesmo preço.`)
    : `O leilão encerrou às ${hms(a.t1)} sem negócio.`;
  if (!n) s += ' Não houve prorrogação: o teórico ficou dentro da proteção e nada mudou no último minuto.';
  else s += ` Foram ${n} prorrogaç${n > 1 ? 'ões' : 'ão'}: ${a.prorr.map((p, k) => `${k + 1}ª por ${PRORR_LABEL[p.code]}`).join('; ')}.`;
  if (a.how === 'supervisao') s += `<br>Quem encerrou foi a ${LB('supervisão de mercado')} (simulada), depois de ${a.protCount} prorrogações por proteção. É a regra que impede um leilão sem fim.`;
  return s;
}
function recenterText(i) {
  const u = i.tun.ult; if (!u || i.state !== ST.CONT) return '';
  return `<br>Os túneis se recentralizaram: o tubo dourado agora vai de ${LB(fp(i, u.lo))} a ${LB(fp(i, u.hi))}, em torno de ${fpr(i, u.c)}.`;
}
/* oferta tardia (aula de alteração) */
function lateOrder(c, side) {
  const E = c.E, i = c.i, a = i.auction; if (!a) return;
  const p = a.theo != null ? a.theo : i.refT(), q = Math.max(i.lot, Math.round(i.tradeSize / i.lot) * i.lot);
  const brs = ['Corretora 27', 'Corretora 63', 'Corretora 08', 'Corretora 90'];
  c.d.nLate = (c.d.nLate || 0) + 1;
  const br = brs[c.d.nLate % brs.length], n0 = a.changes.length;
  E.submit(i, { side, type: LMT, p, q, br, tag: 'tardia' });
  const facts = [...new Set(a.changes.slice(n0).map(x => x.k))];
  c.d.late = { t: E.t, rem: a.plannedEnd - E.t, side, p, q, br, facts };
}
function lateDesc(c) {
  const L = c.d.late, i = c.i; if (!L) return '';
  const f = L.facts.length ? L.facts.map(k => FACT_NAME[k]).join(', ') : 'nenhuma medida';
  return `A ${L.side > 0 ? 'compra' : 'venda'} de ${fq(L.q)} ações a ${fpr(i, L.p)} chegou às ${hms(L.t)}, faltando ${Math.round(L.rem)} s, e mudou: ${LB(f)}.`;
}
function outCount(i) {
  const u = i.tun.ult; let n = 0; if (!u) return 0;
  for (const l of i.bids) if (l.p > u.hi || l.p < u.lo) n += l.orders.length;
  for (const l of i.asks) if (l.p > u.hi || l.p < u.lo) n += l.orders.length;
  return n;
}
const RUN_AUC = { until: lesStarted, max: 30 };
const RUN_END = { until: lesEnded, max: 900, watch: 'No gráfico, acompanhe a linha dourada pontilhada (o preço teórico) e a faixa verde-petróleo (a proteção).' };
const RUN_PRORR1 = { until: c => lesNProrr(c) >= 1 || lesEnded(c), max: 900, watch: 'No fim previsto, o sistema confere a proteção e as alterações de última hora.' };

/* Cada aula: goal (o que a pessoa vai ver), steps, recap (resumo) e quiz (teste rápido com os números do pregão).
   O passo final "Resumo da aula" é acrescentado automaticamente no fim da lista. */
const LESSONS = [
  /* ------------------------------ OS TÚNEIS ------------------------------ */
  { id: 'rej', grp: 'tuneis', title: 'Túnel de rejeição', sub: 'O dedo gordo esbarra na parede vinho',
    goal: 'a diferença entre recusar uma oferta na entrada e abrir um leilão no negócio.',
    seed: 103, start: '10:16:00', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'A área vinho', hl: ['chartWrap', 'reguaWrap'], enter: () => lesSetFull(true),
        x: c => { const i = c.i, r = i.tun.rej, u = i.tun.ult; return `A área hachurada em vinho fica além do ${LB('túnel de rejeição')}: ${pctSpec(i.g.rej)} sobre o preço-base de PETR4 (${fpr(i, r.c)}), de ${LB(fp(i, r.lo))} a ${LB(fp(i, r.hi))}. É bem mais largo que o tubo dourado, que vai de ${fp(i, u.lo)} a ${fp(i, u.hi)}; para caber tudo, o gráfico está em escala completa.<br>Ele age na ${LB('entrada da oferta')}: compra acima do limite superior ou venda abaixo do inferior é recusada na hora. Serve para barrar erro de digitação, o dedo gordo.`; },
        btn: 'Digitar uma compra a 10 vezes o preço',
        go: c => { const i = c.i; c.d.ff = c.E.submit(i, { side: 1, type: LMT, p: i.refT() * 10, q: 1000, br: 'Corretora 33', tag: 'dedo gordo' }); } },
      { t: 'Recusada na entrada', hl: ['chartWrap', 'reguaWrap'],
        x: c => { const i = c.i, o = c.d.ff.o; return `A compra de 1.000 ações a ${LB(fpr(i, o.p))} passou do limite superior de rejeição (${fpr(i, i.tun.rej.hi)}) e foi ${LB('recusada')}. Ela não entrou no livro, não negociou e não mexeu no preço: PETR4 continua em ${fpr(i, i.refT())}.<br>No gráfico, a faísca vinho marca a recusa; na régua, a oferta bate na parede vinho e volta.`; },
        btn: 'Comprar com limite 5% acima',
        go: c => { const i = c.i; markTrades(c); c.d.lim = Math.round(i.refT() * 1.05); c.d.buy = c.E.submit(i, { side: 1, type: LMT, p: c.d.lim, q: 1000, br: 'Corretora 33', tag: 'compra' }); c.d.fills = newTrades(c); } },
      { t: 'Aceita: vale o preço do negócio', hl: ['chartWrap'],
        x: c => { const i = c.i, f = c.d.fills || [], q = f.reduce((s, x) => s + x.q, 0);
          return `A compra com limite ${LB(fpr(i, c.d.lim))} ficou acima do tubo dourado, mas dentro da rejeição: foi ${LB('aceita')}. ` +
            (f.length ? `Ela negociou ${fq(q)} ações ${LB(tradeRange(i, f))}, com as vendas que já estavam no livro, dentro do tubo. Por isso não houve leilão.` : 'Ela entrou no livro, esperando um vendedor.') +
            `<br>São duas perguntas diferentes: o túnel de rejeição olha o ${LB('preço da oferta')}; o túnel de leilão olha o ${LB('preço do negócio')}.`; },
        btn: 'Testar o limite de quantidade',
        go: c => { const i = c.i; c.d.qq = Math.round(i.qtyReject * 1.5 / i.lot) * i.lot; c.E.submit(i, { side: 1, type: LMT, p: i.ba() != null ? i.ba() : i.refT(), q: c.d.qq, br: 'Corretora 33', tag: 'dedo gordo' }); } },
      { t: 'Recusada pelo tamanho', hl: ['chartWrap', 'panelBox'],
        x: c => { const i = c.i, n = LESSONS.findIndex(l => l.id === 'qtd') + 1; return `A compra de ${LB(fq(c.d.qq) + ' ações')} tinha preço normal, mas passou do limite por oferta (${fq(i.qtyReject)}) e também foi ${LB('recusada')}. É o túnel de rejeição por quantidade, na última linha da tabela.<br>Entre ${fq(i.qtyAuction)} e ${fq(i.qtyReject)} ações, a oferta seria aceita e abriria um leilão por quantidade. É o assunto da aula ${n}.`; } }
    ],
    recap: () => [
      'O túnel de rejeição confere cada oferta na entrada: compra acima do limite superior ou venda abaixo do inferior é recusada.',
      'Oferta recusada não entra no livro e não mexe no preço.',
      'Uma oferta aceita ainda pode abrir leilão: quem decide é o preço do negócio, no tubo dourado.'
    ],
    quiz: c => { const i = c.i, r = i.tun.rej, p = Math.max(1, r.lo - Math.round((r.hi - r.lo) * 0.05)); return {
      q: `Com o túnel de rejeição de ${fp(i, r.lo)} a ${fp(i, r.hi)}, chega uma venda a ${fpr(i, p)}. O que acontece?`,
      opts: ['Entra no livro e espera um comprador', 'É recusada na entrada', 'Abre um leilão'], ok: 1,
      why: `${fpr(i, p)} fica abaixo do limite inferior (${fp(i, r.lo)}). Venda abaixo dele é recusada antes de tudo: nem chega ao livro.` }; } },

  { id: 'ult', grp: 'tuneis', title: 'Leilão por último preço', sub: 'Uma compra grande passa do tubo dourado',
    goal: 'o que acontece quando um negócio sairia fora do túnel de leilão, e como o leilão forma um preço único.',
    seed: 101, start: '10:16:00', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'O tubo dourado', hl: ['chartWrap', 'reguaWrap'],
        x: c => { const u = c.i.tun.ult, i = c.i; return `O tubo dourado é o ${LB('túnel de leilão por último preço')} de PETR4: ${pctSpec(i.g.ult)} em torno do preço-base (C-LAST), agora ${LB(fpr(i, u.c))}. Os limites, ${LB(fp(i, u.lo))} e ${LB(fp(i, u.hi))}, aparecem escritos na ponta do tubo.<br>Ele age no ${LB('momento do negócio')}: se o próximo negócio sairia fora do tubo, ele não acontece e o ativo entra em leilão. Na régua à direita, o tubo é o portão dourado.`; },
        btn: 'Mandar uma compra grande', go: c => { markTrades(c); c.E.doWhale(c.i, 1); }, run: RUN_AUC },
      { t: 'Por que entrou em leilão', hl: ['chartWrap', 'reguaWrap'],
        x: c => { const i = c.i, f = newTrades(c), q = f.reduce((s, x) => s + x.q, 0);
          return (f.length ? `Primeiro, a ordem comprou ${LB(fq(q) + ' ações')} ${tradeRange(i, f)}: tudo o que estava à venda dentro do tubo. ` : '') + whyIn(i, lesAuc(c)) + '<br>No gráfico, o bloco dourado marca o leilão; na régua, o portão fechou.'; } },
      { t: 'O que acontece no leilão', hl: ['panelBox'], x: aucText, btn: 'Ver até o fim', run: RUN_END },
      { t: 'Fim do leilão', hl: ['chartWrap', 'reguaWrap'], x: c => endText(c.i, lesAuc(c)) + recenterText(c.i) }
    ],
    recap: () => [
      'O túnel de leilão confere o preço do negócio. Enquanto há vendas dentro do tubo, a compra negocia normalmente.',
      `O primeiro negócio que sairia fora do tubo não acontece: o ativo entra em leilão (${fnum(CONFIG.groups.IBOV.auctionSec / 60, 0)} min em ações do Ibovespa).`,
      'O leilão fecha tudo a um preço único, o teórico, e os túneis se recentralizam em volta dele.'
    ],
    quiz: c => { const i = c.i, u = i.tun.ult, p = u.lo - 1; return {
      q: `Depois do leilão, o tubo dourado vai de ${fp(i, u.lo)} a ${fp(i, u.hi)}. Uma venda grande faria o próximo negócio sair a ${fpr(i, p)}. O que acontece?`,
      opts: ['O negócio sai normalmente', 'PETR4 entra em leilão de novo', 'A venda é recusada'], ok: 1,
      why: `${fp(i, p)} fica ${tickWords(i, 1)} abaixo do limite inferior do tubo: o negócio não sai e PETR4 volta a leilão. A recusa só acontece além da linha vinho, em ${fp(i, i.tun.rej.lo)}.` }; } },

  { id: 'med', grp: 'tuneis', title: 'Leilão por preço médio', sub: 'A escada: passos pequenos, soma grande',
    goal: 'como o túnel de preço médio pega uma sequência de negócios que, um a um, passaria no tubo dourado.',
    seed: 102, start: '10:16:00', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'A linha índigo', hl: ['chartWrap'],
        x: c => { const m = c.i.tun.med, i = c.i; return `As linhas índigo tracejadas são o ${LB('túnel de preço médio')}: ${pctSpec(i.g.med)} sobre a média ponderada dos negócios dos últimos ${CONFIG.vwapWindowSec} s (agora ${fpr(i, m.c)}), de ${LB(fp(i, m.lo))} a ${LB(fp(i, m.hi))}.<br>Ele existe para pegar movimentos em que cada passo é pequeno, mas a soma é grande: a ${LB('escada')}. O tubo dourado anda junto com cada degrau; a média, não.`; },
        btn: 'Começar uma escada de vendas', go: c => c.E.doEscada(c.i, -1),
        run: { until: lesStarted, max: 150, watch: 'Degraus de venda a cada 7 a 12 s. Cada um passa no tubo dourado, porque a base desce junto; a média de 60 s fica para trás. Observe o preço chegar à linha índigo de baixo.' } },
      { t: 'Por que entrou em leilão', hl: ['chartWrap'],
        x: c => {
          const a = lesAuc(c), i = c.i; let s = whyIn(i, a);
          if (a && a.trig.kind === 'med') {
            const k = i.hist.ult.idx(a.t0 - 0.01), lo = k >= 0 ? i.hist.ult.v[0][k] : NaN;
            if (lo === lo) s += `<br>Pelo tubo dourado, esse negócio ${a.trig.p >= lo ? 'passaria' : 'também não passaria'}: o limite inferior dele estava em ${fpr(i, lo)}. Foi a média que percebeu que a queda, somada, já passava de ${fnum(i.g.med.pct * 100, 0)}%.`;
          }
          return s;
        } },
      { t: 'O que acontece no leilão', hl: ['panelBox'], x: aucText, btn: 'Ver até o fim', run: RUN_END },
      { t: 'Fim do leilão', hl: ['chartWrap'], x: c => endText(c.i, lesAuc(c)) + recenterText(c.i) }
    ],
    recap: () => [
      `O túnel de preço médio compara o negócio com a média ponderada dos últimos ${CONFIG.vwapWindowSec} s, não com o último preço.`,
      'Numa escada, cada degrau passa no tubo dourado, porque a base anda junto. A média fica para trás e percebe a soma.',
      'Quando o negócio sairia fora da faixa índigo, o ativo vai a leilão, como no túnel do último preço.'
    ],
    quiz: () => ({
      q: 'Em 30 segundos, uma ação cai três vezes, cerca de 1% por vez, e cada queda cabe no tubo dourado. Qual túnel percebe o movimento?',
      opts: ['O de rejeição', 'O de preço médio', 'Nenhum: cada passo é pequeno'], ok: 1,
      why: `O tubo dourado anda junto com o preço, então cada degrau passa. A média dos últimos ${CONFIG.vwapWindowSec} s ainda carrega os preços de antes da queda: quando o negócio se afasta ${fnum(CONFIG.groups.IBOV.med.pct * 100, 0)}% dela, o ativo vai a leilão.` }) },

  { id: 'est', grp: 'tuneis', title: 'Leilão pelo túnel estático', sub: 'VALE3 passa de +10% sobre o fechamento',
    goal: 'o túnel que não acompanha o preço, e o que acontece com ele quando o leilão fecha além do limite.',
    seed: 106, start: '10:08:00', focus: 'VALE3', quiet: ['VALE3'], gap: { tk: 'VALE3', pct: 0.086 },
    steps: [
      { t: 'O túnel estático', hl: ['chartWrap', 'panelBox'],
        x: c => { const i = c.i, e = i.tun.est, L = i.refT(); return `VALE3 abriu com alta forte e está em ${LB(fpr(i, L))} (${fpct(L / i.prevCloseT - 1)}). O pontilhado cinza é o ${LB('túnel estático')}: ${pctSpec(i.g.est)} sobre o fechamento anterior (${fpr(i, i.prevCloseT)}), de ${LB(fp(i, e.lo))} a ${LB(fp(i, e.hi))}.<br>Ao contrário dos outros, ele não acompanha o preço: fica fixo no dia e serve de trava para movimentos muito grandes. Vamos simular mais uma notícia boa e uma compra agressiva que passa do limite.`; },
        btn: 'Soltar a notícia e comprar',
        go: c => { const i = c.i, e = i.tun.est; c.E.doNews(i, 1, 0.012); c.E.updateFV(0); markTrades(c); c.E.doPush(i, 1, e.hi, e.hi + 2, 'compra agressiva', q => `Compra agressiva simulada em ${i.ticker}: ${fq(q)} ações com limite ${fpr(i, e.hi + 2)}, logo acima do túnel estático.`); },
        run: RUN_AUC },
      { t: 'Por que entrou em leilão', hl: ['chartWrap'],
        x: c => { const a = lesAuc(c), i = c.i; let s = whyIn(i, a); if (a && a.trig.kind === 'est') s += `<br>O estático é conferido antes dos outros túneis. E o leilão é mais longo, de ${fnum(a.dur0 / 60, 0)} min, porque a oscilação no dia passa de ${fnum(CONFIG.auctionDuration.bigOsc * 100, 0)}%.`; return s; } },
      { t: 'O que acontece no leilão', hl: ['panelBox'], x: aucText, btn: 'Ver até o fim', run: RUN_END },
      { t: 'Fim do leilão', hl: ['chartWrap'],
        x: c => {
          const i = c.i, a = lesAuc(c), e = i.tun.est; let s = endText(i, a);
          if (i.staticStep > 1) s += `<br>O leilão fechou além de ${fnum(i.g.est.pct * 100, 0)}%: o túnel estático ${LB('subiu de degrau')} e agora vale ±${fnum(i.g.est.pct * i.staticStep * 100, 0)}% (${fp(i, e.lo)} a ${fp(i, e.hi)}). No gráfico, o pontilhado cinza saltou para cima.`;
          else s += `<br>O leilão fechou dentro de ±${fnum(i.g.est.pct * 100, 0)}%, então o estático continua no primeiro degrau. Se tivesse fechado além, passaria a valer ±${fnum(i.g.est.pct * 200, 0)}%.`;
          return s + recenterText(i);
        } }
    ],
    recap: () => [
      `O túnel estático fica fixo no dia, em ${pctSpec(CONFIG.groups.IBOV.est)} sobre o fechamento anterior, e é conferido antes dos outros.`,
      `Oscilação de ${fnum(CONFIG.auctionDuration.bigOsc * 100, 0)}% ou mais no dia deixa o leilão mais longo: ${fnum(CONFIG.auctionDuration.bigSec / 60, 0)} min em vez de ${fnum(CONFIG.groups.IBOV.auctionSec / 60, 0)}.`,
      'Se o leilão fecha além do degrau, o estático sobe para o próximo: ±20%, depois ±30%.'
    ],
    quiz: c => { const i = c.i, e = i.tun.est, p = e.hi + 1; return {
      q: `O estático de VALE3 agora vai de ${fp(i, e.lo)} a ${fp(i, e.hi)}. Se um negócio sairia a ${fpr(i, p)}, o que acontece?`,
      opts: ['VALE3 entra em leilão pelo túnel estático', 'Nada: o estático só age uma vez por dia', 'A oferta é recusada'], ok: 0,
      why: `${fp(i, p)} passa ${tickWords(i, 1)} do limite do degrau atual (±${fnum(i.g.est.pct * i.staticStep * 100, 0)}%): o negócio não sai e VALE3 volta a leilão. O estático vale o dia todo.` }; } },

  { id: 'qtd', grp: 'tuneis', title: 'Leilão por quantidade', sub: 'Oferta grande demais e proteção por corretora',
    goal: 'por que o tamanho da oferta, e não o preço, pode abrir um leilão, e como a concentração numa corretora prorroga o fim.',
    seed: 104, start: '10:16:00', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'Limites de quantidade', hl: ['panelBox'],
        x: c => `Toda oferta de PETR4 passa por dois limites de quantidade: acima de ${LB(fq(c.i.qtyAuction))} ações ela abre ${LB('leilão por quantidade')}; acima de ${LB(fq(c.i.qtyReject))}, é ${LB('recusada')} na entrada. Os dois estão na última linha da tabela.<br>A ideia: uma oferta desse tamanho merece um leilão, para que todos possam participar da formação do preço.`,
        btn: c => `Enviar compra de ${fq(qtyQ(c.i))} ações`,
        go: c => { const i = c.i; c.d.br = 'Corretora 51'; c.d.p = Math.round(i.refT() * 1.008); c.E.submit(i, { side: 1, type: LMT, p: c.d.p, q: qtyQ(i), br: c.d.br, tag: 'ordem grande' }); },
        run: RUN_AUC },
      { t: 'Por que entrou em leilão', hl: ['chartWrap', 'panelBox'], x: c => whyIn(c.i, lesAuc(c)) + '<br>A oferta foi direto para o livro do leilão, sem negociar antes.' },
      { t: 'A proteção por quantidade', hl: ['panelBox'],
        x: c => { const i = c.i, L = CONFIG.prorrogation.qtyProtectionLots; return `No fim do leilão há uma segunda proteção: se uma mesma corretora somar mais de ${LB(L + ' lotes')} (${fq(L * i.lot)} ações) atendidos entre compra e venda, o leilão prorroga. A regra evita que uma única corretora domine o preço do leilão.<br>A ${c.d.br} quer comprar ${fq(qtyQ(i))} ações com limite ${fpr(i, c.d.p)}, e o teórico está em ${fpr(i, lesAuc(c).theo)}. Se ela for atendida em mais de ${L} lotes, o leilão vai prorrogar.`; },
        btn: 'Ver o fim previsto', run: RUN_PRORR1 },
      { t: 'Por que foi prorrogado', hl: ['chartWrap', 'panelBox'], skip: c => !lesNProrr(c),
        x: c => { const a = lesAuc(c); return whyProrr(c.i, a, a.prorr[0]) + `<br>Enquanto a concentração continuar, o leilão segue prorrogando. Depois de ${CONFIG.prorrogation.maxProtection} prorrogações por proteção, a supervisão (simulada) autoriza o encerramento.`; },
        btn: 'Ver até o fim', run: RUN_END },
      { t: 'Fim do leilão', hl: ['chartWrap'], x: c => endText(c.i, lesAuc(c)) + recenterText(c.i) }
    ],
    recap: c => [
      `Oferta acima do limite de leilão (${fq(c.i.qtyAuction)} ações em PETR4) abre leilão por quantidade de ${fnum(CONFIG.auctionDuration.qtySec / 60, 0)} min, seja qual for o preço.`,
      `Acima do limite de rejeição (${fq(c.i.qtyReject)}), a oferta é recusada na entrada.`,
      `No fim, se uma corretora somar mais de ${CONFIG.prorrogation.qtyProtectionLots} lotes atendidos, o leilão prorroga por proteção por quantidade.`
    ],
    quiz: c => { const i = c.i, q = Math.round((i.qtyAuction + i.qtyReject) / 2 / 100000) * 100000; return {
      q: `Chega uma oferta de ${fq(q)} ações de PETR4 a preço normal. O que acontece?`,
      opts: ['Negocia normalmente', 'Abre leilão por quantidade', 'É recusada na entrada'], ok: 1,
      why: `${fq(q)} passa de ${fq(i.qtyAuction)}, o limite de leilão, mas não de ${fq(i.qtyReject)}, a partir do qual a oferta é recusada.` }; } },

  /* ------------------------------ COMO O LEILÃO TERMINA ------------------------------ */
  { id: 'prot', grp: 'leilao', title: 'Prorrogação por proteção de preço', sub: 'Notícia forte: o teórico sai da faixa verde-petróleo',
    goal: 'como a faixa de proteção segura um leilão que quer fechar longe do último negócio.',
    seed: 105, start: '10:16:00', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'Uma notícia forte', hl: ['chartWrap'],
        x: () => `Vamos simular uma notícia que faz o valor justo de PETR4 subir ${LB('5%')}. Os compradores vão atrás do preço, e o primeiro negócio que sairia fora de um túnel manda PETR4 para leilão.`,
        btn: 'Soltar a notícia', go: c => c.E.doNews(c.i, 1, 0.05), run: { until: lesStarted, max: 180 } },
      { t: 'Por que entrou em leilão', hl: ['chartWrap'], x: c => whyIn(c.i, lesAuc(c)) + '<br>Com um salto rápido, o túnel que estoura primeiro pode ser o do último preço ou o do preço médio.' },
      { t: 'A faixa de proteção', hl: ['panelBox'],
        x: c => { const a = lesAuc(c), i = c.i, fv = Math.round(i.fv / i.tick); return `A proteção vale ${pctSpec(a.protSpec)} sobre ${LB(fpr(i, a.prot.c))}, o último negócio antes do leilão: de ${LB(fp(i, a.prot.lo))} a ${LB(fp(i, a.prot.hi))}.<br>Só que, depois da notícia, o valor justo está perto de ${LB(fpr(i, fv))}, ${fv >= a.prot.hi ? 'acima da faixa' : 'perto da borda'}. As ofertas do leilão chegam perto dele, e o teórico caminha junto: agora ${fpr(i, a.theo)}, ${bandPos(a)}. O painel mostra essa posição ao vivo.`; },
        btn: 'Ver o fim previsto', run: RUN_PRORR1 },
      { t: 'Por que foi prorrogado', hl: ['chartWrap', 'panelBox'], skip: c => !lesNProrr(c),
        x: c => { const a = lesAuc(c); return whyProrr(c.i, a, a.prorr[0]) + '<br>Cada prorrogação estica o bloco dourado para a direita, com o motivo escrito. No novo fim previsto, o sistema confere tudo de novo.'; },
        btn: 'Ver até o fim', run: RUN_END },
      { t: 'Fim do leilão', hl: ['chartWrap'], x: c => endText(c.i, lesAuc(c)) + recenterText(c.i) }
    ],
    recap: () => [
      `A proteção é conferida no fim do leilão, sobre o último negócio antes dele (${pctSpec(CONFIG.groups.IBOV.protAuction)} em ações do Ibovespa).`,
      'Teórico na borda ou fora da faixa prorroga o leilão em 1 min, para o mercado reagir.',
      `Depois de ${CONFIG.prorrogation.maxProtection} prorrogações por proteção, a supervisão de mercado autoriza o encerramento.`
    ],
    quiz: c => { const i = c.i, a = lesAuc(c); return {
      q: `Num leilão com proteção de ${fp(i, a.prot.lo)} a ${fp(i, a.prot.hi)}, o teórico termina exatamente em ${fpr(i, a.prot.hi)}. O leilão prorroga?`,
      opts: ['Sim: no limite já prorroga', 'Não: ainda está dentro da faixa', 'Não: a proteção só vale nos calls'], ok: 0,
      why: 'Na proteção, o limite conta como fora: teórico igual ao limite superior ou ao inferior já prorroga.' }; } },

  { id: 'alt', grp: 'leilao', title: 'Prorrogação por alteração', sub: 'A escada de 60, 30 e 15 s e as quatro luzes',
    goal: 'como ofertas de última hora prorrogam o leilão, e por que isso acaba depois de três vezes.',
    seed: 106, start: '10:16:00', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'Abrindo um leilão', hl: ['chartWrap'],
        x: () => 'Vamos abrir um leilão em PETR4 com uma compra grande. Perto do fim, você vai mandar ofertas tardias e ver o leilão prorrogar por alteração.',
        btn: 'Abrir o leilão', go: c => c.E.doWhale(c.i, 1), run: RUN_AUC },
      { t: 'As quatro medidas', hl: ['apLights'],
        x: () => `O leilão prorroga por alteração quando, perto do fim, muda alguma destas medidas: ${LB('1)')} preço teórico; ${LB('2)')} quantidade teórica; ${LB('3)')} uma oferta nova muda o quanto outra seria atendida; ${LB('4)')} saldo não atendido. Cada uma acende uma luz no painel.<br>A ideia: se alguém mexeu no leilão perto do fim, os outros ganham tempo para reagir. A janela que conta encolhe a cada vez: ${LB('último minuto')} para a 1ª prorrogação, ${LB('últimos 30 s')} para a 2ª e ${LB('últimos 15 s')} para a 3ª.`,
        btn: 'Esperar até faltar 45 s', run: { until: c => lesRemain(c) <= 45 || lesEnded(c), max: 400 } },
      { t: 'Uma oferta tardia', hl: ['apLights'], skip: lesEnded,
        x: () => `Faltam 45 s. Até aqui nada mudou no último minuto: se o leilão acabasse agora, não prorrogaria. Vamos mandar uma ${LB('compra tardia')} ao preço teórico.`,
        btn: 'Enviar compra tardia', go: c => lateOrder(c, 1) },
      { t: 'O que a oferta mudou', hl: ['apLights'], skip: lesEnded,
        x: c => `${lateDesc(c)} Como isso aconteceu no último minuto, o leilão vai prorrogar no fim previsto.`,
        btn: 'Ver o fim previsto', run: { until: c => lesNProrr(c) >= 1 || lesEnded(c), max: 120, speed: 'lento' } },
      { t: c => `1ª prorrogação: ${PRORR_SHORT[(lesAuc(c).prorr[0] || {}).code] || ''}`, hl: ['panelBox'], skip: c => lesNProrr(c) < 1,
        x: c => { const a = lesAuc(c); return whyProrr(c.i, a, a.prorr[0]) + `<br>Agora a janela que decide a 2ª prorrogação é de só ${LB('30 s')}: uma alteração antes disso não conta. Vamos mandar uma venda faltando 20 s.`; },
        btn: 'Enviar venda faltando 20 s',
        run: { tick: c => { if (!c.d.s2 && lesRemain(c) <= 20) { c.d.s2 = true; lateOrder(c, -1); } }, until: c => lesNProrr(c) >= 2 || lesEnded(c), max: 120, speed: 'lento' } },
      { t: c => `2ª prorrogação: ${PRORR_SHORT[(lesAuc(c).prorr[1] || {}).code] || ''}`, hl: ['panelBox'], skip: c => lesNProrr(c) < 2,
        x: c => { const a = lesAuc(c); return `${lateDesc(c)} ${whyProrr(c.i, a, a.prorr[1])}<br>A janela da 3ª é de ${LB('15 s')}. Vamos mandar uma compra faltando 10 s.`; },
        btn: 'Enviar compra faltando 10 s',
        run: { tick: c => { if (!c.d.s3 && lesRemain(c) <= 10) { c.d.s3 = true; lateOrder(c, 1); } }, until: c => lesNProrr(c) >= 3 || lesEnded(c), max: 120, speed: 'lento' } },
      { t: c => `3ª prorrogação: ${PRORR_SHORT[(lesAuc(c).prorr[2] || {}).code] || ''}`, hl: ['panelBox'], skip: c => lesNProrr(c) < 3,
        x: c => { const a = lesAuc(c); return `${lateDesc(c)} ${whyProrr(c.i, a, a.prorr[2])}<br>A escada tem só ${LB('três degraus')}. Daqui em diante, alteração não prorroga mais; só a proteção. Vamos testar com uma oferta faltando 5 s.`; },
        btn: 'Enviar venda faltando 5 s',
        run: { tick: c => { if (!c.d.s4 && lesRemain(c) <= 5) { c.d.s4 = true; lateOrder(c, -1); } }, until: lesEnded, max: 120, speed: 'lento' } },
      { t: 'Fim do leilão', hl: ['chartWrap'],
        x: c => (c.d.s4 ? `${lateDesc(c)} Mesmo assim, o leilão encerrou: a escada de prorrogações por alteração já tinha acabado.<br>` : '') + endText(c.i, lesAuc(c)) + recenterText(c.i) }
    ],
    recap: () => [
      'Uma alteração perto do fim (teórico, quantidade teórica, atendimento ou saldo) prorroga o leilão em 1 min.',
      'A janela encolhe: último minuto para a 1ª prorrogação, últimos 30 s para a 2ª e últimos 15 s para a 3ª.',
      'Depois da 3ª, alteração não prorroga mais; só a proteção.'
    ],
    quiz: () => ({
      q: 'Um leilão já prorrogou uma vez por alteração. Uma oferta nova muda o teórico faltando 40 s para o novo fim, e nada mais muda. Ele prorroga de novo?',
      opts: ['Sim: foi no último minuto', 'Não: para a 2ª, a alteração precisa vir nos últimos 30 s', 'Sim, mas só por 30 s'], ok: 1,
      why: 'A 2ª prorrogação por alteração só conta mudanças nos últimos 30 s. Se o teórico estiver dentro da proteção, o leilão encerra no fim previsto.' }) },

  { id: 'call', grp: 'leilao', title: 'Call de abertura com gap', sub: 'Notícia de madrugada e a proteção dos calls',
    goal: 'como o pregão das ações abre por leilão, e o que segura a abertura quando o preço salta.',
    seed: 107, start: '09:57:30', focus: 'PETR4', quiet: ['PETR4'], gap: { tk: 'PETR4', pct: 0.075 },
    steps: [
      { t: 'O call de abertura', hl: ['panelBox', 'chartWrap'],
        x: c => { const i = c.i, a = i.auction; if (!a) return 'PETR4 não está em call agora.'; return `Das 09:45 às 10:00, as ações ficam em ${LB('call de abertura')}: as ofertas se acumulam, ninguém negocia, e o preço teórico aparece ao vivo. No mapa, o ativo em call tem contorno tracejado.<br>PETR4 teve notícia de madrugada: o teórico está em ${LB(fpr(i, a.theo))}, ${fpct(a.theo / i.prevCloseT - 1)} sobre o fechamento anterior (${fpr(i, i.prevCloseT)}).<br>Nos calls, a proteção é mais larga: ${pctSpec(a.protSpec)} sobre o fechamento anterior, de ${LB(fp(i, a.prot.lo))} a ${LB(fp(i, a.prot.hi))}.`; },
        btn: 'Ver as 10:00', run: { until: c => lesNProrr(c) >= 1 || lesEnded(c), max: 300 } },
      { t: 'Por que foi prorrogado', hl: ['chartWrap', 'panelBox'], skip: c => !lesNProrr(c),
        x: c => { const a = lesAuc(c); return whyProrr(c.i, a, a.prorr[0]) + '<br>As outras ações abriram às 10:00. PETR4 continua em call até o teórico voltar para dentro da faixa, ou até a supervisão autorizar.'; },
        btn: 'Ver até abrir', run: RUN_END },
      { t: 'A abertura', hl: ['chartWrap'],
        x: c => { const i = c.i, a = lesAuc(c); let s = endText(i, a); if (a && a.price != null && Math.abs(a.price / i.prevCloseT - 1) <= i.g.est.pct) s += `<br>A abertura ficou dentro de ${pctSpec(i.g.est)}, então o túnel estático continua no primeiro degrau.`; return s + recenterText(i); } }
    ],
    recap: () => [
      'Das 09:45 às 10:00, as ações ficam em call de abertura: as ofertas se acumulam e o teórico aparece ao vivo.',
      `No call, a proteção é mais larga: ${pctSpec(CONFIG.groups.IBOV.protCall)} sobre o fechamento anterior, em ações do Ibovespa.`,
      `Teórico na borda ou fora da faixa às 10:00 prorroga a abertura. Depois de ${CONFIG.prorrogation.maxProtection} vezes, a supervisão autoriza.`
    ],
    quiz: c => { const i = c.i, pb = c.E.protBand(i, i.prevCloseT, i.g.protCall), th = pb.hi - 2; return {
      q: `Uma ação do Ibovespa fechou ontem a ${fpr(i, i.prevCloseT)}. Às 10:00, o teórico do call dela está em ${fpr(i, th)}, e nada mudou no último minuto. Ela abre?`,
      opts: ['Abre às 10:00', 'Prorroga por proteção', 'Fica em call até o fim do dia'], ok: 0,
      why: `${pctSpec(i.g.protCall)} sobre ${fpr(i, i.prevCloseT)} vai de ${fp(i, pb.lo)} a ${fp(i, pb.hi)}. O teórico, ${fp(i, th)}, fica dentro da faixa, então a abertura sai às 10:00.` }; } },

  /* ------------------------------ OPÇÕES ------------------------------ */
  { id: 'optun', grp: 'opcao', title: 'O túnel assíncrono da opção', sub: 'PETR4 anda e o túnel da opção anda junto',
    goal: 'por que o túnel de uma opção se mexe mesmo quando ninguém negocia a opção.',
    seed: 201, start: '10:16:00', focus: 'PETRJ400', quiet: ['PETRJ400', 'PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'Um túnel que vem de fora', hl: ['chartWrap'],
        x: c => { const i = c.i, u = i.tun.ult, P = c.E.by.PETR4; return `PETRJ400 é uma ${LB('opção de compra')} de PETR4 com strike ${LB('R$ 40,00')}. O centro do tubo dourado não é o último negócio da opção: é o ${LB('preço teórico')} (Black-Scholes), calculado com PETR4 a ${fpr(P, P.baseT)}. Agora ele vale ${LB(fpr(i, u.c))}.<br>Os limites (${LB(fp(i, u.lo))} e ${LB(fp(i, u.hi))}) são o teórico com a volatilidade 4 pontos abaixo e acima, usando a mínima e a máxima de PETR4 nos últimos ${CONFIG.option.windowSec} s. O mini-gráfico embaixo mostra PETR4.`; },
        btn: 'Fazer PETR4 subir',
        go: c => {
          const E = c.E, P = E.by.PETR4, i = c.i, pv = E.by.PETRV370;
          c.d.S0 = P.baseT; c.d.u0 = Object.assign({}, i.tun.ult); c.d.p0 = Object.assign({}, pv.tun.ult); c.d.nt0 = i.nTrades;
          const tgt = P.tun.ult.hi - 1;
          E.doNews(P, 1, tgt / P.baseT - 1);   // o valor justo acompanha: o novo nível se sustenta
          E.updateFV(0);                       // aplica a notícia já (sem sorteio), antes de os formadores recotarem
          E.doSweepTo(P, 1, tgt, 'Corretora 72');
          for (const mm of P.mms) { E.mmQuote(P, mm); mm.next = E.t + mm.every; } // formadores recotam na hora (sem compras velhas no topo do livro)
          c.d.tJump = E.t;
        },
        run: { until: c => c.E.t >= c.d.tJump + 3, max: 10 } },
      { t: 'O túnel andou junto com PETR4', hl: ['chartWrap', 'miniWrap'],
        x: c => {
          const E = c.E, P = E.by.PETR4, i = c.i, u0 = c.d.u0, u1 = i.tun.ult, nt = i.nTrades - c.d.nt0;
          c.d.u1 = Object.assign({}, u1);
          return `PETR4 foi de ${fpr(P, c.d.S0)} para ${LB(fpr(P, P.baseT))} (${fpct(P.baseT / c.d.S0 - 1)}). O centro do túnel de PETRJ400 foi de ${fp(i, u0.c)} para ${LB(fp(i, u1.c))}, e o limite superior de ${fp(i, u0.hi)} para ${LB(fp(i, u1.hi))}. Quem moveu o túnel foi PETR4, não os negócios da opção.<br>` +
            (nt ? `Nesse meio-tempo, PETRJ400 teve ${nt} negócio${nt > 1 ? 's' : ''}: compradores foram atrás das ofertas de venda que ficaram baratas de repente.<br>` : '') +
            `O limite inferior ${u1.lo === u0.lo ? 'não mudou' : `quase não mudou (${fp(i, u0.lo)} → ${fp(i, u1.lo)})`}: ele usa a ${LB('mínima de PETR4 nos últimos ' + CONFIG.option.windowSec + ' s')}, que ainda é o preço de antes da alta. Durante um salto, o túnel da opção ${LB('alarga')}.`;
        },
        btn: `Esperar a janela de ${CONFIG.option.windowSec} s`, run: { until: c => c.E.t >= c.d.tJump + CONFIG.option.windowSec + 2, max: 90, watch: `A janela de ${CONFIG.option.windowSec} s está passando: observe o limite inferior do tubo dourado subir quando o preço antigo de PETR4 sair dela.` } },
      { t: 'A janela passou', hl: ['chartWrap'],
        x: c => {
          const E = c.E, i = c.i, u1 = c.d.u1, u2 = i.tun.ult, pv = E.by.PETRV370, n = outCount(i);
          return `Passados ${CONFIG.option.windowSec} s, o preço antigo de PETR4 saiu da janela: o limite inferior subiu de ${fp(i, u1.lo)} para ${LB(fp(i, u2.lo))}. O túnel voltou à largura normal, agora em torno do novo teórico, ${LB(fpr(i, u2.c))}.<br>` +
            (n ? `No livro de PETRJ400, ${n} oferta${n > 1 ? 's' : ''} antiga${n > 1 ? 's ficaram' : ' ficou'} fora do túnel (marcadas “fora”). Se alguém negociar com elas, a opção entra em leilão sem que o preço dela tenha andado: quem andou foi PETR4.<br>`
               : 'Ofertas antigas que ficam fora do túnel aparecem marcadas como “fora” no livro. Se alguém negociar com elas, a opção entra em leilão sem que o preço dela tenha andado: quem andou foi PETR4.<br>') +
            `Na opção de venda PETRV370, é o contrário: PETR4 subiu e o túnel da put desceu (centro de ${fp(pv, c.d.p0.c)} para ${fp(pv, pv.tun.ult.c)}).`;
        } }
    ],
    recap: () => [
      'O túnel da opção é assíncrono: o centro é o teórico calculado com o preço do ativo-objeto.',
      'Quando o ativo-objeto anda, o túnel da opção anda junto, mesmo sem negócio na opção.',
      `Os limites usam a máxima e a mínima do objeto nos últimos ${CONFIG.option.windowSec} s: num salto, o túnel alarga e depois volta ao normal.`
    ],
    quiz: () => ({
      q: 'PETR4 cai 2% de repente e ninguém negocia PETRJ400, a opção de compra. O que acontece com o túnel dela?',
      opts: ['Fica parado até sair um negócio na opção', 'Desce junto com o teórico', 'Sobe, porque a opção ficou mais barata'], ok: 1,
      why: 'O centro do túnel é o teórico da opção, calculado com PETR4. Com PETR4 mais barata, a opção de compra vale menos, e o túnel desce sem precisar de negócio.' }) },

  { id: 'optauc', grp: 'opcao', title: 'Leilão na opção', sub: 'Por que a opção entrou e por que prorrogou',
    goal: 'como um leilão de opção nasce do teórico e por que a proteção costuma prorrogá-lo.',
    seed: 206, start: '10:16:00', focus: 'PETRJ400', quiet: ['PETRJ400', 'PETR4'], gap: { tk: 'B3SA3', pct: 0.012 },
    steps: [
      { t: 'O tubo da opção', hl: ['chartWrap'],
        x: c => { const i = c.i, u = i.tun.ult, P = c.E.by.PETR4; return `O tubo dourado de PETRJ400 vai de ${LB(fp(i, u.lo))} a ${LB(fp(i, u.hi))}, em torno do teórico ${fpr(i, u.c)}, calculado com PETR4 a ${fpr(P, P.baseT)}.<br>Um comprador vai varrer o livro da opção até passar do limite superior.`; },
        btn: 'Mandar a compra',
        go: c => { const i = c.i, u = i.tun.ult; c.d.pre = Object.assign({}, u); c.E.doPush(i, 1, u.hi, u.hi + 3, 'compra agressiva', q => `Compra agressiva simulada em PETRJ400: ${fq(q)} opções com limite ${fpr(i, u.hi + 3)}.`, null, 5 * i.lot); },
        run: RUN_AUC },
      { t: 'Por que entrou em leilão', hl: ['chartWrap'],
        x: c => { const i = c.i, a = lesAuc(c), pre = c.d.pre || {}; return whyIn(i, a) + (pre.sHi != null ? `<br>Esse limite não vem dos negócios da opção. É o teórico de PETRJ400 com PETR4 na máxima dos últimos ${CONFIG.option.windowSec} s (${fnum(pre.sHi, 2)}) e a volatilidade 4 pontos acima.` : ''); } },
      { t: 'A proteção na opção', hl: ['panelBox'],
        x: c => { const i = c.i, a = lesAuc(c); return `A faixa de proteção vale ${pctSpec(a.protSpec)} sobre ${LB(fpr(i, a.prot.c))}, o último negócio antes do leilão: de ${LB(fp(i, a.prot.lo))} a ${LB(fp(i, a.prot.hi))}. Em opções baratas, ela nunca tem menos de 3 ticks por lado. O teórico agora é ${LB(fpr(i, a.theo))}, ${bandPos(a)}.<br>Repare: o último negócio antes do leilão foi no topo da varredura, mas as ofertas do leilão chegam perto do valor justo da opção, que é calculado com PETR4.`; },
        btn: 'Ver o fim previsto', run: RUN_PRORR1 },
      { t: 'Por que foi prorrogado', hl: ['chartWrap', 'panelBox'], skip: c => !lesNProrr(c),
        x: c => { const a = lesAuc(c); return whyProrr(c.i, a, a.prorr[0]) + '<br>Na opção isso é comum: a faixa é estreita e fica ancorada num negócio que perde a referência quando o mercado se move.'; },
        btn: 'Ver até o fim', run: RUN_END },
      { t: 'Fim do leilão', hl: ['chartWrap'],
        x: c => endText(c.i, lesAuc(c)) + recenterText(c.i) + '<br>Na opção de venda (PETRV370), a lógica é a mesma, com o sinal trocado: quando PETR4 sobe, o túnel da put desce.' }
    ],
    recap: () => [
      'Na opção, o túnel de leilão também vem do teórico calculado com o ativo-objeto.',
      `A proteção (${pctSpec(CONFIG.groups.OPC.protAuction)} em opções) fica presa ao último negócio antes do leilão, que pode estar longe do valor justo.`,
      'Por isso, leilões de opção prorrogam por proteção com frequência, até a supervisão encerrar.'
    ],
    quiz: c => { const i = c.i, a = lesAuc(c); return {
      q: 'Por que o leilão da opção prorrogou nesta aula?',
      opts: ['Uma corretora concentrou lotes demais', 'O teórico foi para perto do valor justo, fora da faixa presa ao último negócio', 'Houve alteração no último minuto'], ok: 1,
      why: a ? `O último negócio antes do leilão foi ${fpr(i, a.prot.c)}, no topo da varredura, e a faixa ficou de ${fp(i, a.prot.lo)} a ${fp(i, a.prot.hi)}. As ofertas do leilão vieram perto do valor justo, e o teórico terminou ${a.price != null ? 'em ' + fpr(i, a.price) : 'fora dela'}.` : '' }; } },

  { id: 'optcall', grp: 'opcao', title: 'Call da opção com gap', sub: 'PETR4 abre em alta e a alavancagem estoura a proteção',
    goal: 'como a alavancagem de uma opção faz a proteção do call estourar com facilidade.',
    seed: 208, start: '09:57:30', focus: 'PETRJ400', quiet: ['PETRJ400', 'PETRV370', 'PETR4'], gap: { tk: 'PETR4', pct: 0.075 },
    steps: [
      { t: 'O call da opção', hl: ['panelBox', 'chartWrap'],
        x: c => {
          const E = c.E, i = c.i, a = i.auction, P = E.by.PETR4, pa = P.auction; if (!a) return 'PETRJ400 não está em call agora.';
          return `PETR4 teve notícia de madrugada: no call de abertura dela, o teórico está em ${LB(fpr(P, pa ? pa.theo : P.refT()))} (${fpct((pa ? pa.theo : P.refT()) / P.prevCloseT - 1)}).<br>` +
            `As ofertas no call de PETRJ400 precificam a opção com esse PETR4. O teórico da opção está em ${LB(fpr(i, a.theo))}, ${LB(fpct(a.theo / i.prevCloseT - 1, 0))} sobre o fechamento anterior (${fpr(i, i.prevCloseT)}).<br>` +
            `A proteção dos calls de opções é ${pctSpec(a.protSpec)} sobre o fechamento anterior: de ${LB(fp(i, a.prot.lo))} a ${LB(fp(i, a.prot.hi))}.`;
        },
        btn: 'Ver as 10:00', run: { until: c => lesNProrr(c) >= 1 || lesEnded(c), max: 300 } },
      { t: 'Por que foi prorrogado', hl: ['chartWrap', 'panelBox'], skip: c => !lesNProrr(c),
        x: c => { const a = lesAuc(c), P = c.E.by.PETR4, pa = P.auction || P.auctions[P.auctions.length - 1]; const up = pa && pa.theo != null ? pa.theo / P.prevCloseT - 1 : null;
          return whyProrr(c.i, a, a.prorr[0]) + `<br>É a ${LB('alavancagem')} da opção: ${up != null ? `uma alta de ${fpctAbs(up)} em PETR4` : 'uma alta forte em PETR4'} vira uma alta de ${fpctAbs(a.theo / c.i.prevCloseT - 1, 0)} numa opção de compra fora do dinheiro. A faixa, pensada para a opção, fica pequena para esse salto.`; },
        btn: 'Ver até abrir', run: RUN_END },
      { t: 'A abertura', hl: ['chartWrap'],
        x: c => { const pv = c.E.by.PETRV370, pa = pv.auctions[0]; return endText(c.i, lesAuc(c)) + (pa && pa.theo != null ? `<br>Na opção de venda PETRV370 aconteceu o contrário: com PETR4 em alta, o teórico dela foi para ${fpr(pv, pa.theo)} (${fpct(pa.theo / pv.prevCloseT - 1, 0)}), abaixo da faixa de proteção.` : ''); } }
    ],
    recap: () => [
      `No call das opções, a proteção é de ${pctSpec(CONFIG.groups.OPC.protCall)} sobre o fechamento anterior.`,
      'A alavancagem faz uma alta moderada no objeto virar uma alta muito maior, em porcentagem, numa opção de compra fora do dinheiro.',
      'Por isso a proteção estoura com facilidade, e a abertura da opção prorroga até a supervisão autorizar.'
    ],
    quiz: c => { const pv = c.E.by.PETRV370, pa = pv.auctions[0], th = pa ? (pa.price != null ? pa.price : pa.theo) : null; return {
      q: 'PETR4 abre em alta de 7%. O que tende a acontecer com uma opção de venda (put) fora do dinheiro?',
      opts: ['Sobe cerca de 7%', 'Cai muito, em porcentagem', 'Não muda, porque ninguém negociou'], ok: 1,
      why: 'A put perde valor quando o objeto sobe, e a alavancagem amplia o efeito.' + (th != null ? ` Nesta aula, PETRV370 foi de ${fpr(pv, pv.prevCloseT)} para ${fpr(pv, th)} (${fpct(th / pv.prevCloseT - 1, 0)}) no call.` : '') }; } }
];
/* toda aula termina com o resumo e o teste rápido */
for (const l of LESSONS) {
  const last = l.steps[l.steps.length - 1];
  if (!last.btn) last.btn = 'Ver o resumo';
  l.steps.push({ t: 'Resumo da aula', summary: true, x: () => '', done: true });
}
