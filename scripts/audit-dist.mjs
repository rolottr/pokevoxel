#!/usr/bin/env node
/** Release artifact audit: audit source payload, then prove Vite copied it unchanged. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const product = join(dirname(new URL(import.meta.url).pathname), '..');
const scripts = join(product, 'scripts');
for (const script of ['audit-shell.mjs', 'audit-runtime.mjs']) {
  const result = spawnSync(process.execPath, [join(scripts, script)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const source = join(product, 'public', 'runtime');
const dist = join(product, 'dist', 'runtime');
if (!existsSync(dist)) throw new Error('dist/runtime is missing; run npm run build first.');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const files = readdirSync(source).sort();
if (JSON.stringify(files) !== JSON.stringify(readdirSync(dist).sort())) throw new Error('dist/runtime file set differs from audited public/runtime');
for (const file of files) if (digest(join(source, file)) !== digest(join(dist, file))) throw new Error(`dist runtime file differs from audited source: ${file}`);
for (const file of ['_headers', 'robots.txt', 'sitemap.xml', 'assets/pokevoxel.jpg']) {
  const sourceFile = join(product, 'public', file);
  const distFile = join(product, 'dist', file);
  if (!existsSync(sourceFile) || !existsSync(distFile)) throw new Error(`Cloudflare static asset is missing: ${file}`);
  if (digest(sourceFile) !== digest(distFile)) throw new Error(`Cloudflare static asset differs from its public source: ${file}`);
}
const headers = readFileSync(join(product, 'dist', '_headers'), 'utf8');
for (const rule of [
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Embedder-Policy: require-corp',
  'X-Content-Type-Options: nosniff',
  '/index.html',
  'Cache-Control: no-cache',
]) if (!headers.includes(rule)) throw new Error(`Cloudflare headers omit required rule: ${rule}`);
if (existsSync(join(product, 'public', '_redirects')) || existsSync(join(product, 'dist', '_redirects'))) {
  throw new Error('Cloudflare Worker Assets must not include a Pages _redirects fallback alongside not_found_handling.');
}
const wrangler = readFileSync(join(product, 'wrangler.jsonc'), 'utf8');
if (!wrangler.includes('"not_found_handling": "single-page-application"')) {
  throw new Error('Cloudflare Worker Assets SPA fallback is missing from wrangler.jsonc.');
}
const html = readFileSync(join(product, 'dist', 'index.html'), 'utf8');
if (html.includes('/pokevoxel/')) throw new Error('Production index still references the retired /pokevoxel/ base.');
if (!html.match(/(?:src|href)="\/assets\//)) throw new Error('Production index does not reference root-based Vite assets.');
for (const metadata of [
  '<link rel="canonical" href="https://pokevoxel.xyz/"',
  '<meta property="og:image" content="https://pokevoxel.xyz/assets/pokevoxel.jpg"',
  '<meta name="twitter:card" content="summary_large_image"',
  '<script type="application/ld+json">',
]) if (!html.includes(metadata)) throw new Error(`Production index omits SEO metadata: ${metadata}`);
const robots = readFileSync(join(product, 'dist', 'robots.txt'), 'utf8');
if (!robots.includes('Sitemap: https://pokevoxel.xyz/sitemap.xml')) throw new Error('Production robots.txt omits the canonical sitemap.');
const sitemap = readFileSync(join(product, 'dist', 'sitemap.xml'), 'utf8');
if (!sitemap.includes('<loc>https://pokevoxel.xyz/</loc>')) throw new Error('Production sitemap omits the canonical homepage.');
console.log(`Dist runtime audit passed: ${files.length} copied runtime files match the audited payload.`);
console.log('Cloudflare Worker Assets audit passed: root assets, SEO metadata, crawler files, isolation headers, cache policy, and Wrangler SPA fallback are present without a conflicting _redirects rule.');
