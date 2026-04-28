// lint-staged config -- runs from the repo root.
// Maps staged paths back into per-workspace cwds so the right configs apply.

const path = require('path');

module.exports = {
  // Frontend: run eslint --fix from inside the frontend dir (the wrapper
  // script handles cd + npx so paths resolve relative to frontend's config).
  'frontend/**/*.{ts,tsx,js,jsx}': (files) => {
    const rels = files
      .map((f) => path.relative('frontend', f).replace(/\\/g, '/'))
      .map((f) => `"${f}"`)
      .join(' ');
    return `node scripts/lint-frontend.js ${rels}`;
  },

  // Backend: typecheck the whole package once if any source file changed
  // (typecheck is project-wide, not per-file)
  'backend/**/*.{js,ts}': () => 'npm --prefix backend run typecheck',
};
