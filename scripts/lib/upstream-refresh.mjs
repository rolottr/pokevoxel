export const UPSTREAM_REFRESH_TARGETS = Object.freeze({
  'dramatic-shape': Object.freeze({
    tag: 'v1.5.5',
    commit: 'c404c766cd4825628545161def7971dc2bf629ad',
    repoPath: 'DramaticShapeVoxelMod',
    runtimeRoot: 'runtime/mods/dramatic-shape',
  }),
  gen1recomp: Object.freeze({
    tag: 'v0.1.69',
    commit: '12a04f418838e09ade97ad3fb36933c9fffb31ec',
    repoPath: 'gen1recomp',
    runtimeRoot: 'runtime/game',
  }),
});

export const UPSTREAM_REFRESH_ADDITIONS = Object.freeze([
  Object.freeze({ source: 'dramatic-shape', upstreamPath: 'lib/CamControl.lua', status: 'pristine' }),
  Object.freeze({ source: 'dramatic-shape', upstreamPath: 'lib/ThirdPerson.lua', status: 'patched' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/core/GamepadMap.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/core/Orientation.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/core/Platform.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/core/DiscordPresence.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/CodeEntry.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/Fingerprint.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/Handshake.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/LinkBattle.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/LinkState.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/Net.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/Protocol.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/link/Tournament.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/mods/ManagerState.lua', status: 'pristine' }),
  Object.freeze({ source: 'gen1recomp', upstreamPath: 'src/mods/ModProfile.lua', status: 'pristine' }),
]);

export function cleanRelative(value, label = 'path') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) throw new Error(`${label} must be a non-empty relative POSIX path`);
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`${label} contains an unsafe segment`);
  return value;
}

export const sourcePathKey = (source, path) => `${source}\0${path}`;

export function productPathFor(source, upstreamPath) {
  const target = UPSTREAM_REFRESH_TARGETS[source];
  if (!target) throw new Error(`unknown refresh source: ${String(source)}`);
  return `${target.runtimeRoot}/${cleanRelative(upstreamPath, `${source} upstream path`)}`;
}

export function refreshImportSpecs(lock) {
  if (!Array.isArray(lock?.imports) || !lock.imports.length) throw new Error('upstream lock requires imports');
  const records = lock.imports.map((entry) => ({ ...entry }));
  const seen = new Set(records.map((entry) => sourcePathKey(entry.source, entry.upstreamPath)));
  for (const addition of UPSTREAM_REFRESH_ADDITIONS) {
    const key = sourcePathKey(addition.source, addition.upstreamPath);
    if (seen.has(key)) continue;
    const productPath = productPathFor(addition.source, addition.upstreamPath);
    records.push({
      source: addition.source,
      sourceId: addition.source,
      upstreamPath: addition.upstreamPath,
      path: addition.upstreamPath,
      productPath,
      destination: productPath,
      status: addition.status,
    });
    seen.add(key);
  }
  records.sort((left, right) => left.source.localeCompare(right.source) || left.upstreamPath.localeCompare(right.upstreamPath));
  return records;
}

function defaultExclusionReason(source, path) {
  if (source === 'dramatic-shape') {
    if (/^(?:lib\/Stadium|model_extract\/|tests\/|tools\/)/.test(path)) return 'Stadium second-ROM, test, tool, or documentation surface excluded';
    return 'not in Dramatic Shape web runtime closure';
  }
  return 'non-runtime platform, test, documentation, mod, tool, or launcher asset';
}

export function buildRefreshExclusions({ sourceTrees, importSpecs, previousExclusions = [] }) {
  const imported = new Set(importSpecs.map((entry) => sourcePathKey(entry.source, entry.upstreamPath)));
  const priorReasons = new Map(previousExclusions.map((entry) => [sourcePathKey(entry.source, entry.upstreamPath), entry.reason]));
  const exclusions = [];
  for (const source of Object.keys(UPSTREAM_REFRESH_TARGETS).sort()) {
    const paths = sourceTrees[source];
    if (!Array.isArray(paths) || !paths.length) throw new Error(`missing tracked tree for ${source}`);
    for (const rawPath of paths) {
      const path = cleanRelative(rawPath, `${source} tracked path`);
      const key = sourcePathKey(source, path);
      if (imported.has(key)) continue;
      exclusions.push({
        source,
        sourceId: source,
        upstreamPath: path,
        path,
        reason: priorReasons.get(key) ?? defaultExclusionReason(source, path),
      });
    }
  }
  exclusions.sort((left, right) => left.source.localeCompare(right.source) || left.upstreamPath.localeCompare(right.upstreamPath));
  return exclusions;
}

