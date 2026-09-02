import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { AppConfig } from '../core/config.js';
import type { SessionStore } from './auth.js';
import { verifyLogin } from './auth.js';
import type { TaskRunner } from '../core/task-runner.js';
import type { CloudUploader } from '../uploaders/cloud-uploader.js';
import type { ProgressEvent, VideoInfo } from '../core/types.js';
import { Broadcaster } from './ws.js';

// yt-dlp --audio-format allowlist. Exposed via GET /api/formats so the UI can
// render the dropdown from the server list.
export const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'aac', 'flac', 'wav', 'vorbis', 'alac', 'best'] as const;

// Reject names that could escape the target dir or hit hidden files.
function isValidName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    !name.startsWith('.')
  );
}

interface Deps {
  runner: TaskRunner;
  sessions: SessionStore;
  validateUrl: (url: string) => Promise<VideoInfo>;
  uploader: CloudUploader;
  broadcaster?: Broadcaster;
}

export function buildServer(cfg: AppConfig, deps: Deps): FastifyInstance {
  const app = Fastify();
  const bc = deps.broadcaster ?? new Broadcaster();
  app.register(cookie, { secret: cfg.server.sessionSecret });
  app.register(websocket);

  const authed = (req: any): boolean => {
    const raw = req.cookies?.sid;
    if (!raw) return false;
    const un = app.unsignCookie(raw);
    return un.valid && un.value != null && deps.sessions.has(un.value);
  };

  app.post('/api/login', async (req, reply) => {
    const { username, password } = (req.body as any) ?? {};
    if (!verifyLogin(cfg, username, password)) return reply.code(401).send({ error: 'invalid credentials' });
    const token = deps.sessions.create();
    reply.setCookie('sid', token, { httpOnly: true, sameSite: 'lax', path: '/', signed: true });
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    const raw = (req.cookies as any)?.sid;
    if (raw) { const un = app.unsignCookie(raw); if (un.valid && un.value) deps.sessions.delete(un.value); }
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path === '/api/login' || !path.startsWith('/api/')) return;
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.post('/api/validate', async (req, reply) => {
    const { url } = (req.body as any) ?? {};
    if (typeof url !== 'string' || url === '') return reply.code(400).send({ error: 'invalid url' });
    return deps.validateUrl(url);
  });

  app.get('/api/formats', async () => ({ formats: AUDIO_FORMATS, default: cfg.audio.format }));

  app.post('/api/tasks', async (req, reply) => {
    const { url, format } = (req.body as any) ?? {};
    if (typeof url !== 'string' || url === '') return reply.code(400).send({ error: 'invalid url' });
    let fmt: string | undefined;
    if (format !== undefined && format !== null && format !== '') {
      if (typeof format !== 'string' || !(AUDIO_FORMATS as readonly string[]).includes(format)) {
        return reply.code(400).send({ error: 'invalid format' });
      }
      fmt = format;
    }
    try {
      const { taskId } = deps.runner.start(url, (e: ProgressEvent) => bc.send(e), fmt);
      return { taskId };
    } catch (e) {
      if ((e as Error).message === 'busy') return reply.code(409).send({ error: 'busy' });
      throw e;
    }
  });

  app.get('/api/tasks/current', async () => deps.runner.getCurrent());

  app.get('/api/cloud/files', async () => {
    const targetDir = cfg.cloud.baidu.targetDir;
    try {
      const files = await deps.uploader.list();
      return { targetDir, files };
    } catch (e) {
      return { targetDir, files: [], error: (e as Error).message };
    }
  });

  app.post('/api/cloud/delete', async (req, reply) => {
    const { name } = (req.body as any) ?? {};
    if (!isValidName(name)) return reply.code(400).send({ error: 'invalid name' });
    await deps.uploader.remove(name);
    return { ok: true };
  });

  app.get('/api/cloud/download', async (req, reply) => {
    const name = (req.query as any)?.name;
    if (!isValidName(name)) return reply.code(400).send({ error: 'invalid name' });
    const path = await deps.uploader.fetch(name, cfg.paths.tempDir);
    const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    const encoded = encodeURIComponent(name);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    );
    const stream = createReadStream(path);
    const cleanup = () => { void unlink(path).catch(() => {}); };
    stream.on('close', cleanup);
    stream.on('error', cleanup);
    return reply.send(stream);
  });

  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, req) => {
      if (!authed(req)) { socket.close(1008, 'unauthorized'); return; }
      bc.add(socket);
    });
  });

  return app;
}
