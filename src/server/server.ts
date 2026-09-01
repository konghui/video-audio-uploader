import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { AppConfig } from '../core/config';
import type { SessionStore } from './auth';
import { verifyLogin } from './auth';
import type { TaskRunner } from '../core/task-runner';
import type { ProgressEvent, VideoInfo } from '../core/types';
import { Broadcaster } from './ws';

interface Deps {
  runner: TaskRunner;
  sessions: SessionStore;
  validateUrl: (url: string) => Promise<VideoInfo>;
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
    if (req.url === '/api/login' || !req.url.startsWith('/api/')) return;
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.post('/api/validate', async (req) => {
    const { url } = (req.body as any) ?? {};
    return deps.validateUrl(url);
  });

  app.post('/api/tasks', async (req, reply) => {
    const { url } = (req.body as any) ?? {};
    try {
      const { taskId } = deps.runner.start(url, (e: ProgressEvent) => bc.send(e));
      return { taskId };
    } catch (e) {
      if ((e as Error).message === 'busy') return reply.code(409).send({ error: 'busy' });
      throw e;
    }
  });

  app.get('/api/tasks/current', async () => deps.runner.getCurrent());

  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, req) => {
      if (!authed(req)) { socket.close(); return; }
      bc.add(socket);
    });
  });

  return app;
}
