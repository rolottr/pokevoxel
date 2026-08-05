import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { ROM_PROFILES } from '../../src/import/romValidation';

it('matches every canonical SHA-1 from the retained GameVersion source', () => {
  const gameVersion = readFileSync(resolve(process.cwd(), 'runtime/game/src/core/GameVersion.lua'), 'utf8');
  for (const profile of ROM_PROFILES) {
    const section = gameVersion.match(new RegExp(`${profile.id}\\s*=\\s*\\{[\\s\\S]*?sha1\\s*=\\s*"([0-9a-f]{40})"`, 'i'));
    expect(section?.[1]).toBe(profile.sha1);
  }
});
