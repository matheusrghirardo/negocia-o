'use strict';
/* ============================================================================
   CONFIG — os percentuais dos túneis (grupos, mais abaixo) seguem os documentos
   publicados pela B3 em "Parâmetros dos túneis de negociação": tabela de ações de
   18/03/2026, planilhas de futuros de 2026 e tabela de opções de 02/10/2023. O
   restante (fluxo de ordens, escada de prorrogação das ações, durações dos leilões
   de ações, quantidades) é DIDÁTICO.

   ⚠ A B3 atualiza esses documentos com frequência. Antes de usar em aula,
   confira a versão vigente em b3.com.br.

   Convenções de limites (valem para todo o código):
   - Rejeição e leilão: limites arredondados ao tick PARA DENTRO (inferior com
     ceil, superior com floor) e INCLUSIVOS: preço igual ao limite está dentro.
       · rejeita se compra > superior ou venda < inferior;
       · dispara leilão se o negócio sairia > superior ou < inferior.
   - Opções (túnel assíncrono): limites saem do choque de volatilidade e são
     arredondados PARA FORA, nunca mais estreitos que CONFIG.option.minHalfTicks.
   - Proteção: limites arredondados ao tick MAIS PRÓXIMO e EXCLUSIVOS: se o
     preço teórico for >= superior ou <= inferior, o leilão/call prorroga.
   ============================================================================ */
