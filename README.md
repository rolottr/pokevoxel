# Pokevoxel

Pokevoxel is an **unofficial fork/integration for the browser** that brings a user-owned Pokemon Red, Blue, or Yellow cartridge into the voxel presentation of Dramatic Shape. The game, ROM validation, import, saves, and rendering run locally in the browser.

> Bring your own original 1 MiB US Pokemon Red, Blue, or Yellow Game Boy ROM. No ROM or extracted proprietary game data is included.

Supported canonical US ROM SHA-1 fingerprints:

| Edition | SHA-1 |
| --- | --- |
| Pokemon Red | `ea9bcae617fdf159b045185467ae58b2e4a48b9a` |
| Pokemon Blue | `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2` |
| Pokemon Yellow | `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1` |

## Upstream forks and licenses

Pokevoxel is a browser integration of these two upstream projects:

- **[Gen1Recomp](https://github.com/bryanthaboi/gen1recomp)** — the retained Gen I reimplementation that owns Red, Blue, and Yellow game logic, UI, input, saves, and base rendering.
- **[Dramatic Shape Voxel Mod](https://github.com/DramaticShape/DramaticShapeVoxelMod)** — the retained voxel world, cameras, lighting, water, and staged battle presentation.

Thank you to both projects and their contributors for making this possible. Pokevoxel keeps a pinned, allowlisted snapshot with browser-specific patches; it is not endorsed by or affiliated with either upstream project.

Pokevoxel is released under the root **[`MIT License`](LICENSE)**. The required upstream MIT notices remain beside the imported sources at [`runtime/game/LICENSE.MD`](runtime/game/LICENSE.MD) and [`runtime/mods/dramatic-shape/LICENSE`](runtime/mods/dramatic-shape/LICENSE).

Pokemon, Pokemon Red, Pokemon Blue, and Pokemon Yellow are trademarks of their respective owners. This project does not distribute Nintendo, Game Freak, or Creatures game data.

## What works

- The retained original Red, Blue, and Yellow flows from title screen through ordinary gameplay.
- Local ROM validation and conversion into a ROM-free browser runtime cache.
- Ordinary saves and options persisted in browser storage, including reload and browser-restart restoration.
- Dramatic Shape voxel overworld, day/night presentation, water, camera modes, and staged 3D battles.
- Keyboard, mouse, controller, and touch input.

## Controls

The same guide is available during play from the floating **All controls** ribbon.

### Keyboard

| Action | Default controls |
| --- | --- |
| Move / menu | `WASD` or arrow keys |
| A / confirm | `Z`, `Enter`, or `Space` |
| B / cancel | `X` or `Backspace` |
| Start | `Escape` or numpad `Enter` |
| Select | `Tab`, left `Shift`, or right `Shift` |
| Save / reload save | `F1` / `F2` after the overworld is live |
| Logic speed | `1` cycles speed; audio speed does not change |
| Colors | `2` cycles color modes |
| Survey zoom | `-` out, `=` in, `4` cycles the ladder |
| Built-in mod options | `F10` |

### Voxel and camera controls

| Action | Control |
| --- | --- |
| Voxel camera | `3` or Game Boy Select cycles `OFF → 15° → 35° → 50° → 75° → 1ST → 3RD` |
| FULL diorama preset | Select **FULL** in the mod options; the camera hotkey intentionally skips this multi-setting preset |
| Active 3D camera zoom | `Q` out, `E` in, or mouse wheel; 1ST intentionally has no zoom |
| Free look / battle orbit | Move the mouse, use the right stick, or drag one finger |
| Voxel grid | `5` |
| Tilt-shift pipeline | `6` |
| World curve | `7` |
| Staged 3D battles | `8` |
| Water rendering | `9` |

In 1ST and 3RD, movement follows the camera. The mouse is captured for free look; left-click acts as A and right-click as B. In 3RD and staged battles, left-stick click zooms out and right-stick click zooms in. A two-finger pinch zooms the active survey, 3RD, or staged-battle camera.

Controllers use the D-pad or left stick, face A/B, Start, and Back/Select. Shoulders and triggers decrease/increase logic speed. The retained display chords are Select+A for colors, Select+B for the voxel camera, Select+Y for the voxel grid, Select+X for tilt-shift, and Select+L for world curve. Default Game Boy mappings can be changed from **Options → Controls**.

## Privacy and storage

- ROM validation and import happen locally in memory; your ROM is never uploaded.
- Raw ROM bytes are not durably stored. The generated ROM-free runtime cache stays on this device.
- Saves and options use ordinary browser storage. `F1` confirms a save; `F2` reloads it.
- Clearing the rebuildable game cache never intentionally clears ordinary saves or options.

## Local development

Requirements: Node.js 22+ and npm. Runtime packaging is implemented in Node and does not require a system `zip` command.

```sh
npm ci
npm run dev
```

The development and preview servers emit the cross-origin isolation headers required by love.js. Chrome launched by the project browser harness is always muted.

Common release commands are:

```sh
npm run test:unit
npm run build
npm run preview
```

`npm run build` generates the ROM-free runtime, type-checks the app, builds the root-based Vite site, and audits the final artifact. Output is written to `dist/`.

## Deploy to Cloudflare

This repository is prepared as a static root-path Worker Assets site. Connect the Git repository in Cloudflare Builds, then use:

| Cloudflare setting | Value |
| --- | --- |
| Root directory | `/` when this repository is connected directly |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Environment variables | None required |

[`wrangler.jsonc`](wrangler.jsonc) publishes `dist/` as static assets and supplies the SPA fallback. [`public/_headers`](public/_headers) supplies cross-origin isolation and prevents stale HTML/runtime reuse while allowing immutable caching for hashed Vite assets. The build is self-contained and does not rely on Cloudflare's image containing `zip`.

After Cloudflare reports a successful build, open the deployment URL and confirm the welcome screen loads, ROM selection remains local, the title starts after the explicit **Start game** click, and **All controls** opens during play.

## Upstream and verification

`npm run verify:upstream` verifies the pinned allowlisted source snapshot without touching private game data.
