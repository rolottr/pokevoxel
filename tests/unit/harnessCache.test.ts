import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestPaths, fileHashes, publishDirectoryAtomically, validatesArtifacts } from '../../scripts/lib/harness.mjs';

describe('harness cache helpers', () => {
  it('hashes sorted inputs deterministically and changes when content changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pokevoxel-cache-'));
    try {
      const first = join(root, 'a'); const second = join(root, 'b');
      writeFileSync(first, 'one'); writeFileSync(second, 'two');
      const paths = [{ path: second, relativePath: 'b' }, { path: first, relativePath: 'a' }];
      const original = digestPaths(paths);
      expect(original).toBe(digestPaths([...paths].reverse()));
      writeFileSync(second, 'changed');
      expect(digestPaths(paths)).not.toBe(original);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects missing or tampered cached artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'pokevoxel-cache-'));
    try {
      writeFileSync(join(root, 'artifact'), 'safe');
      const hashes = fileHashes(root, ['artifact']);
      expect(validatesArtifacts(root, hashes)).toBe(true);
      writeFileSync(join(root, 'artifact'), 'tampered');
      expect(validatesArtifacts(root, hashes)).toBe(false);
      writeFileSync(join(root, 'artifact'), 'safe');
      writeFileSync(join(root, 'unexpected'), 'extra');
      expect(validatesArtifacts(root, hashes)).toBe(false);
      rmSync(join(root, 'unexpected'));
      rmSync(join(root, 'artifact'));
      expect(validatesArtifacts(root, hashes)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('publishes a complete candidate while retaining no partial public output', () => {
    const root = mkdtempSync(join(tmpdir(), 'pokevoxel-cache-'));
    try {
      const output = join(root, 'public'); const candidate = join(root, 'candidate');
      mkdirSync(output); writeFileSync(join(output, 'old'), 'old');
      mkdirSync(candidate); writeFileSync(join(candidate, 'new'), 'new');
      publishDirectoryAtomically(candidate, output);
      expect(readFileSync(join(output, 'new'), 'utf8')).toBe('new');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('includes shared cache behavior in both content-addressed input digests', () => {
    const runtimeBuild = readFileSync(join(process.cwd(), 'scripts', 'build-runtime.mjs'), 'utf8');
    const upstream = readFileSync(join(process.cwd(), 'scripts', 'verify-upstream.mjs'), 'utf8');
    expect(runtimeBuild).toContain("relativePath: 'scripts/lib/harness.mjs'");
    expect(upstream).toContain("relativePath: 'scripts/lib/harness.mjs'");
  });
});
