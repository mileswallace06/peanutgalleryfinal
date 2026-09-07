import js from '@eslint/js';
import globals from 'globals';

export default [{
  files: ['workers/notification/**/*.mjs', 'tests/external-notification-worker.test.mjs', 'tests/helpers/notificationWorker.mjs'],
  ...js.configs.recommended,
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
}];
