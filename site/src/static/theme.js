// 主題切換：系統 → 淺色 → 深色 → 系統。選擇存在 localStorage（失敗也沒關係）。
(() => {
  const root = document.documentElement;
  const order = ['system', 'light', 'dark'];
  const get = () => { try { const v = localStorage.getItem('theme'); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
  const set = (v) => { try { v === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', v); } catch {} };
  const apply = (v) => {
    if (v === 'system') delete root.dataset.theme; else root.dataset.theme = v;
    for (const b of document.querySelectorAll('button.theme')) {
      b.dataset.mode = v;
      const txt = b.querySelector('.theme-txt');
      if (txt) txt.textContent = b.dataset[v];
      b.setAttribute('aria-label', `${b.title}: ${b.dataset[v]}`);
    }
  };
  apply(get());
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button.theme');
    if (!b) return;
    const next = order[(order.indexOf(get()) + 1) % order.length];
    set(next);
    apply(next);
  });
  // 點語言選單外面就關起來
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details.lang[open]')) if (!d.contains(e.target)) d.open = false;
  });
})();
