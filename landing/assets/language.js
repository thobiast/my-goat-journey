import { copy } from './translations.js';

// Presentation-only preference shared by the landing and its licensing page.
export function initializeLanguage(onChange = () => {}) {
  const preferenceKey = 'my-goat-journey.landing.language';
  let language = 'en';
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (saved === 'en' || saved === 'pt-BR') language = saved;
  } catch { /* Storage may be denied; English remains the default. */ }
  const buttons = [...document.querySelectorAll('[data-language]')];
  const getCopy = () => copy[language];
  function translate() {
    const text = getCopy();
    const legal = document.body.dataset.page === 'licenses';
    document.documentElement.lang = language;
    document.title = legal ? text.licensesTitle : text.title;
    document.querySelector('meta[name="description"]').content = legal ? text.licensesDescription : text.description;
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = text[node.dataset.i18n]; });
    // Rich copy permits text and emphasis tokens only, never translated HTML.
    document.querySelectorAll('[data-rich-i18n]').forEach(node => {
      node.replaceChildren(...text[node.dataset.richI18n].map(part => {
        if (typeof part === 'string') return document.createTextNode(part);
        const strong = document.createElement('strong');
        strong.textContent = part.strong;
        return strong;
      }));
    });
    document.querySelectorAll('[data-label]').forEach(node => { node.setAttribute('aria-label', text[node.dataset.label]); });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
    onChange();
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    language = button.dataset.language;
    try { localStorage.setItem(preferenceKey, language); } catch { /* Selection still works in memory. */ }
    translate();
  }));
  translate();
  return { getCopy, translate };
}
