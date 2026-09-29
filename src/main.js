// Entrada do Vite: fontes, estilos, ícones, fórmulas, tema e animações.
// O simulador roda nos scripts clássicos de public/js, que executam depois deste arquivo.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import 'katex/dist/katex.min.css';
import './styles/base.css';
import './styles/moderno.css';
import katex from 'katex';
import {
  createIcons, createElement,
  ChartCandlestick, GraduationCap, BookOpen, BookOpenText, SlidersHorizontal, Layers, Sun, Moon, Play, Pause,
  SkipForward, Sparkles, RotateCcw, Sigma, ArrowRight, Gauge, ChartSpline, Route, Coins, ListOrdered
} from 'lucide';

const ICONS = { ChartCandlestick, GraduationCap, BookOpen, BookOpenText, SlidersHorizontal, Layers, Sun, Moon, Play, Pause, SkipForward, Sparkles, RotateCcw, Sigma, ArrowRight, Gauge, ChartSpline, Route, Coins, ListOrdered };
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/* ícones: troca cada <i data-lucide="nome"> por um SVG; os scripts do simulador chamam de novo ao criar conteúdo */
window.refreshIcons = () => createIcons({ icons: ICONS, attrs: { 'stroke-width': 1.8, 'aria-hidden': 'true' } });
window.refreshIcons();

/* fórmulas em KaTeX: <div data-tex="..." data-display> */
for (const el of document.querySelectorAll('[data-tex]')) {
  katex.render(el.dataset.tex, el, { displayMode: el.hasAttribute('data-display'), throwOnError: false, output: 'html' });
}

/* tema claro ou escuro: segue o sistema até a pessoa escolher; a escolha fica salva neste navegador */
const TEMA = 'b3tuneis.tema';
const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const themeBtn = document.getElementById('themeBtn');
function paintThemeBtn() {
  if (!themeBtn) return;
  const svg = createElement(dark() ? Sun : Moon);
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('aria-hidden', 'true');
  themeBtn.replaceChildren(svg);
  themeBtn.setAttribute('aria-label', dark() ? 'Usar tema claro' : 'Usar tema escuro');
  themeBtn.title = themeBtn.getAttribute('aria-label');
}
themeBtn?.addEventListener('click', () => {
  root.dataset.theme = dark() ? 'light' : 'dark';
  try { localStorage.setItem(TEMA, root.dataset.theme); } catch { /* sem armazenamento: vale só nesta visita */ }
  paintThemeBtn();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeBtn);
paintThemeBtn();

/* cabeçalho fixo: altura em --headH (as outras partes fixas descontam) e sombra quando a página rola */
const head = document.querySelector('.site-head');
const prog = document.getElementById('scrollProg');
function syncHead() {
  const fixed = head && getComputedStyle(head).position === 'sticky';
  root.style.setProperty('--headH', (fixed ? Math.round(head.offsetHeight) : 0) + 'px');
}
syncHead();
if (head) new ResizeObserver(syncHead).observe(head);
matchMedia('(max-width: 1023px)').addEventListener('change', syncHead);
let raf = 0;
addEventListener('scroll', () => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    head?.classList.toggle('scrolled', scrollY > 8);
    if (prog) { const max = document.documentElement.scrollHeight - innerHeight; prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`; }
  });
}, { passive: true });

/* entrada suave das seções (só com movimento liberado; sem JavaScript, tudo aparece normalmente) */
if (!reduced.matches && 'IntersectionObserver' in window) {
  root.classList.add('js-anim');
  const alvos = document.querySelectorAll('.hero-text, .hero-fig, .sim-intro, .page-sec .sec-head, #lesGrid, #guideBody, .op-toc, .op-ch, .param-card, .site-foot .foot-in');
  const io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of alvos) { el.classList.add('reveal'); io.observe(el); }
}
