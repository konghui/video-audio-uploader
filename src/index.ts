import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, checkBinaries } from './core/config.js';
import { SessionStore } from './server/auth.js';
import { TaskRunner } from './core/task-runner.js';
import { selectSource } from './sources/ytdlp-source.js';
import { selectUploader } from './uploaders/baidu-uploader.js';
import { buildServer } from './server/server.js';
import fastifyStatic from '@fastify/static';

function binExists(bin: string): boolean {
  if (bin.includes('/')) return existsSync(bin);
  try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

const cfgPath = process.env.CONFIG_PATH ?? 'config.yaml';
const cfg = loadConfig(readFileSync(cfgPath, 'utf8'));
if (cfg.auth.password === 'change-me' || cfg.server.sessionSecret === 'change-me') {
  console.warn('WARNING: default credentials/sessionSecret in config.yaml — change them before exposing the service.');
}
const missing = checkBinaries(cfg, binExists);
if (missing.length) { console.error(`Missing required binaries: ${missing.join(', ')}`); process.exit(1); }
mkdirSync(cfg.paths.tempDir, { recursive: true });

const sessions = new SessionStore();
const source = selectSource('', cfg);
const uploader = selectUploader(cfg);
const runner = new TaskRunner(source, uploader);
const app = buildServer(cfg, { runner, sessions, validateUrl: (url) => source.validate(url) });

const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
if (existsSync(webDist)) app.register(fastifyStatic, { root: webDist });

app.listen({ port: cfg.server.port, host: '0.0.0.0' })
  .then(() => console.log(`Server on :${cfg.server.port}`))
  .catch((e) => { console.error(e); process.exit(1); });
