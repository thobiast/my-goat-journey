import { initializeLanguage } from './language.js';

const language = initializeLanguage();
// Load only the existing distributed plain texts. Never mount the app or open user storage.
for (const block of document.querySelectorAll('[data-license-src]')) {
  const status = block.previousElementSibling;
  status.dataset.i18n = 'legalLoading';
  language.translate();
  fetch(new URL(block.dataset.licenseSrc, document.baseURI))
    .then(response => {
      if (!response.ok) throw new Error('License request failed');
      return response.text();
    })
    .then(text => {
      block.textContent = text;
      status.dataset.i18n = 'legalOriginal';
    })
    .catch(() => { status.dataset.i18n = 'legalError'; })
    .finally(() => language.translate());
}
