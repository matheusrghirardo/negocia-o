# Simulador dos túneis de negociação da B3

Site de estudo, de página única, que roda no seu computador. Um pregão simulado mostra, ao vivo, quando uma oferta é recusada pelo túnel de rejeição, quando um negócio vira leilão e por que um leilão é prorrogado. Traz 11 aulas guiadas com resumo e teste rápido, um guia dos túneis e um guia ilustrado de opções com laboratório de Black-Scholes.

Projeto educativo independente, sem vínculo com a B3. Ativos, preços e corretoras são fictícios; os parâmetros são aproximações didáticas das regras públicas.

Feito por **Matheus Ghirardo** para fins de estudo.

## Como abrir

- **Dois cliques em `iniciar.bat`.** Na primeira vez ele instala as dependências; depois sobe o servidor e abre http://localhost:5173 no navegador. Para parar, feche a janela preta.
- **Pelo terminal**, dentro desta pasta: `npm run dev`

Ao salvar qualquer arquivo com o servidor ligado, a página se atualiza sozinha.

O Node.js (v24 LTS) está instalado em `%LOCALAPPDATA%\Programs\nodejs` e no PATH do usuário. Terminais abertos antes da instalação precisam ser reabertos para enxergar o `npm`.

### Sem servidor (outro computador, ambiente corporativo)

Rode `npm run build` e leve a pasta `dist/` inteira. Nela, dois cliques em `index.html` abrem o site direto no navegador, sem Node nem servidor. O `index.html` precisa ficar junto das pastas `assets/` e `js/` que estão ao lado dele.

Abrir o `index.html` da raiz do projeto com dois cliques não funciona: ele é a versão de desenvolvimento e depende do `npm run dev`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática, em http://localhost:5173 |
| `npm run build` | Gera em `dist/` a versão final, que abre com dois cliques no `index.html` (sem servidor) |
| `npm run preview` | Serve a pasta `dist/` em http://localhost:4173, para conferir a versão final |

## Estrutura

| Caminho | O que tem |
| --- | --- |
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
| `public/favicon.svg` | Ícone do site |

Os arquivos de `public/js` são scripts clássicos: carregam em ordem, com `defer`, e compartilham o escopo global. O `src/main.js` roda antes deles. Para criar um arquivo novo de simulador, inclua a tag `<script defer>` no `index.html` na posição certa.

## Bibliotecas

- [Vite](https://vite.dev): servidor de desenvolvimento e build
- [Geist e Geist Mono](https://vercel.com/font), via Fontsource: fontes instaladas localmente
- [Lucide](https://lucide.dev): ícones
- [KaTeX](https://katex.org): fórmulas do modelo de Black-Scholes
