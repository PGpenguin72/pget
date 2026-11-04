// Applies the theme preference (system / light / dark) to <html data-theme>.
// "system" removes the attribute so the CSS falls back to prefers-color-scheme.
import { ext } from './ext.js';
import { getSettings } from './settings.js';

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export async function initTheme() {
  const { theme } = await getSettings();
  applyTheme(theme);
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.theme) applyTheme(changes.theme.newValue);
  });
}
