#!/usr/bin/env node
// Optional frontend bundler — runs esbuild over public/js/main.js to produce
// public/dist/app.js (minified, source-mapped). Not wired into the Electron
// build today: index.html still loads /js/main.js directly. Switch to the
// bundle by editing index.html to <script src="/dist/app.js">.
//
// Usage:
//   npm run build:frontend          # one-shot prod build
//   npm run watch:frontend          # watch mode for dev
//
// Falls back to a no-op if esbuild isn't installed yet (it's in devDeps).

const path = require('node:path');

let esbuild;
try { esbuild = require('esbuild'); } catch (e) {
  console.error('esbuild is not installed. Run `npm install` first.');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const watch = process.argv.includes('--watch');
const config = {
  entryPoints: [path.join(ROOT, 'public/js/main.js')],
  outfile: path.join(ROOT, 'public/dist/app.js'),
  bundle: true,
  // No external libs imported via CDN — everything's already inline. The
  // bundler is purely there to minify + concatenate once we split the JS
  // into multiple modules.
  format: 'iife',
  target: ['es2022'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('  → watching public/js/ for changes...');
  } else {
    await esbuild.build(config);
    console.log('  → built public/dist/app.js');
  }
})().catch((err) => { console.error(err); process.exit(1); });
