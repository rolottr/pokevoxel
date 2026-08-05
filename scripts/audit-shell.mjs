#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
if (!existsSync(dist)) throw new Error('dist/ is missing; run npm run build first.');
const forbiddenPath = /\.(?:gb|gbc|gba|sav|srm|love)$/i;
const forbiddenText = /(?:pisco|private-yellow-rom|pokemon\s*-\s*yellow|\/Users\/|runtime\/game\/|runtime\/mods\/)/i;
const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
};
walk(dist);
const failures = [];
for (const file of files) {
  const label = relative(dist, file);
  if (label.startsWith('runtime/')) continue; // Generated runtime has its own binary-safe audit.
  if (forbiddenPath.test(label)) failures.push(`forbidden artifact extension: ${label}`);
  if (forbiddenText.test(readFileSync(file, 'utf8'))) failures.push(`private/runtime marker in dist artifact: ${label}`);
}
if (failures.length) throw new Error(`Shell artifact audit failed:\n${failures.map((item) => ` - ${item}`).join('\n')}`);
console.log(`Shell artifact audit passed (runtime payload is audited separately): ${files.length} dist files contain no ROM, save, LÖVE, private-path, Pisco, or runtime payload marker.`);
