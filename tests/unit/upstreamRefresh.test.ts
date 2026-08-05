import { describe, expect, it } from 'vitest';
import {
  UPSTREAM_REFRESH_ADDITIONS,
  UPSTREAM_REFRESH_TARGETS,
  applyApprovedProductTransform,
  buildRefreshExclusions,
  cleanRelative,
  effectiveImportStatus,
  hasMergeMarkers,
  refreshImportSpecs,
  resolveApprovedMergeConflict,
} from '../../scripts/lib/upstream-refresh.mjs';

describe('compatible stable upstream refresh', () => {
  it('pins the approved stable tags and admits exactly the dependency closure', () => {
    expect(UPSTREAM_REFRESH_TARGETS['dramatic-shape']).toMatchObject({
      tag: 'v1.5.5', commit: 'c404c766cd4825628545161def7971dc2bf629ad',
    });
    expect(UPSTREAM_REFRESH_TARGETS.gen1recomp).toMatchObject({
      tag: 'v0.1.69', commit: '12a04f418838e09ade97ad3fb36933c9fffb31ec',
    });
    expect(UPSTREAM_REFRESH_ADDITIONS.map(({ source, upstreamPath }) => `${source}:${upstreamPath}`)).toEqual([
      'dramatic-shape:lib/CamControl.lua',
      'dramatic-shape:lib/ThirdPerson.lua',
      'gen1recomp:src/core/GamepadMap.lua',
      'gen1recomp:src/core/Orientation.lua',
      'gen1recomp:src/core/Platform.lua',
    ]);
  });

  it('rejects paths that could escape the candidate boundary', () => {
    expect(cleanRelative('src/core/Game.lua')).toBe('src/core/Game.lua');
    for (const unsafe of ['', '/tmp/file', '../file', 'src/../file', 'src\\file', 'src//file']) {
      expect(() => cleanRelative(unsafe)).toThrow();
    }
  });

  it('adds dependencies once and preserves patched classification', () => {
    const imports = refreshImportSpecs({ imports: [{
      source: 'dramatic-shape', sourceId: 'dramatic-shape', upstreamPath: 'LICENSE', path: 'LICENSE',
      productPath: 'runtime/mods/dramatic-shape/LICENSE', destination: 'runtime/mods/dramatic-shape/LICENSE', status: 'pristine',
    }] });
    expect(imports).toHaveLength(6);
    expect(imports.find((entry) => entry.upstreamPath === 'lib/ThirdPerson.lua')).toMatchObject({
      productPath: 'runtime/mods/dramatic-shape/lib/ThirdPerson.lua', status: 'patched',
    });
  });

  it('regenerates complete exclusions while retaining old reasons', () => {
    const importSpecs = [
      { source: 'dramatic-shape', upstreamPath: 'lib/CamControl.lua' },
      { source: 'gen1recomp', upstreamPath: 'src/core/Platform.lua' },
    ];
    const exclusions = buildRefreshExclusions({
      sourceTrees: {
        'dramatic-shape': ['lib/CamControl.lua', 'lib/Stadium.lua', 'README.md'],
        gen1recomp: ['src/core/Platform.lua', 'README.md'],
      },
      importSpecs,
      previousExclusions: [{ source: 'dramatic-shape', upstreamPath: 'README.md', reason: 'retained reason' }],
    });
    expect(exclusions.map(({ source, upstreamPath }) => `${source}:${upstreamPath}`)).toEqual([
      'dramatic-shape:lib/Stadium.lua', 'dramatic-shape:README.md', 'gen1recomp:README.md',
    ]);
    expect(exclusions.find((entry) => entry.upstreamPath === 'README.md' && entry.source === 'dramatic-shape')?.reason).toBe('retained reason');
    expect(exclusions.find((entry) => entry.upstreamPath === 'lib/Stadium.lua')?.reason).toContain('second-ROM');
  });

  it('removes the excluded VR dependency from the approved ThirdPerson import', () => {
    const source = Buffer.from(`before\n-- Required lazily and guarded: VR reaches this module through FirstPerson,\n-- and a headless run has no VR module worth loading at all.\nlocal function headset()\n  local ok, on = pcall(function() return V.require("VR").active() end)\n  return ok and on or false\nend\nafter\n`);
    const transformed = applyApprovedProductTransform('dramatic-shape', 'lib/ThirdPerson.lua', source).toString('utf8');
    expect(transformed).not.toContain('V.require("VR")');
    expect(transformed).not.toMatch(/\bVR\b/);
    expect(transformed).toContain('return false');
  });

  it('recognizes unresolved three-way merge markers', () => {
    expect(hasMergeMarkers('ok')).toBe(false);
    expect(hasMergeMarkers('<<<<<<< local\na\n=======\nb\n>>>>>>> upstream')).toBe(true);
  });

  it('promotes live product drift to patched even when the old lock is stale', () => {
    expect(effectiveImportStatus({ status: 'pristine' }, Buffer.from('product'), Buffer.from('upstream'))).toBe('patched');
    expect(effectiveImportStatus({ status: 'pristine' }, Buffer.from('same'), Buffer.from('same'))).toBe('pristine');
    expect(effectiveImportStatus({ status: 'patched' }, Buffer.from('same'), Buffer.from('same'))).toBe('patched');
  });

  it('resolves the approved manifest conflict to the compatible release', () => {
    const resolved = resolveApprovedMergeConflict({
      source: 'dramatic-shape', upstreamPath: 'manifest.json',
      localBytes: Buffer.from('{"version":"1.6.0","description":"local"}'),
      incomingBytes: Buffer.from('{"version":"1.5.5"}'),
      mergedBytes: Buffer.from('<<<<<<< local\n=======\n>>>>>>> incoming'),
    });
    expect(JSON.parse(resolved!.toString('utf8'))).toMatchObject({ version: '1.5.5' });
    expect(resolved!.toString('utf8')).toContain('third-person');
  });

  it('keeps the browser save wording with the stable automatic timing', () => {
    const incoming = `before\n          game.stack:push(TextBox.new(game,\n            Strings("%s saved\\nthe game!", game.save.player.name or "RED"),\n            nil, { auto = {\n              sound = function()\n                return require("src.core.Sound").play(game.data, "Save")\n              end,\n              delay = 30,\n            } }))\nafter`;
    const resolved = resolveApprovedMergeConflict({
      source: 'gen1recomp', upstreamPath: 'src/ui/StartMenu.lua',
      localBytes: Buffer.from('local'), incomingBytes: Buffer.from(incoming), mergedBytes: Buffer.from('conflict'),
    });
    expect(resolved!.toString('utf8')).toContain('Saving to browser\\nstorage...');
    expect(resolved!.toString('utf8')).toContain('delay = 30');
    expect(resolved!.toString('utf8')).not.toMatch(/^\+/m);
  });

  it('drops the trainer-party patch once the stable source contains it', () => {
    const incoming = Buffer.from('self.partyIndex = partyIndex or 1\n');
    const resolved = resolveApprovedMergeConflict({
      source: 'gen1recomp', upstreamPath: 'src/battle/BattleState.lua',
      localBytes: Buffer.from('self.partyIndex = partyIndex or 1\n'), incomingBytes: incoming,
      mergedBytes: Buffer.from('<<<<<<< local\n=======\n>>>>>>> incoming'),
    });
    expect(resolved).toEqual(incoming);
  });
});