export const hasMergeMarkers = (text) => /^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/m.test(String(text));

export function effectiveImportStatus(entry, localBytes, pinnedUpstreamBytes) {
  if (entry?.status === 'patched') return 'patched';
  return Buffer.compare(Buffer.from(localBytes), Buffer.from(pinnedUpstreamBytes)) === 0 ? 'pristine' : 'patched';
}

export function applyApprovedProductTransform(source, upstreamPath, bytes) {
  if (source !== 'dramatic-shape' || upstreamPath !== 'lib/ThirdPerson.lua') return Buffer.from(bytes);
  const text = Buffer.from(bytes).toString('utf8');
  const anchor = `-- Required lazily and guarded: VR reaches this module through FirstPerson,\n-- and a headless run has no VR module worth loading at all.\nlocal function headset()\n  local ok, on = pcall(function() return V.require("VR").active() end)\n  return ok and on or false\nend`;
  const replacement = `-- The browser product has no headset runtime; keep the upstream browser\n-- presentation while avoiding a dependency on the excluded VR module.\nlocal function headset()\n  return false\nend`;
  if (!text.includes(anchor)) throw new Error('ThirdPerson VR-coupling anchor is missing');
  const transformed = text.replace(anchor, replacement).replace(/\bVR\b/g, 'immersive');
  if (transformed.includes('V.require("VR")')) throw new Error('ThirdPerson VR coupling remains after transform');
  return Buffer.from(transformed);
}

function replaceExact(text, anchor, replacement, label) {
  if (!text.includes(anchor)) throw new Error(`${label} anchor is missing`);
  return text.replace(anchor, replacement);
}

