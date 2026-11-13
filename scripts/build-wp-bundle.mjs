import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = join(rootDir, 'dist');
const wpAppDir = join(rootDir, 'embed', 'hostinger-wp', 'apps', 'ask-avi');

if (!existsSync(distDir)) {
  console.error('dist/ does not exist. Run "npm run build" before building the WP bundle.');
  process.exit(1);
}

// Replace stale compiled frontend assets while preserving .htaccess and api/*.php
if (existsSync(join(wpAppDir, 'assets'))) {
  rmSync(join(wpAppDir, 'assets'), { recursive: true, force: true });
}
mkdirSync(wpAppDir, { recursive: true });

copyFileSync(join(distDir, 'index.html'), join(wpAppDir, 'index.html'));
if (existsSync(join(distDir, 'assets'))) {
  cpSync(join(distDir, 'assets'), join(wpAppDir, 'assets'), { recursive: true });
}
if (existsSync(join(distDir, '.nojekyll'))) {
  copyFileSync(join(distDir, '.nojekyll'), join(wpAppDir, '.nojekyll'));
}

console.log(`Synced built dist/ assets into ${wpAppDir}`);
