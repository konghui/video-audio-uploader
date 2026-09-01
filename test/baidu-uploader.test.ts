import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BaiduUploader, selectUploader } from '../src/uploaders/baidu-uploader';
import { loadConfig } from '../src/core/config';

const cfg = loadConfig(`
server: { port: 1, sessionSecret: s }
auth: { username: a, password: p }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: BaiduPCS-Go, bduss: x, targetDir: /audio } }
`);

function fakeProc(opts: { stdout?: string; stderr?: string; code: number }) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code);
  });
  return proc;
}

function errorProc(err: Error) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => proc.emit('error', err));
  return proc;
}

describe('BaiduUploader.upload', () => {
  it('reports progress and resolves on success', async () => {
    const procs = [
      fakeProc({ code: 0 }), // login succeeds
      fakeProc({ stdout: '↑ 33.0% 1MB/3MB\n上传完成', code: 0 }), // upload succeeds
    ];
    let callIdx = 0;
    const spawnFn = vi.fn(() => procs[callIdx++]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    const seen: number[] = [];
    await up.upload('/tmp/Song.mp3', (p) => seen.push(p));
    expect(seen).toContain(33);
    // First spawn call is login
    expect(spawnFn.mock.calls[0]?.[1]).toEqual(['login', '-bduss=x']);
    // Second spawn call is upload
    expect(spawnFn.mock.calls[1]?.[1]).toEqual(['upload', '/tmp/Song.mp3', '/audio']);
  });

  it('rejects when login fails and does not attempt upload', async () => {
    const loginProc = fakeProc({ stderr: 'bad bduss', code: 1 });
    const spawnFn = vi.fn(() => loginProc);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/bad bduss/);
    // Upload spawn should never be called (only login was called)
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('rejects on spawn error during login and does not attempt upload', async () => {
    const spawnFn = vi.fn(() => errorProc(new Error('spawn BaiduPCS-Go EACCES')));
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/EACCES/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('rejects on spawn error during upload after successful login', async () => {
    const procs = [
      fakeProc({ code: 0 }), // login succeeds
      errorProc(new Error('spawn BaiduPCS-Go EAGAIN')), // upload spawn error
    ];
    let callIdx = 0;
    const spawnFn = vi.fn(() => procs[callIdx++]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/EAGAIN/);
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });

  it('rejects when upload fails after successful login', async () => {
    const procs = [
      fakeProc({ code: 0 }), // login succeeds
      fakeProc({ stdout: 'error', code: 1 }), // upload fails
    ];
    let callIdx = 0;
    const spawnFn = vi.fn(() => procs[callIdx++]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow();
  });
});

describe('selectUploader', () => {
  it('returns BaiduUploader for baidu provider', () => {
    expect(selectUploader(cfg)).toBeInstanceOf(BaiduUploader);
  });

  it('throws on unknown provider', () => {
    const badCfg = loadConfig(`
server: { port: 1, sessionSecret: s }
auth: { username: a, password: p }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: dropbox, baidu: { binary: b, bduss: x, targetDir: /a } }
`);
    expect(() => selectUploader(badCfg)).toThrow('Unsupported cloud provider: dropbox');
  });
});
