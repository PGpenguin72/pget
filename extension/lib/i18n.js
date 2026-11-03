// Fills elements marked with data-i18n (text), data-i18n-title,
// data-i18n-placeholder and data-i18n-aria-label from _locales/*/messages.json.
// Always sets text / attributes, never HTML.

export function t(key, subs) {
  return chrome.i18n.getMessage(key, subs) || key;
}

const ATTRS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-aria-label', 'aria-label'],
];

export function localizePage(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const [dataAttr, attr] of ATTRS) {
    for (const el of root.querySelectorAll(`[${dataAttr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(dataAttr)));
    }
  }
}
