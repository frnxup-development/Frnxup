(() => {
  const KEY = 'frnxup-theme';
  const root = document.documentElement;
  const read = () => {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; }
    catch (_) { return 'light'; }
  };
  const apply = (value) => {
    const theme = value === 'dark' ? 'dark' : 'light';
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#080d17' : '#f5f8ff';
    return theme;
  };
  apply(read());
  const syncThemeColor = () => apply(read());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncThemeColor, { once: true });
  else syncThemeColor();
  window.FRNXUP_THEME = {
    get: read,
    apply,
    toggle() {
      const next = root.classList.contains('dark') ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (_) {}
      apply(next);
      return next;
    }
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    event.preventDefault();
    const next = window.FRNXUP_THEME.toggle();
    button.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
    button.setAttribute('aria-label', next === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance');
  });
})();
