import base from '../eslint.config.js';
// Apply existing frontend rules to the audit's entry point and helpers too.
export default [...base, {
  ...base[0],
  files: ['src/App.jsx', 'src/hooks/**/*.{js,jsx}', 'src/lib/**/*.{js,jsx}'],
  ignores: [],
  rules: { ...base[0].rules, 'no-empty': ['error', { allowEmptyCatch: true }] },
}];
