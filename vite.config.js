import { defineConfig } from 'vite';

// Os scripts do simulador ficam em public/js e carregam como scripts clássicos (compartilham o escopo global).
// O Vite cuida do resto: fontes, ícones, fórmulas e o CSS, importados por src/main.js.
// O build do Vite sempre marca o script de entrada como type="module", mesmo com saída IIFE.
// Chrome/Edge bloqueiam type="module" em file:// (CORS), o que impede abrir dist/index.html com
// duplo clique. Esse plugin só tira a marca do HTML final; o conteúdo já não precisa dela.
function semTypeModule() {
  return {
    name: 'sem-type-module',
    transformIndexHtml: { order: 'post', handler: html => html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>') }
  };
}

export default defineConfig({
  // base relativo + saída num único arquivo clássico: dá pra abrir dist/index.html com duplo
  // clique (file://), sem servidor — útil em ambientes (ex.: corporativos) sem npm/servidor local.
  base: './',
  plugins: [semTypeModule()],
  build: {
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } }
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 }
});
