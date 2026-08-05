import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROM_PROFILES } from '../../src/import/romValidation';

const root = process.cwd();
const text = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8');

describe('tri-version welcome and license release contract', () => {
  it('renders the POKEVOXEL brand, all exact hashes, one generic picker, accessible social links, and an icon reset', () => {
    const welcome = text('src', 'ui', 'WelcomeScreen.ts');
    expect(welcome).toContain("brand-lockup");
    expect(welcome).toContain("brand-voxel");
    expect(welcome).toContain("rom-sha-list");
    expect(welcome).toContain("input.id = 'gen1-rom-input'");
    expect(welcome).toContain("input.accept = '.gb,.gbc,application/octet-stream'");
    expect(welcome).toContain("reset.className = 'start-over-icon'");
    expect(welcome).toContain("reset.setAttribute('aria-label', 'Start over')");
    expect(welcome).toContain("reset.title = 'Start over'");
    expect(welcome).toContain("'https://github.com/rolottr/pokevoxel'");
    expect(welcome).toContain("'https://x.com/rolottr'");
    expect(welcome).toContain("link.target = '_blank'");
    expect(welcome).toContain("link.rel = 'noopener noreferrer'");
    expect(welcome).not.toContain('A bright new window into a game you already own.');
    expect(welcome).not.toContain('Saved game files were restored on this device.');
    expect(welcome).not.toContain('Ordinary game saves were restored.');
    expect(welcome).toContain('ROM_PROFILES');
  });

  it('publishes Pokevoxel under MIT while retaining both upstream notices', () => {
    const license = text('LICENSE');
    expect(license).toContain('MIT License');
    expect(license).toContain('Copyright (c) 2026 rolottr');
    expect(license.match(/Permission is hereby granted, free of charge/g)).toHaveLength(1);
    expect(text('runtime', 'game', 'LICENSE.MD')).toContain('Copyright 2026 BOIS CLUB GAMES, LLC');
    expect(text('runtime', 'mods', 'dramatic-shape', 'LICENSE')).toContain('Copyright (c) 2026 DramaticShape');
  });

  it('documents only the three retained editions and the combined license', () => {
    const readme = text('README.md');
    for (const profile of ROM_PROFILES) {
      expect(readme).toContain(`Pokemon ${profile.label}`);
      expect(readme).toContain(profile.sha1);
    }
    expect(readme).not.toMatch(/Pokemon Green/i);
    expect(readme).toContain('[`MIT License`](LICENSE)');
  });
});
