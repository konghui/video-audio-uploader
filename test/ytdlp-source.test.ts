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

function fakeProc(opts: { stdout?: string; stderr?: string; chunks?: string[]; code: number }) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.chunks) for (const c of opts.chunks) proc.stdout.emit('data', Buffer.from(c));
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

function fakeFsDeps() {
  return {
    mkdir: vi.fn(async () => {}),
    rmrf: vi.fn(async () => {}),
    idGen: () => 'fixed',
  };
}

describe('YtDlpSource.validate', () => {
  it('returns supported with title on exit 0', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: '{"title":"Song","uploader":"U","duration":100}', code: 0 }));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    const info = await src.validate('http://site/v');
    expect(info.supported).toBe(true);
    expect(info.title).toBe('Song');
    expect(info.duration).toBe(100);
  });

  it('returns unsupported with reason on error', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stderr: 'ERROR: Unsupported URL: http://x', code: 1 }));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    const info = await src.validate('http://x');
    expect(info.supported).toBe(false);
    expect(info.reason).toContain('Unsupported');
  });

  it('resolves { supported: false } on spawn error instead of rejecting', async () => {
    const spawnFn = vi.fn(() => errorProc(new Error('spawn yt-dlp EACCES')));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    const info = await src.validate('http://x');
    expect(info.supported).toBe(false);
    expect(info.reason).toContain('EACCES');
  });
});

describe('YtDlpSource.download', () => {
  it('reports progress and resolves file path', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: '[download]  50.0% of 1MiB\n[download] Destination: /tmp/Song.mp3', code: 0 }));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    const seen: number[] = [];
    const res = await src.download('http://site/v', (p) => seen.push(p));
    expect(seen).toContain(50);
    expect(res.filePath).toContain('.mp3');
  });

  it('parses a Destination line split across two data chunks', async () => {
    const spawnFn = vi.fn(() =>
      fakeProc({ chunks: ['[download] 50.0% of 1MiB\n[ExtractAudio] Destin', 'ation: /tmp/Song.mp3\n'], code: 0 }),
    );
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    const res = await src.download('http://site/v', () => {});
    expect(res.filePath).toBe('/tmp/Song.mp3');
    expect(res.title).toBe('Song');
  });

  it('rejects when exit 0 but no Destination line', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stdout: '[download]  100.0% of 1MiB\n[download] Finished', code: 0 }));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    await expect(src.download('http://site/v', () => {})).rejects.toThrow(/no output file path/i);
  });

  it('rejects on download failure', async () => {
    const spawnFn = vi.fn(() => fakeProc({ stderr: 'ERROR: Video unavailable', code: 1 }));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    await expect(src.download('http://x', () => {})).rejects.toThrow(/Video unavailable/);
  });

  it('rejects on spawn error during download', async () => {
    const spawnFn = vi.fn(() => errorProc(new Error('spawn yt-dlp EAGAIN')));
    const src = new YtDlpSource(cfg, spawnFn as any, fakeFsDeps());
    await expect(src.download('http://x', () => {})).rejects.toThrow(/EAGAIN/);
  });

  it('removes the per-call subdir on download failure', async () => {
    const deps = fakeFsDeps();
    const spawnFn = vi.fn(() => fakeProc({ stderr: 'ERROR: Video unavailable', code: 1 }));
    const src = new YtDlpSource(cfg, spawnFn as any, deps);
    await expect(src.download('http://x', () => {})).rejects.toThrow(/Video unavailable/);
    expect(deps.mkdir).toHaveBeenCalledWith('/tmp/dl-fixed');
    expect(deps.rmrf).toHaveBeenCalledWith('/tmp/dl-fixed');
  });

  it('removes the per-call subdir on spawn error', async () => {
    const deps = fakeFsDeps();
    const spawnFn = vi.fn(() => errorProc(new Error('spawn yt-dlp EACCES')));
    const src = new YtDlpSource(cfg, spawnFn as any, deps);
    await expect(src.download('http://x', () => {})).rejects.toThrow(/EACCES/);
    expect(deps.rmrf).toHaveBeenCalledWith('/tmp/dl-fixed');
  });

  it('does not remove the subdir on success', async () => {
    const deps = fakeFsDeps();
    const spawnFn = vi.fn(() => fakeProc({ stdout: '[download] Destination: /tmp/dl-fixed/Song.mp3\n', code: 0 }));
    const src = new YtDlpSource(cfg, spawnFn as any, deps);
    await src.download('http://site/v', () => {});
    expect(deps.rmrf).not.toHaveBeenCalled();
  });
});

describe('selectSource', () => {
  it('returns a YtDlpSource', () => {
    expect(selectSource('http://any', cfg)).toBeInstanceOf(YtDlpSource);
  });
});
