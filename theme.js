(() => {
  'use strict';
  const storageKey = 'history-review-theme';
  const root = document.documentElement;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const validTheme = value => value === 'light' || value === 'dark';
  let preference = null;
  try {
    const saved = localStorage.getItem(storageKey);
    if (validTheme(saved)) preference = saved;
  } catch (_) { /* 本地存储不可用时，仍可在本页切换。 */ }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = theme === 'dark';
      button.textContent = dark ? '切换浅色' : '切换深色';
      button.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
      button.setAttribute('aria-pressed', String(dark));
      button.hidden = false;
    });
  }
  const preferredTheme = () => preference || (systemTheme.matches ? 'dark' : 'light');
  // 在正文绘制前应用配色，减少打开页面时的闪烁。
  applyTheme(preferredTheme());

  function initialize() {
    applyTheme(preferredTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(preference);
        try { localStorage.setItem(storageKey, preference); } catch (_) {}
      });
    });
    const backToTop = document.querySelector('.back-to-top');
    if (backToTop) {
      const updateTopButton = () => { backToTop.hidden = window.scrollY < 360; };
      updateTopButton();
      window.addEventListener('scroll', updateTopButton, { passive: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  systemTheme.addEventListener('change', () => {
    if (!preference) applyTheme(preferredTheme());
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) {
      preference = validTheme(event.newValue) ? event.newValue : null;
      applyTheme(preferredTheme());
    }
  });
})();
