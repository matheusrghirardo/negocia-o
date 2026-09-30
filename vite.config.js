import { defineConfig } from 'vite';

// Os scripts do simulador ficam em public/js e carregam como scripts clássicos (compartilham o escopo global).
// O Vite cuida do resto: fontes, ícones, fórmulas e o CSS, importados por src/main.js.

// Para abrir dist/index.html com duplo clique (file://), o HTML final precisa de três ajustes:
// - sem type="module" nem crossorigin: Chrome/Edge bloqueiam os dois em file:// (CORS);
// - o script de entrada antes de js/01-config.js, como no modo dev: o simulador lê as cores
//   do CSS no init, e o Vite colocaria esse script por último.
function paraAbrirSemServidor() {
  return {
    name: 'para-abrir-sem-servidor',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const m = html.match(/\s*<script type="module" crossorigin src="([^"]+)"><\/script>/);
        if (!m) return html;
        return html
          .replace(m[0], '')
          .replace('<script defer src="./js/01-config.js">', `<script defer src="${m[1]}"></script>\n<script defer src="./js/01-config.js">`)
          .replace(/ crossorigin(?=[\s>])/g, '');
      }
    }
  };
}

export default defineConfig({
  // base relativo + saída num arquivo clássico (IIFE): dist/ abre sem servidor, até em ambiente sem npm.
  base: './',
  plugins: [paraAbrirSemServidor()],
  build: {
    outDir: 'docs', // vai para o GitHub: baixar e abrir docs/index.html, ou publicar pelo GitHub Pages (pasta /docs)
    cssCodeSplit: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } }
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 }
});
