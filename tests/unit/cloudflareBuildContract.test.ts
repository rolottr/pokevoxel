import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Cloudflare build contract', () => {
  it('packages the LÖVE archive in Node without a system zip executable', () => {
    const build = source('scripts/build-runtime.mjs');
    expect(build).toContain("import { zipSync } from 'fflate'");
    expect(build).not.toMatch(/execFileSync\(['"]zip['"]/);
  });

  it('publishes the built dist directory through Wrangler static assets', () => {
    const config = source('wrangler.jsonc');
    expect(config).toContain('"directory": "./dist"');
    expect(config).toContain('"not_found_handling": "single-page-application"');
    expect(existsSync(resolve(process.cwd(), 'public/_redirects'))).toBe(false);
  });
});
