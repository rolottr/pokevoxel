import { execFile } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const runtimeSourceRoots = ['runtime/game', 'runtime/mods/dramatic-shape'].map((path) => resolve(path));
const isRuntimeSource = (file: string): boolean => runtimeSourceRoots.some((root) => {
  const local = relative(root, file);
  return local === '' || (!local.startsWith('..') && !isAbsolute(local));
});

function buildRuntime(): Promise<void> {
  return new Promise((done, fail) => {
    execFile(process.execPath, [resolve('scripts/build-runtime.mjs')], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) { fail(new Error(stderr.trim() || stdout.trim() || error.message)); return; }
      done();
    });
  });
}

function runtimeReloadPlugin(): Plugin {
  return {
    name: 'pokevoxel-runtime-reload',
    configureServer(server) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let active = false;
      let queued = false;
      const rebuild = async (): Promise<void> => {
        if (active) { queued = true; return; }
        active = true;
        try {
          await buildRuntime();
          server.ws.send({ type: 'full-reload' });
        } catch (error) {
          server.config.logger.error(`[pokevoxel-runtime] ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          active = false;
          if (queued) { queued = false; void rebuild(); }
        }
      };
      const schedule = (file: string): void => {
        if (!isRuntimeSource(file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = undefined; void rebuild(); }, 75);
      };
      server.watcher.add(runtimeSourceRoots);
      server.watcher.on('change', schedule);
      server.watcher.on('add', schedule);
      server.watcher.on('unlink', schedule);
      return () => {
        if (timer) clearTimeout(timer);
        server.watcher.off('change', schedule);
        server.watcher.off('add', schedule);
        server.watcher.off('unlink', schedule);
      };
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [runtimeReloadPlugin()],
  server: {
    headers: isolationHeaders,
    watch: { ignored: ['**/.pokevoxel-test-data/**'] },
  },
  preview: { headers: isolationHeaders },
});
