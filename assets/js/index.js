(() => {
  'use strict';

  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('anns-theme');
  const defaultTheme = 'dark';

  function setTheme(theme) {
    root.dataset.theme = theme;
    toggle.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
    toggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  }

  setTheme(savedTheme || defaultTheme);
  toggle.addEventListener('click', () => {
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('anns-theme', nextTheme);
    setTheme(nextTheme);
  });
})();
