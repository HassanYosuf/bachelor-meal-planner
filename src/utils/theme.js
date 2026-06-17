export function initTheme() {
  const saved = localStorage.getItem('app-theme') || 'system';
  applyTheme(saved);
}

export function applyTheme(val) {
  if (val === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', val);
  }
}

export function setTheme(val) {
  localStorage.setItem('app-theme', val);
  applyTheme(val);
  updateThemeButtons(val);
}

export function updateThemeButtons(val) {
  document.querySelectorAll('#theme-opts .theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === val);
  });
}
