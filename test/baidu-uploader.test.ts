import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BaiduUploader, selectUploader } from '../src/uploaders/baidu-uploader';
import { loadConfig } from '../src/core/config';

const cfg = loadConfig(`
server: { port: 1, sessionSecret: s }
auth: { username: a, password: p }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: BaiduPCS-Go, bduss: x, stoken: st0k, targetDir: /audio } }
`);

const cfgNoStoken = loadConfig(`
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

// Per-call fake-proc queue: each spawn() returns the next queued proc.
function queue(procs: any[]) {
  let i = 0;
  return vi.fn(() => procs[i++]);
}

describe('BaiduUploader.upload', () => {
  it('reports progress and resolves on real success (login, mkdir, upload)', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }), // login
      fakeProc({ code: 0 }), // mkdir
      fakeProc({
        stdout:
          '↑ 33.0% 1MB/3MB\n[1] 上传文件成功, 保存到网盘路径: /我的音频/probe.mp3\n上传结束, 时间: 4.896s, 总大小: 46B',
        code: 0,
      }), // upload
    ]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    const seen: number[] = [];
    await up.upload('/tmp/Song.mp3', (p) => seen.push(p));
    expect(seen).toContain(33);
    // login args start with login/-bduss and include -stoken
    const loginArgs = spawnFn.mock.calls[0]?.[1] as string[];
    expect(loginArgs[0]).toBe('login');
    expect(loginArgs[1]).toBe('-bduss=x');
    expect(loginArgs).toContain('-stoken=st0k');
    // mkdir then upload
    expect(spawnFn.mock.calls[1]?.[1]).toEqual(['mkdir', '/audio']);
    expect(spawnFn.mock.calls[2]?.[1]).toEqual(['upload', '/tmp/Song.mp3', '/audio']);
  });

  it('omits -stoken flag when stoken is absent', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }),
      fakeProc({ code: 0 }),
      fakeProc({ stdout: '上传文件成功', code: 0 }),
    ]);
    const up = new BaiduUploader(cfgNoStoken, spawnFn as any);
    await up.upload('/tmp/x.mp3', () => {});
    const loginArgs = spawnFn.mock.calls[0]?.[1] as string[];
    expect(loginArgs).toEqual(['login', '-bduss=x']);
    expect(loginArgs.some((a) => a.startsWith('-stoken='))).toBe(false);
  });

  it('rejects (does NOT resolve) on false success: exit 0 but not-logged-in output', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }), // login
      fakeProc({ code: 0 }), // mkdir
      fakeProc({
        stdout:
          '[1] 获取文件列表错误, 代码: -6, 消息: 请重新登录\n以下文件上传失败:\n上传失败文件数: 1',
        code: 0,
      }),
    ]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/请重新登录/);
  });

  it('rejects on dir-missing failure: exit 0 with 代码 -9', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }),
      fakeProc({ code: 0 }),
      fakeProc({
        stdout: '代码: -9, 消息: 文件不存在\n以下文件上传失败:\n上传失败文件数: 1',
        code: 0,
      }),
    ]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/文件不存在/);
  });

  it('rejects on ambiguous output: exit 0 with no success/failure markers', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }),
      fakeProc({ code: 0 }),
      fakeProc({ stdout: '↑ 10.0% 1MB/3MB\nsome unrelated noise', code: 0 }),
    ]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/上传结果未知/);
  });

  it('resolves when target file already exists and upload is skipped (exit 0)', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }), // login
      fakeProc({ code: 0 }), // mkdir
      fakeProc({
        stdout:
          '[1] 目标文件, /我的音频/Me at the zoo.mp3, 已存在, 跳过...\n上传结束, 时间: 1.819s, 总大小: 0B',
        code: 0,
      }),
    ]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/Me at the zoo.mp3', () => {})).resolves.toBeUndefined();
  });

  it('rejects when login fails and does not attempt mkdir/upload', async () => {
    const spawnFn = queue([fakeProc({ stderr: 'bad bduss', code: 1 })]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/bad bduss/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('rejects on spawn error during login and does not attempt mkdir/upload', async () => {
    const spawnFn = queue([errorProc(new Error('spawn BaiduPCS-Go EACCES'))]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/EACCES/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('rejects on spawn error during upload after successful login and mkdir', async () => {
    const spawnFn = queue([
      fakeProc({ code: 0 }), // login
      fakeProc({ code: 0 }), // mkdir
      errorProc(new Error('spawn BaiduPCS-Go EAGAIN')), // upload spawn error
    ]);
    const up = new BaiduUploader(cfg, spawnFn as any);
    await expect(up.upload('/tmp/x.mp3', () => {})).rejects.toThrow(/EAGAIN/);
    expect(spawnFn).toHaveBeenCalledTimes(3);
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
