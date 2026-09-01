import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { YtDlpSource, selectSource } from '../src/sources/ytdlp-source';
import { loadConfig } from '../src/core/config';

const cfg = loadConfig(`
server: { port: 1, sessionSecret: s }
auth: { username: a, password: p }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: b, bduss: x, targetDir: /a } }
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

describe('YtDlpSource.validate', () => {
  it('returns supported with title on exit 0', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: '{"title":"Song","uploader":"U","duration":100}', code: 0 }));
    const src = new YtDlpSource(cfg, spawnFn as any);
    const info = await src.validate('http://site/v');
    expect(info.supported).toBe(true);
    expect(info.title).toBe('Song');
    expect(info.duration).toBe(100);
  });

  it('returns unsupported with reason on error', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stderr: 'ERROR: Unsupported URL: http://x', code: 1 }));
    const src = new YtDlpSource(cfg, spawnFn as any);
    const info = await src.validate('http://x');
    expect(info.supported).toBe(false);
    expect(info.reason).toContain('Unsupported');
  });
});

describe('YtDlpSource.download', () => {
  it('reports progress and resolves file path', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: '[download]  50.0% of 1MiB\n[download] Destination: /tmp/Song.mp3', code: 0 }));
    const src = new YtDlpSource(cfg, spawnFn as any);
    const seen: number[] = [];
    const res = await src.download('http://site/v', (p) => seen.push(p));
    expect(seen).toContain(50);
    expect(res.filePath).toContain('.mp3');
  });
});

describe('selectSource', () => {
  it('returns a YtDlpSource', () => {
    expect(selectSource('http://any', cfg)).toBeInstanceOf(YtDlpSource);
  });
});
