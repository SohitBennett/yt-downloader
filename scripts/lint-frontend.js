// Wrapper for lint-staged: runs frontend's eslint from inside the frontend dir
// so it picks up the local eslint config and binary. Cross-platform.

const { execFileSync } = require('child_process');
const path = require('path');

const frontendDir = path.join(__dirname, '..', 'frontend');
const files = process.argv.slice(2);

if (files.length === 0) process.exit(0);

try {
  execFileSync('npx', ['eslint', '--fix', ...files], {
    cwd: frontendDir,
    stdio: 'inherit',
    shell: true, // npx is a .cmd on Windows; needs shell to resolve
  });
} catch {
  process.exit(1);
}
