// Base path: on GitHub Pages the site lives at /erin-study-schedule/.
// Locally (served from the repo root) it lives at /.
export const BASE = location.hostname.endsWith('github.io')
  ? '/erin-study-schedule/'
  : '/';

// Build an absolute URL for a data file or route, relative to BASE.
export const url = (p) => BASE + String(p).replace(/^\//, '');

export const STATUS = {
  N: { label: 'Not started', cls: 'st-n' },
  W: { label: 'Working on it', cls: 'st-w' },
  C: { label: 'Confident', cls: 'st-c' }
};

export const STATUS_CYCLE = ['N', 'W', 'C'];

// Direct-save via the Cloudflare Worker (Google sign-in gates the write).
// Clear googleClientId to disable and fall back to export → manual commit.
export const SAVE = {
  workerUrl: 'https://gcse-schedule-updater.roman-fq.workers.dev',
  googleClientId: '953687426765-0nnnmd0kdt2l7imaijcn4p38l9s11jeb.apps.googleusercontent.com',
};