const CONFIG = {
  // ---------------- relógio ----------------
  simStepSec: 0.25,                 // passo fixo da simulação (segundos simulados)
  speeds: { lento: 5, normal: 30, rapido: 120, turbo: 600 }, // s simulados por s real
  maxStepsPerFrame: 240,            // teto de passos por frame
  frameBudgetMs: 11,                // orçamento de CPU por frame para o motor
  uiRefreshMs: 200,                 // tabelas: no máximo 5 atualizações por segundo
  ffStepSec: 1,                     // passo agregado usado ao "pular" no tempo
  engineStart: '08:55:00',          // o motor nasce aqui (call dos futuros) e avança em silêncio
  startTime: '09:40:00',            // horário em que a pessoa entra no pregão

  // ---------------- grade horária (vigente em 2026, editável) ----------------
  schedule: {
    futures: { preOpen: '08:55', open: '09:00', close: '18:25' },
    stocks:  { preOpen: '09:45', open: '10:00', closeCall: '16:55', close: '17:00',
               afterStart: '17:30', afterEnd: '18:00' },
    options: { preOpen: '09:45', open: '10:00', closeCall: '16:55', close: '17:00' },
    afterMarket: { enabled: true, bandPct: 0.02 }, // só Ibovespa/IBrX-100, ±2% do fechamento
    dayEnd: '18:25'
  },

  // ---------------- regras gerais de túnel ----------------
  minAmplitudeStocks: 0.10,         // R$: amplitude mínima (por lado) do túnel de leilão
                                    // por oscilação e por preço médio, em ações
  vwapWindowSec: 60,                // janela do túnel de preço médio
  futuresCenter: { everySec: 30, moveFrac: 0.5 }, // futuros: centro atualizado em degraus
                                    // (a cada X s ou quando o preço anda moveFrac da meia-largura)
  refPriceEverySec: 15,             // "Most recent": preço de referência recalculado a cada X s
  option: { windowSec: 45, r: 0.1425, daysToExpiry: 15 },   // janela de máxima e mínima do ativo-objeto; juros; prazo

  // ---------------- grupos de túneis ----------------
  // Números conferidos nos parâmetros publicados pela B3 (página "Parâmetros dos túneis de negociação"):
  //   · ações e ETF: tabela "Mercado de Ações" de 18/03/2026. Preço-base LTP em todo o mercado à vista e rejeição
  //     de ±20% em todas as linhas. A proteção durante o leilão é MAIS LARGA que a dos calls (ex.: Ibovespa/IBrX 5% x 1,5%);
  //   · futuros: planilhas de índices (01/10/2026), moedas e juros em reais (14/09/2026), sempre o primeiro grupo do
  //     contrato, que é o vencimento mais líquido (W1, W3 e D1). Centro "Most Recent" nos túneis de rejeição e de leilão;
  //   · opções sobre ações: tabela de 02/10/2023 e metodologia de 13/11/2025 (choques RELATIVOS na volatilidade e no
  //     ativo-objeto, mais a amplitude mínima de banda, AMB).
  // pct = multiplicativo; abs = aditivo (R$, pontos ou p.p.); min = piso absoluto da faixa de proteção.
  // vwSec: janela do preço médio. Futuros mais líquidos: 15 s (planilhas); ações: CONFIG.vwapWindowSec.
  // rule / callRule: prorrogação por alteração no leilão e no call ("Fase Crítica", "Extensões" e "Duração de cada
  //   Extensão" das planilhas de futuros). Ações e opções usam CONFIG.prorrogation.
  // qtyProt: proteção por quantidade, em lotes por corretora, quando a B3 publica o valor do grupo.
  groups: {
    IBOV:   { label: 'Ações Ibovespa/IBrX', priceBase: 'LTP',
              rej: { pct: 0.20 }, ult: { pct: 0.015 }, med: { pct: 0.02 }, est: { pct: 0.10 },
              protAuction: { pct: 0.05 }, protCall: { pct: 0.015 }, minAmp: true, auctionSec: 180 },
    OUTROS: { label: 'Ações de outros índices', priceBase: 'LTP',
              rej: { pct: 0.20 }, ult: { pct: 0.03 }, med: { pct: 0.04 }, est: { pct: 0.10 },
              protAuction: { pct: 0.05 }, protCall: { pct: 0.03 }, minAmp: true, auctionSec: 180 },
    SMALL:  { label: 'Demais ações (small caps)', priceBase: 'LTP',
              rej: { pct: 0.20 }, ult: { pct: 0.085 }, med: { pct: 0.10 }, est: { pct: 0.10 },
              protAuction: { pct: 0.15 }, protCall: { pct: 0.03 }, minAmp: true, auctionSec: 180 },
    ETF:    { label: 'ETF', priceBase: 'LTP',
              rej: { pct: 0.20 }, ult: { pct: 0.04 }, med: { pct: 0.05 }, est: { pct: 0.10 },
              protAuction: { pct: 0.05 }, protCall: { pct: 0.03 }, minAmp: true, auctionSec: 180 },
    WIN:    { label: 'Mini Ibovespa', priceBase: 'MOSTRECENT', stepped: true, vwSec: 15,
              rej: { pct: 0.01 }, ult: { pct: 0.005 }, med: { pct: 0.008 }, est: null,
              protAuction: { pct: 0.012 }, protCall: { pct: 0.012 }, auctionSec: 60, qtyProt: 66000,
              rule: { ladder: [15, 15], extendSec: 30 }, callRule: { ladder: [], extendSec: 30 } },
    WDO:    { label: 'Mini dólar', priceBase: 'MOSTRECENT', stepped: true, vwSec: 15,
              rej: { pct: 0.014 }, ult: { pct: 0.007 }, med: { pct: 0.013 }, est: null,
              protAuction: { pct: 0.0175 }, protCall: { pct: 0.0175 }, auctionSec: 60, qtyProt: 4500,
              rule: { ladder: [15, 15], extendSec: 30 }, callRule: { ladder: [30], extendSec: 30 } },
    // DI1: a planilha não traz túnel de leilão por último preço ("-"): só o preço médio e a rejeição (em p.p. de taxa)
    DI1:    { label: 'DI de um dia', priceBase: 'MOSTRECENT', stepped: true, vwSec: 15,
              rej: { abs: 0.17 }, ult: null, med: { abs: 0.10 }, est: null,
              protAuction: { abs: 0.09 }, protCall: { abs: 0.09 }, auctionSec: 60, qtyProt: 100000,
              rule: { ladder: [15, 15], extendSec: 30 }, callRule: { ladder: [30], extendSec: 30 } },
    // Opções: volShock e spotShock são choques RELATIVOS (45% na volatilidade e 1,5% no ativo-objeto, no leilão;
    // 80% e 3%, na rejeição). amb = amplitude mínima de banda, em R$ somados e subtraídos do preço de referência.
    OPC:    { label: 'Opções sobre ações', priceBase: 'TEORICO',
              rej: { volShock: 0.80, spotShock: 0.03, amb: 0.30 },
              ult: { volShock: 0.45, spotShock: 0.015, amb: 0.10 },
              med: null, est: null,
              protAuction: { pct: 0.50, min: 0.25 }, protCall: { pct: 0.50, min: 0.25 }, auctionSec: 120 }
  },

  // ---------------- leilão ----------------
  auctionDuration: {
    bigOsc: 0.09, bigSec: 300,            // oscilação grande (>= 9%): 5 min
    extremeOsc: 0.50, extremeSec: 600,    // oscilação extrema (>= 50%): 10 min
    extreme2Osc: 1.00, extreme2Sec: 900,  // (>= 100%): 15 min
    qtySec: 300,                          // leilão por quantidade: 5 min
    futSec: 60, optSec: 120               // futuros: 1 min; opções: 2 min
  },
  prorrogation: {
    extendSec: 60,
    ladder: [60, 30, 15],                 // 1ª, 2ª e 3ª prorrogação por alteração
    maxProtection: 3,                     // após N prorrogações por proteção, a supervisão abre
    maxNoTheo: 2,
    qtyProtectionLots: 500                // proteção por quantidade: lotes por corretora, compra + venda (a B3 prorroga ao ATINGIR o parâmetro; exemplo da B3: 500)
  },

  // ---------------- circuit breaker ----------------
  circuitBreaker: {
    levels: [ { drop: 0.10, haltMin: 30 },
              { drop: 0.15, haltMin: 60 },
              { drop: 0.20, haltMin: 90, byB3: true } ], // prazo definido pela B3 (simulado)
    reopenCallMin: 5
  },

  // ---------------- mercado simulado ----------------
  market: { dailyVol: 0.012, tradingDaySec: 25200 },
  ibov: { start: 130000 },
  intensity: {
    calmo:   { flow: 0.7, vol: 0.6, events: 0.45, late: 0.7 },
    normal:  { flow: 1.0, vol: 1.0, events: 1.0,  late: 1.0 },
    agitado: { flow: 1.5, vol: 1.7, events: 2.2,  late: 1.25 }
  },
  flow: {
    passiveRatio: 0.8,
    mmEverySec: 2.2,
    callOrdersPerSec: 0.35,               // por unidade de atividade, no call de abertura
    closeCallOrdersPerSec: 0.45,
    auctionOrdersPerSec: 1.1,
    lateProb: [0.3, 0.45, 0.4]           // chance de oferta tardia em cada janela (60/30/15 s)
  },
  script: { news: 5, macro: 1, escada: 3, whale: 5, ffPrice: 8, ffQty: 4, qtyAuction: 2,
            gapMin: 0.06, gapMax: 0.09 },

  brokers: ['Corretora 03', 'Corretora 08', 'Corretora 13', 'Corretora 16', 'Corretora 21',
            'Corretora 27', 'Corretora 33', 'Corretora 39', 'Corretora 45', 'Corretora 58',
            'Corretora 63', 'Corretora 72', 'Corretora 77', 'Corretora 85', 'Corretora 90',
            'Corretora 107', 'Corretora 114', 'Corretora 120'],

  // ---------------- instrumentos (preços fictícios) ----------------
  // mapGroup: seção no mapa; tunnelGroup: linha da tabela de túneis.
  // qtyAuction: acima disso dispara leilão por quantidade; qtyReject: acima disso rejeita.
  instruments: [
    { ticker: 'PETR4', name: 'Petrobras PN', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 38.50, vol: 0.32, beta: 1.25, avgVolume: 40e6,
      qtyAuction: 400000, qtyReject: 4000000, ibovWeight: 0.20, activity: 1.6, tradeSize: 1500 },
    { ticker: 'VALE3', name: 'Vale ON', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 61.20, vol: 0.30, beta: 1.1, avgVolume: 25e6,
      qtyAuction: 250000, qtyReject: 2500000, ibovWeight: 0.21, activity: 1.5, tradeSize: 900 },
    { ticker: 'ITUB4', name: 'Itaú Unibanco PN', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 36.80, vol: 0.24, beta: 0.9, avgVolume: 22e6,
      qtyAuction: 220000, qtyReject: 2200000, ibovWeight: 0.16, activity: 1.3, tradeSize: 1100 },
    { ticker: 'BBDC4', name: 'Bradesco PN', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 15.40, vol: 0.28, beta: 1.0, avgVolume: 35e6,
      qtyAuction: 350000, qtyReject: 3500000, ibovWeight: 0.10, activity: 1.2, tradeSize: 2500 },
    { ticker: 'BBAS3', name: 'Banco do Brasil ON', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 27.90, vol: 0.30, beta: 1.1, avgVolume: 15e6,
      qtyAuction: 150000, qtyReject: 1500000, ibovWeight: 0.09, activity: 1.0, tradeSize: 1100 },
    { ticker: 'ABEV3', name: 'Ambev ON', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 13.10, vol: 0.22, beta: 0.7, avgVolume: 20e6,
      qtyAuction: 200000, qtyReject: 2000000, ibovWeight: 0.08, activity: 0.9, tradeSize: 2000 },
    { ticker: 'WEGE3', name: 'WEG ON', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 44.70, vol: 0.28, beta: 0.8, avgVolume: 6e6,
      qtyAuction: 60000, qtyReject: 600000, ibovWeight: 0.08, activity: 0.8, tradeSize: 500 },
    { ticker: 'B3SA3', name: 'B3 ON', type: 'stock', mapGroup: 'Ações Ibovespa', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 12.35, vol: 0.30, beta: 1.1, avgVolume: 25e6,
      qtyAuction: 250000, qtyReject: 2500000, ibovWeight: 0.08, activity: 1.1, tradeSize: 2500 },
    { ticker: 'LUMX3', name: 'Lumix Energia ON (fictícia)', type: 'stock', mapGroup: 'Outras ações', tunnelGroup: 'OUTROS',
      tick: 0.01, lot: 100, prevClose: 22.40, vol: 0.38, beta: 0.9, avgVolume: 4e6,
      qtyAuction: 40000, qtyReject: 400000, activity: 0.6, tradeSize: 600 },
    { ticker: 'TRVA3', name: 'Travessia Logística ON (fictícia)', type: 'stock', mapGroup: 'Outras ações', tunnelGroup: 'OUTROS',
      tick: 0.01, lot: 100, prevClose: 8.75, vol: 0.40, beta: 1.0, avgVolume: 6e6,
      qtyAuction: 60000, qtyReject: 600000, activity: 0.5, tradeSize: 1200 },
    // PQNO3 é barata e volátil, mas integra o IBrX-100 (fictício): usa a linha Ibovespa/IBrX.
    // 1,5% de R$ 1,85 daria só R$ 0,03 por lado → vale a amplitude mínima de R$ 0,10.
    { ticker: 'PQNO3', name: 'Pequeno Varejo ON (fictícia)', type: 'stock', mapGroup: 'Outras ações', tunnelGroup: 'IBOV',
      tick: 0.01, lot: 100, prevClose: 1.85, vol: 0.55, beta: 1.2, avgVolume: 30e6,
      qtyAuction: 300000, qtyReject: 3000000, activity: 0.6, tradeSize: 3000 },
    { ticker: 'VNTR3', name: 'Ventura Mineração ON (fictícia)', type: 'stock', mapGroup: 'Outras ações', tunnelGroup: 'SMALL',
      tick: 0.01, lot: 100, prevClose: 4.60, vol: 0.60, beta: 1.3, avgVolume: 5e6,
      qtyAuction: 100000, qtyReject: 1000000, activity: 0.45, tradeSize: 2000, spreadTicks: 2 },
    { ticker: 'BOVA11', name: 'ETF Ibovespa', type: 'etf', mapGroup: 'ETF', tunnelGroup: 'ETF',
      tick: 0.01, lot: 10, prevClose: 126.40, vol: 0.19, beta: 1.0, avgVolume: 5e6,
      qtyAuction: 50000, qtyReject: 500000, activity: 0.7, tradeSize: 300 },
    { ticker: 'WINV26', name: 'Mini Ibovespa out/26', type: 'fut', mapGroup: 'Derivativos', tunnelGroup: 'WIN',
      tick: 5, lot: 1, prevClose: 131850, settle: 131850, vol: 0.20, beta: 1.0, avgVolume: 2e6,
      qtyAuction: 2000, qtyReject: 25000, activity: 2.0, tradeSize: 6 },   // qtyReject: "quantidade máxima por oferta" (grupo W1)
    { ticker: 'WDOV26', name: 'Mini dólar out/26', type: 'fut', mapGroup: 'Derivativos', tunnelGroup: 'WDO',
      tick: 0.5, lot: 1, prevClose: 5482.0, settle: 5482.0, vol: 0.12, beta: -0.35, avgVolume: 800e3,
      qtyAuction: 1500, qtyReject: 50000, activity: 1.4, tradeSize: 4 },  // grupo W3
    { ticker: 'DI1F27', name: 'DI1 jan/27 (taxa % a.a.)', type: 'fut', mapGroup: 'Derivativos', tunnelGroup: 'DI1',
      tick: 0.001, lot: 1, prevClose: 14.215, settle: 14.215, volPP: 0.06, beta: -1.2, avgVolume: 400e3,
      qtyAuction: 5000, qtyReject: 50000, activity: 0.8, tradeSize: 40 },  // grupo D1
    { ticker: 'PETRJ400', name: 'Opção de compra PETR4 out/26, strike 40,00', type: 'opt', mapGroup: 'Derivativos',
      tunnelGroup: 'OPC', underlying: 'PETR4', cp: 'C', strike: 40.00, iv: 0.31,
      tick: 0.01, lot: 100, avgVolume: 8e6, qtyAuction: 200000, qtyReject: 2000000, activity: 0.6,
      tradeSize: 2000, spreadTicks: 2 },
    { ticker: 'PETRV370', name: 'Opção de venda PETR4 out/26, strike 37,00', type: 'opt', mapGroup: 'Derivativos',
      tunnelGroup: 'OPC', underlying: 'PETR4', cp: 'P', strike: 37.00, iv: 0.33,
      tick: 0.01, lot: 100, avgVolume: 6e6, qtyAuction: 200000, qtyReject: 2000000, activity: 0.5,
      tradeSize: 2000, spreadTicks: 2 }
  ]
};