export function resolveApprovedMergeConflict({ source, upstreamPath, localBytes, incomingBytes, mergedBytes }) {
  const key = `${source}:${upstreamPath}`;
  const local = Buffer.from(localBytes).toString('utf8');
  const incoming = Buffer.from(incomingBytes).toString('utf8');
  const merged = Buffer.from(mergedBytes).toString('utf8');
  let output;

  if (key === 'dramatic-shape:lib/BattleCam.lua') {
    output = incoming.replace(/\bVR\b/g, 'immersive');
  } else if (key === 'dramatic-shape:lib/FirstPerson.lua') {
    const region = /^<<<<<<<[^\n]*\n[\s\S]*?function FirstPerson\.driving\(\)\n  return FirstPerson\.engaged\(\) and FirstPerson\.onTop\(\)\nend\n\n(?=-- The right stick)/m;
    if (!region.test(merged)) throw new Error('FirstPerson driving conflict region is missing');
    output = merged.replace(region, `-- Whether the overworld is what the player is looking at: nothing pushed\n-- over it, so shared camera controls may own their inputs.\nfunction FirstPerson.onTop()\n  local ok, top, ow = pcall(function()\n    local Game = require("src.core.Game")\n    return Game.stack and Game.stack:top(), Game.overworld\n  end)\n  return ok and top ~= nil and top == ow\nend\n\n-- Free-roam movement is stricter than camera ownership: menus, transitions,\n-- an active grid move, or an input lock keep the base game in control.\nfunction FirstPerson.driving()\n  if not FirstPerson.engaged() or not FirstPerson.onTop() then return false end\n  local ok, ow, player = pcall(function()\n    local Game = require("src.core.Game")\n    local state = Game.overworld\n    return state, state and state.player\n  end)\n  return ok and ow ~= nil and player ~= nil\n    and not ow.transitioning and not player.moving and not player.inputLocked\nend\n\n`);
  } else if (key === 'dramatic-shape:main.lua') {
    output = replaceExact(local,
      `-- Pokevoxel's browser-safe Dramatic Shape baseline. It owns the voxel\n-- overworld, reflective water, staged battles, retained first-person camera,\n-- and miniature post-process.`,
      `-- Pokevoxel's browser-safe Dramatic Shape baseline. It owns the voxel\n-- overworld, reflective water, staged battles, retained first- and third-person\n-- cameras, shared camera controls, and miniature post-process.`,
      'main header');
    output = replaceExact(output,
      `local FirstPerson = V.require("FirstPerson")\nlocal FreeMove = V.require("FreeMove")\nlocal BrowserEvents`,
      `local FirstPerson = V.require("FirstPerson")\nlocal FreeMove = V.require("FreeMove")\nlocal CamControl = V.require("CamControl")\nlocal BrowserEvents`,
      'main camera dependency');
    output = replaceExact(output,
      `OverworldBattle.install()\nFirstPerson.install()\nFreeMove.install()\nmod.events:on("battle.started"`,
      `OverworldBattle.install()\nFirstPerson.install()\nFreeMove.install()\nCamControl.install()\n\n-- Preserve the stable mod's Q/E camera zoom without importing its desktop,\n-- VR, Horde, or global hotkey surfaces. Screens with their own key handler\n-- retain first refusal, matching the base engine's input ownership.\ndo\n  local Game = require("src.core.Game")\n  if not Game.dramaticShapeCameraKeys then\n    local inner = Game.keypressed\n    function Game:keypressed(key, ...)\n      local top = self.stack and self.stack:top()\n      if (key == "q" or key == "e") and not (top and top.onKeyPressed)\n          and CamControl.zoomBy(key == "q" and 1 or -1) then\n        return\n      end\n      return inner(self, key, ...)\n    end\n    Game.dramaticShapeCameraKeys = true\n  end\nend\n\nmod.events:on("battle.started"`,
      'main camera installation');
    output = replaceExact(output,
      `mod.exports.version = "1.6.0-pokevoxel-first-person"`,
      `mod.exports.version = "1.5.5-pokevoxel-compatible-stable"`,
      'main version');
    output = replaceExact(output,
      `if renderFailure and tostring(renderFailure):match("^POKEVOXEL_") then\n      clearWaterReady()`,
      `if renderFailure and tostring(renderFailure):match("^POKEVOXEL_") then\n      clearReady()\n      clearWaterReady()`,
      'main fixed render-failure readiness');
  } else if (key === 'dramatic-shape:manifest.json') {
    const manifest = JSON.parse(local);
    manifest.version = '1.5.5';
    manifest.description = "Pokevoxel's built-in 3D presentation: extruded terrain, reflective water, depth-buffered character and structure occlusion, day/night lighting, staged battles, retained first- and third-person cameras with shared controls, palette-aware atlases, and a UI-safe tilt-shift world pass. Collision, movement transitions, warps, encounters, battle rules, scripts, and saves remain owned by the base game.";
    output = `${JSON.stringify(manifest, null, 2)}\n`;
  } else if (key === 'gen1recomp:conf.lua') {
    output = local;
  } else if (key === 'gen1recomp:src/battle/BattleState.lua') {
    // v0.1.69 contains the exact trainer-party identity field previously
    // added by Pokevoxel, plus its upstream rationale. Prefer it verbatim.
    output = incoming;
  } else if (key === 'gen1recomp:src/ui/StartMenu.lua') {
    const anchor = `          game.stack:push(TextBox.new(game,\n            Strings("%s saved\\nthe game!", game.save.player.name or "RED"),\n            nil, { auto = {\n              sound = function()\n                return require("src.core.Sound").play(game.data, "Save")\n              end,\n              delay = 30,\n            } }))`;
    const replacement = `          local web = love.system and love.system.getOS\n            and love.system.getOS() == "Web"\n          local message = web and Strings("Saving to browser\\nstorage...")\n            or Strings("%s saved\\nthe game!", game.save.player.name or "RED")\n          game.stack:push(TextBox.new(game, message, nil, { auto = {\n            sound = function()\n              return require("src.core.Sound").play(game.data, "Save")\n            end,\n            delay = 30,\n          } }))`;
    output = replaceExact(incoming, anchor, replacement, 'StartMenu browser save message');
  } else {
    return null;
  }

  if (hasMergeMarkers(output)) throw new Error(`approved resolver left merge markers in ${key}`);
  if (key === 'dramatic-shape:main.lua' && /V\.require\("(?:VR|Horde)/.test(output)) throw new Error('main resolver admitted an excluded integration');
  return Buffer.from(output);
}
