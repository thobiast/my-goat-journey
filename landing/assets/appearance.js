// Blocking, local head script: resolve presentation before the stylesheet can paint.
// Keep independent of app modules, diary storage and worker/update coordination.
(() => {
  const appBase = new URL('../app/', document.currentScript.src).pathname;
  const storageKey = `my-goat-journey:appearance:${appBase}`;
  const normalize = value => value === 'light' || value === 'dark' ? value : 'system';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  let preference = 'system';
  try {
    preference = normalize(localStorage.getItem(storageKey));
  } catch { /* Unavailable storage follows System until an explicit session choice. */ }

  function applyAppearance() {
    const dark = preference === 'dark' || (preference === 'system' && media.matches);
    const resolved = dark ? 'dark' : 'light';
    root.dataset.appearancePreference = preference;
    root.dataset.appearance = resolved;
    root.style.colorScheme = resolved;
    root.style.backgroundColor = dark ? '#090B0E' : '#f8f6ef';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#090B0E' : '#f8f6ef';
    document.querySelectorAll('[data-appearance-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.appearanceChoice === resolved));
    });
  }

  media.addEventListener('change', () => {
    if (preference === 'system') applyAppearance();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    // sessionStorage uses the same event type but does not own this preference.
    try {
      if (event.storageArea && event.storageArea !== localStorage) return;
    } catch { return; }
    preference = normalize(event.newValue);
    applyAppearance();
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-appearance-choice]').forEach(button => {
      button.addEventListener('click', () => {
        // Even selecting the resolved System theme makes this an explicit choice.
        preference = button.dataset.appearanceChoice;
        try {
          localStorage.setItem(storageKey, preference);
        } catch { /* Keep switching within this page when persistence is blocked. */ }
        applyAppearance();
      });
    });
    applyAppearance();
  }, { once: true });
  applyAppearance();
})();
