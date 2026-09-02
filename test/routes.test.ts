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
  const uploader: any = { upload: vi.fn(async () => {}), list: vi.fn(async () => []), remove: vi.fn(async () => {}), fetch: vi.fn(async () => '/tmp/x') };
  const runner = new TaskRunner(source, uploader, { rm: async () => {}, idGen: () => 't1' });
  const validateUrl = vi.fn(async (url: string) => (url.includes('bad') ? { supported: false, reason: 'no' } : { supported: true, title: 'a' }));
  const app = buildServer(cfg, { runner, sessions, uploader, validateUrl });
  return { app, validateUrl, uploader, runner };
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

  it('rejects validate with invalid url type', async () => {
    const { app } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/validate', payload: { url: 123 }, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects tasks with missing url', async () => {
    const { app } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: {}, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(400);
  });

  it('accepts task with valid format wav', async () => {
    const { app, runner } = make();
    const spy = vi.spyOn(runner, 'start');
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v', format: 'wav' }, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith('http://v', expect.any(Function), 'wav');
  });

  it('rejects task with invalid format exe', async () => {
    const { app } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v', format: 'exe' }, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid format');
  });

  it('exposes audio formats list', async () => {
    const { app } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'GET', url: '/api/formats', cookies: { sid: c.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().formats).toContain('mp3');
    expect(res.json().default).toBe('mp3');
  });

  it('lists cloud files with targetDir', async () => {
    const { app, uploader } = make();
    uploader.list.mockResolvedValueOnce([{ name: 'a.mp3', size: '1KB', date: '2026-01-01 00:00:00', isDir: false }]);
    const c = await login(app);
    const res = await app.inject({ method: 'GET', url: '/api/cloud/files', cookies: { sid: c.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().targetDir).toBe('/a');
    expect(res.json().files).toHaveLength(1);
  });

  it('returns files:[] with error when uploader.list throws', async () => {
    const { app, uploader } = make();
    uploader.list.mockRejectedValueOnce(new Error('boom'));
    const c = await login(app);
    const res = await app.inject({ method: 'GET', url: '/api/cloud/files', cookies: { sid: c.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual([]);
    expect(res.json().error).toBe('boom');
  });

  it('rejects delete with path-traversal name', async () => {
    const { app, uploader } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/cloud/delete', payload: { name: '../evil' }, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid name');
    expect(uploader.remove).not.toHaveBeenCalled();
  });

  it('deletes a valid file name', async () => {
    const { app, uploader } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'POST', url: '/api/cloud/delete', payload: { name: 'song.mp3' }, cookies: { sid: c.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(uploader.remove).toHaveBeenCalledWith('song.mp3');
  });

  it('rejects download with path-traversal name', async () => {
    const { app, uploader } = make();
    const c = await login(app);
    const res = await app.inject({ method: 'GET', url: '/api/cloud/download?name=' + encodeURIComponent('../evil'), cookies: { sid: c.value } });
    expect(res.statusCode).toBe(400);
    expect(uploader.fetch).not.toHaveBeenCalled();
  });

  it('returns 409 when busy', async () => {
    const sessions = new SessionStore();
    const source: any = { validate: vi.fn(), download: vi.fn(async () => ({ filePath: '/tmp/a.mp3', title: 'a' })) };
    const uploader: any = { upload: vi.fn(() => new Promise(() => {})) }; // never resolves
    const runner = new TaskRunner(source, uploader, { rm: async () => {}, idGen: () => 't1' });
    const validateUrl = vi.fn(async (url: string) => ({ supported: true, title: 'a' }));
    const uploaderCloud: any = { upload: vi.fn(), list: vi.fn(async () => []), remove: vi.fn(), fetch: vi.fn() };
    const app = buildServer(cfg, { runner, sessions, uploader: uploaderCloud, validateUrl });
    const c = await login(app);
    const cookies = { sid: c.value };
    const first = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v' }, cookies });
    expect(first.statusCode).toBe(200);
    // Give first task a tick to enter running state
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = await app.inject({ method: 'POST', url: '/api/tasks', payload: { url: 'http://v2' }, cookies });
    expect(second.statusCode).toBe(409);
  });
});
