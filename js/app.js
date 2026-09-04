import { start, currentPath } from './router.js?v=1788562101';
import { loadCore, subjectMeta } from './store.js?v=1788562101';
import * as views from './views.js?v=1788562101';

const root = document.getElementById('app');

async function route(path) {
  root.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const { subjects, profile } = await loadCore();
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0) return views.renderLanding(root, { subjects, profile });
    if (parts[0] === 'calendar') return views.renderCalendar(root, { profile });

    const subjectId = parts[0];
    const meta = subjectMeta(subjectId);
    if (!meta || meta.status !== 'active') return views.renderNotFound(root);

    if (parts.length === 1) return views.renderSubject(root, subjectId, profile);
    if (parts[1] === 'exam-technique') return views.renderExamTechnique(root, subjectId);
    return views.renderTopic(root, subjectId, parts[1], profile);
  } catch (err) {
    root.innerHTML = `<div class="error"><h1>Something went wrong</h1><pre>${String(err.message || err)}</pre>
      <a href="" data-link>Go home</a></div>`;
    console.error(err);
  }
}

start(route);
void currentPath;
