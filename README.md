# Simulador dos túneis de negociação da B3

Site de estudo que simula um pregão da B3 ao vivo: mostra quando uma oferta é recusada pelo túnel de rejeição, quando um negócio vira leilão e por que um leilão é prorrogado. Traz 11 aulas guiadas com resumo e teste rápido, um guia dos túneis e um guia ilustrado de opções com laboratório de Black-Scholes.

**Autor: Matheus Ghirardo.** Criado como projeto de estudo sobre o funcionamento do pregão da B3.

Projeto educativo independente, sem vínculo com a B3. Ativos, preços e corretoras são fictícios; os parâmetros são aproximações didáticas das regras públicas.

## Abrir com dois cliques (sem instalar nada)

1. No GitHub, clique em **Code → Download ZIP** e descompacte.
2. Abra a pasta **`docs`** e dê dois cliques em **`index.html`**.

Funciona direto no navegador, sem Node e sem servidor, inclusive em computador corporativo. O `index.html` precisa ficar junto das pastas `assets/` e `js/` que estão ao lado dele dentro de `docs/`.

O `index.html` da raiz do projeto é a versão de desenvolvimento: aberto com dois cliques, ele só mostra um aviso apontando para `docs/`.

Para ter um link público do site, ative o GitHub Pages no repositório (**Settings → Pages → Branch `main`, pasta `/docs`**).

## O que tem no site

- **Pregão simulado**: mapa com 18 ativos fictícios (ações, ETF, futuros e opções), gráfico-túnel com os túneis de leilão, rejeição e proteção, régua de ofertas e painel do leilão com preço teórico e prorrogações.
- **Livro de ofertas lado a lado**: compra à esquerda e venda à direita, como nos home brokers. Mostra o spread, o último negócio, a pressão de compra e venda, e cada negócio saindo no preço com a quantidade negociada. Tocar numa oferta leva o preço à boleta.
- **Boleta**: ofertas limitadas, a mercado e MOA, com prévia do que acontece antes de enviar.
- **Aulas guiadas**: 11 roteiros em três trilhas (os túneis, como o leilão termina, opções), com teste no fim.
- **Guias**: como funcionam os túneis e um guia de opções em sete capítulos, com laboratório de Black-Scholes.
- **Modo compacto**: mostra um painel do simulador por vez. Tema claro e escuro.

## Fontes

- **B3** ([b3.com.br](https://www.b3.com.br)): materiais públicos sobre túneis de negociação (rejeição, leilão e proteção), leilões, prorrogações, circuit breaker e opções, usados como base das regras simuladas. Confira sempre a versão oficial vigente.
- **Ilustrações**: os diagramas e gráficos do site são desenhos próprios, feitos em código (SVG e canvas) para representar esses conceitos. O projeto não reproduz imagens da B3.

## Para desenvolver

- **Dois cliques em `iniciar.bat`.** Na primeira vez ele instala as dependências; depois sobe o servidor e abre http://localhost:5173 no navegador. Para parar, feche a janela preta.
- **Pelo terminal**, dentro desta pasta: `npm run dev`

Ao salvar qualquer arquivo com o servidor ligado, a página se atualiza sozinha. Depois de mudar o site, rode `npm run build` para atualizar a versão de dois cliques em `docs/`.

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática, em http://localhost:5173 |
| `npm run build` | Gera em `docs/` a versão final, que abre com dois cliques no `index.html` |
| `npm run preview` | Serve a pasta `docs/` em http://localhost:4173, para conferir a versão final |

## Estrutura

| Caminho | O que tem |
| --- | --- |
| `docs/` | A versão final, gerada por `npm run build`: abre com dois cliques em `docs/index.html` |
| `index.html` | A página: cabeçalho, abertura, simulador, aulas, guias e rodapé |
| `src/main.js` | Entrada do Vite: fontes, ícones, fórmulas (KaTeX), tema claro/escuro e animações |
| `src/styles/base.css` | O visual de todos os componentes. Cores e fontes no topo (`:root`), modo escuro logo abaixo |
| `src/styles/moderno.css` | Acabamentos: cabeçalho translúcido, botões, cartões, animações |
| `public/js/01-config.js` | `CONFIG`: túneis, horários, ativos e durações. É aqui que se ajustam os parâmetros |
| `public/js/02-motor.js` | O motor da simulação: livro, negócios, túneis, leilões e circuit breaker |
| `public/js/03-aulas.js` | As aulas guiadas: roteiros, resumos e testes |
| `public/js/04-grafico.js` | Estado da tela, laço principal, gráfico-túnel e régua |
| `public/js/05-interface.js` | Mapa, livro, boleta, feed, guias, laboratório de opções e navegação |
| `public/js/06-aula-guiada.js` | O cartão da aula e a inicialização do site |
| `vite.config.js` | Build com caminhos relativos e sem módulos ES, para `docs/` abrir sem servidor |

Os arquivos de `public/js` são scripts clássicos: carregam em ordem, com `defer`, e compartilham o escopo global. O `src/main.js` roda antes deles. Para criar um arquivo novo de simulador, inclua a tag `<script defer>` no `index.html` na posição certa.

## Bibliotecas

Todas de código aberto:

- [Vite](https://vite.dev) (MIT): servidor de desenvolvimento e build
- [Geist e Geist Mono](https://vercel.com/font) (SIL Open Font License 1.1), via Fontsource: fontes instaladas localmente
- [Lucide](https://lucide.dev) (ISC): ícones
- [KaTeX](https://katex.org) (MIT): fórmulas do modelo de Black-Scholes
