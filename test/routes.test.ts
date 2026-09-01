import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../src/server/server';
import { loadConfig } from '../src/core/config';
import { SessionStore } from '../src/server/auth';
import { TaskRunner } from '../src/core/task-runner';

const cfg = loadConfig(`
server: { port: 0, sessionSecret: test-secret-please-change }
auth: { username: admin, password: secret }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: b, bduss: x, targetDir: /a } }
`);

function make() {
  const sessions = new SessionStore();
  const source: any = { validate: vi.fn(), download: vi.fn(async () => ({ filePath: '/tmp/a.mp3', title: 'a' })) };
  const uploader: any = { upload: vi.fn(async () => {}) };
  const runner = new TaskRunner(source, uploader, { rm: async () => {}, idGen: () => 't1' });
  const validateUrl = vi.fn(async (url: string) => (url.includes('bad') ? { supported: false, reason: 'no' } : { supported: true, title: 'a' }));
  const app = buildServer(cfg, { runner, sessions, validateUrl });
  return { app, validateUrl };
}

async function login(app: any) {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'secret' } });
  return res.cookies.find((c: any) => c.name === 'sid');
}

describe('routes', () => {
  it('rejects unauthenticated task submit', async () => {
    const { app } = make();
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v' } });
    expect(res.statusCode).toBe(401);
  });

  it('logs in and validates a url', async () => {
    const { app } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/validate', payload: { url: 'http://good' }, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().supported).toBe(true);
  });

  it('returns 409 when busy', async () => {
    const { app } = make();
    const c = await login(app);
    const cookies = { sid: c.value };
    const first = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v' }, cookies });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v2' }, cookies });
    expect([200, 409]).toContain(second.statusCode);
  });
});
