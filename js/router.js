// Tiny history-API router for clean sub-paths on GitHub Pages.
// Deep links / refreshes work via the 404.html redirect shim.
import { BASE, url } from './config.js?v=1789066819';

let handler = () => {};

// Current route as a path relative to BASE, e.g. "maths/circles".
export function currentPath() {
  let p = decodeURIComponent(location.pathname);
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  return p.replace(/^\/+|\/+$/g, '');
}

export function navigate(to) {
  const clean = String(to).replace(/^\/+/, '');
  history.pushState({}, '', url(clean));
  window.scrollTo(0, 0);
  handler(currentPath());
}

export function start(fn) {
  handler = fn;
  window.addEventListener('popstate', () => handler(currentPath()));
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  handler(currentPath());
}
