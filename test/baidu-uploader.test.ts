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

function fakeProc(opts: { stdout?: string; code: number }) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    proc.emit('close', opts.code);
  });
  return proc;
}

describe('BaiduUploader.upload', () => {
  it('reports progress and resolves on success', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: '↑ 33.0% 1MB/3MB\n上传完成', code: 0 }));
    const up = new BaiduUploader(cfg, spawnFn as any);
    const seen: number[] = [];
    await up.upload('/tmp/Song.mp3', (p) => seen.push(p));
    expect(seen).toContain(33);
    const args = (spawnFn.mock.calls[0] as any[])[1];
    expect(args).toEqual(['upload', '/tmp/Song.mp3', '/audio']);
  });

  it('rejects on non-zero exit', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: 'error', code: 1 }));
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
