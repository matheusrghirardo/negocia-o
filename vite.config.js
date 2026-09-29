import { defineConfig } from 'vite';

// Os scripts do simulador ficam em public/js e carregam como scripts clássicos (compartilham o escopo global).
// O Vite cuida do resto: fontes, ícones, fórmulas e o CSS, importados por src/main.js.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 }
});
