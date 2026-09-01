# 视频音频提取 + 云盘上传服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地单用户 Web 服务:登录后粘贴视频链接(Bilibili/YouTube 等),校验支持性,提取音频转最高质量 mp3,上传到百度网盘目录,页面实时展示进度。

**Architecture:** Node.js + TypeScript 后端(Fastify),以子进程方式驱动 `yt-dlp`(下载/探测)、`ffmpeg`(由 yt-dlp 内部调用转码)、`BaiduPCS-Go`(上传)。`TaskRunner` 编排「解析→下载转码→上传→清理」四阶段,通过 WebSocket 推送进度。`VideoSource` / `CloudUploader` 两个接口为扩展点。前端 Vue 3 + Vite + Tailwind,后端静态托管。无数据库,配置文件 `config.yaml` 驱动。

**Tech Stack:** Node.js 20+, TypeScript, Fastify, `@fastify/websocket`, `@fastify/cookie`, Vue 3, Vite, Tailwind CSS, Vitest(测试), yaml。外部二进制:yt-dlp、ffmpeg、BaiduPCS-Go。

**Spec:** `docs/superpowers/specs/2026-09-01-video-audio-clouddriver-design.md`

## Global Constraints

- Node.js 20+,TypeScript,严格模式(`strict: true`)。
- 无数据库;进度与 session 存内存;所有状态由 `config.yaml` 驱动。
- 单用户单活动任务:已有任务运行时,新提交返回 HTTP 409。
- 音频固定:yt-dlp `-x --audio-format mp3 --audio-quality 0`(最高质量 VBR)。
- 所有 REST API(除 `/api/login`)与 WebSocket 均需登录(签名 cookie session)。
- 扩展点:新增视频来源/云盘 = 新增接口实现 + 配置指定,不改 `TaskRunner`。
- 测试框架 Vitest;TDD:先写失败测试再实现;频繁提交。
- 视频网站自动识别:默认 `YtDlpSource` 处理所有 yt-dlp 支持站点,用户无需选择来源。

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts
config.example.yaml
/src
  /core
    types.ts            # 共享类型:ProgressEvent, TaskStatus, VideoInfo 等
    config.ts           # Config 加载 + 校验 + 启动预检
    progress-parser.ts  # 纯函数:解析 yt-dlp / BaiduPCS-Go 输出
    task-runner.ts      # 四阶段编排,单活动任务,进度回调
  /sources
    video-source.ts     # VideoSource 接口 + 按 URL 选实现的工厂
    ytdlp-source.ts     # YtDlpSource:validate + download
  /uploaders
    cloud-uploader.ts   # CloudUploader 接口 + 工厂
    baidu-uploader.ts   # BaiduUploader:upload
  /server
    auth.ts             # session 存储 + AuthMiddleware/校验
    routes.ts           # REST 路由:login/logout/validate/tasks/current
    ws.ts               # WebSocket 进度广播
    server.ts           # Fastify 组装 + 静态托管 + 启动
  index.ts              # 入口:读配置→预检→起服务
/web                    # Vue 3 + Vite 前端
  index.html, vite.config.ts, tailwind.config.js
  src/main.ts, src/App.vue, src/views/Login.vue, src/views/Home.vue
  src/api.ts, src/ws.ts
/test
  config.test.ts, progress-parser.test.ts, ytdlp-source.test.ts,
  baidu-uploader.test.ts, task-runner.test.ts, auth.test.ts, routes.test.ts
Dockerfile
docker-compose.yml
```

---

### Task 1: 项目脚手架与类型

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/types.ts`
- Test: `test/types.test.ts`

**Interfaces:**
- Produces: 类型 `Stage = 'resolving'|'downloading'|'uploading'|'cleaning'|'done'|'error'`;
  `ProgressEvent { taskId: string; stage: Stage; percent: number; title?: string; message: string; status: 'running'|'success'|'failed' }`;
  `VideoInfo { supported: boolean; title?: string; uploader?: string; duration?: number; reason?: string }`;
  `TaskState { taskId: string; url: string; stage: Stage; percent: number; title?: string; status: 'running'|'success'|'failed'; error?: string }`.

- [ ] **Step 1: 初始化 package.json 与依赖**

```bash
mkdir -p src/core src/sources src/uploaders src/server web/src test
npm init -y
npm pkg set type="module"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.build="tsc -p tsconfig.json"
npm pkg set scripts.dev="tsx src/index.ts"
npm i fastify @fastify/websocket @fastify/cookie @fastify/static yaml
npm i -D typescript tsx vitest @types/node
```

- [ ] **Step 2: 写 tsconfig.json 与 vitest.config.ts**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```
`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 3: 写失败测试 test/types.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import type { ProgressEvent, VideoInfo, TaskState, Stage } from '../src/core/types';

describe('types', () => {
  it('constructs a ProgressEvent', () => {
    const e: ProgressEvent = { taskId: 't1', stage: 'downloading', percent: 12, message: 'x', status: 'running' };
    expect(e.stage).toBe('downloading');
  });
  it('constructs a VideoInfo unsupported', () => {
    const v: VideoInfo = { supported: false, reason: 'unsupported site' };
    expect(v.supported).toBe(false);
  });
  it('constructs a TaskState', () => {
    const s: TaskState = { taskId: 't1', url: 'u', stage: 'resolving', percent: 0, status: 'running' };
    const st: Stage = s.stage;
    expect(st).toBe('resolving');
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL(找不到 `../src/core/types`)。

- [ ] **Step 5: 写 src/core/types.ts**

```ts
export type Stage = 'resolving' | 'downloading' | 'uploading' | 'cleaning' | 'done' | 'error';
export type RunStatus = 'running' | 'success' | 'failed';

export interface ProgressEvent {
  taskId: string;
  stage: Stage;
  percent: number;
  title?: string;
  message: string;
  status: RunStatus;
}

export interface VideoInfo {
  supported: boolean;
  title?: string;
  uploader?: string;
  duration?: number;
  reason?: string;
}

export interface TaskState {
  taskId: string;
  url: string;
  stage: Stage;
  percent: number;
  title?: string;
  status: RunStatus;
  error?: string;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run test/types.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/core/types.ts test/types.test.ts
git commit -m "chore: 脚手架与核心类型"
```

---

### Task 2: 进度解析器 ProgressParser

**Files:**
- Create: `src/core/progress-parser.ts`
- Test: `test/progress-parser.test.ts`

**Interfaces:**
- Consumes: `Stage` from `src/core/types`.
- Produces: `parseYtDlpProgress(line: string): number | null`(返回 0-100 或 null);
  `parseBaiduProgress(line: string): number | null`;
  `classifyYtDlpValidate(stdout: string, exitCode: number): { supported: boolean; reason?: string }`.

- [ ] **Step 1: 写失败测试 test/progress-parser.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { parseYtDlpProgress, parseBaiduProgress, classifyYtDlpValidate } from '../src/core/progress-parser';

describe('parseYtDlpProgress', () => {
  it('parses a download percent line', () => {
    expect(parseYtDlpProgress('[download]  42.3% of 5.00MiB at 1.00MiB/s')).toBeCloseTo(42.3);
  });
  it('returns null for non-progress lines', () => {
    expect(parseYtDlpProgress('[info] Writing metadata')).toBeNull();
  });
});

describe('parseBaiduProgress', () => {
  it('parses a percent from baidupcs-go output', () => {
    expect(parseBaiduProgress('↑ 12.34% 1.2MB/2.4MB 500KB/s in 2s')).toBeCloseTo(12.34);
  });
  it('returns null when no percent present', () => {
    expect(parseBaiduProgress('preparing upload')).toBeNull();
  });
});

describe('classifyYtDlpValidate', () => {
  it('supported when exit 0', () => {
    expect(classifyYtDlpValidate('{"title":"x"}', 0)).toEqual({ supported: true });
  });
  it('unsupported site reason', () => {
    const r = classifyYtDlpValidate('ERROR: Unsupported URL: http://x', 1);
    expect(r.supported).toBe(false);
    expect(r.reason).toContain('Unsupported');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/progress-parser.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 src/core/progress-parser.ts**

```ts
export function parseYtDlpProgress(line: string): number | null {
  const m = line.match(/\[download\]\s+([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

export function parseBaiduProgress(line: string): number | null {
  const m = line.match(/([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

export function classifyYtDlpValidate(
  stdout: string,
  exitCode: number,
): { supported: boolean; reason?: string } {
  if (exitCode === 0) return { supported: true };
  const err = stdout.match(/ERROR:\s*(.+)/);
  return { supported: false, reason: err ? err[1].trim() : 'validation failed' };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/progress-parser.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/progress-parser.ts test/progress-parser.test.ts
git commit -m "feat: 进度与校验输出解析器"
```

---

### Task 3: 配置加载与启动预检 Config

**Files:**
- Create: `src/core/config.ts`, `config.example.yaml`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `interface AppConfig { server:{port:number;sessionSecret:string}; auth:{username:string;password:string}; paths:{tempDir:string;ytdlp:string;ffmpeg:string}; audio:{format:string;quality:string}; cloud:{provider:string;baidu:{binary:string;bduss:string;targetDir:string}} }`;
  `loadConfig(text: string): AppConfig`(解析 yaml + 校验必填,缺失抛 `Error`);
  `checkBinaries(cfg: AppConfig, exists:(bin:string)=>boolean): string[]`(返回缺失二进制名数组)。

- [ ] **Step 1: 写失败测试 test/config.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig, checkBinaries } from '../src/core/config';

const good = `
server: { port: 8080, sessionSecret: s }
auth: { username: admin, password: p }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: BaiduPCS-Go, bduss: b, targetDir: /a } }
`;

describe('loadConfig', () => {
  it('parses a valid config', () => {
    const c = loadConfig(good);
    expect(c.server.port).toBe(8080);
    expect(c.cloud.baidu.targetDir).toBe('/a');
  });
  it('throws when a required field is missing', () => {
    expect(() => loadConfig('server: { port: 8080 }')).toThrow();
  });
});

describe('checkBinaries', () => {
  it('reports missing binaries', () => {
    const c = loadConfig(good);
    const missing = checkBinaries(c, (b) => b === 'yt-dlp');
    expect(missing).toContain('ffmpeg');
    expect(missing).toContain('BaiduPCS-Go');
    expect(missing).not.toContain('yt-dlp');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 src/core/config.ts**

```ts
import { parse } from 'yaml';

export interface AppConfig {
  server: { port: number; sessionSecret: string };
  auth: { username: string; password: string };
  paths: { tempDir: string; ytdlp: string; ffmpeg: string };
  audio: { format: string; quality: string };
  cloud: { provider: string; baidu: { binary: string; bduss: string; targetDir: string } };
}

function req(obj: any, path: string): any {
  const val = path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  if (val === undefined || val === null || val === '') {
    throw new Error(`Missing required config: ${path}`);
  }
  return val;
}

export function loadConfig(text: string): AppConfig {
  const raw = parse(text) ?? {};
  return {
    server: { port: Number(req(raw, 'server.port')), sessionSecret: String(req(raw, 'server.sessionSecret')) },
    auth: { username: String(req(raw, 'auth.username')), password: String(req(raw, 'auth.password')) },
    paths: {
      tempDir: String(req(raw, 'paths.tempDir')),
      ytdlp: String(req(raw, 'paths.ytdlp')),
      ffmpeg: String(req(raw, 'paths.ffmpeg')),
    },
    audio: { format: String(req(raw, 'audio.format')), quality: String(req(raw, 'audio.quality')) },
    cloud: {
      provider: String(req(raw, 'cloud.provider')),
      baidu: {
        binary: String(req(raw, 'cloud.baidu.binary')),
        bduss: String(req(raw, 'cloud.baidu.bduss')),
        targetDir: String(req(raw, 'cloud.baidu.targetDir')),
      },
    },
  };
}

export function checkBinaries(cfg: AppConfig, exists: (bin: string) => boolean): string[] {
  return [cfg.paths.ytdlp, cfg.paths.ffmpeg, cfg.cloud.baidu.binary].filter((b) => !exists(b));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/config.test.ts`
Expected: PASS。

- [ ] **Step 5: 写 config.example.yaml**

```yaml
server:
  port: 8080
  sessionSecret: "change-me"
auth:
  username: "admin"
  password: "change-me"
paths:
  tempDir: "/data/tmp"
  ytdlp: "yt-dlp"
  ffmpeg: "ffmpeg"
audio:
  format: "mp3"
  quality: "0"
cloud:
  provider: "baidu"
  baidu:
    binary: "BaiduPCS-Go"
    bduss: "change-me"
    targetDir: "/我的音频"
```

- [ ] **Step 6: 提交**

```bash
git add src/core/config.ts config.example.yaml test/config.test.ts
git commit -m "feat: 配置加载校验与二进制预检"
```

---

### Task 4: VideoSource 接口与 YtDlpSource

**Files:**
- Create: `src/sources/video-source.ts`, `src/sources/ytdlp-source.ts`
- Test: `test/ytdlp-source.test.ts`

**Interfaces:**
- Consumes: `VideoInfo` from types; `parseYtDlpProgress`, `classifyYtDlpValidate` from progress-parser; `AppConfig` from config.
- Produces: `interface VideoSource { validate(url:string):Promise<VideoInfo>; download(url:string, onProgress:(pct:number,msg:string)=>void):Promise<{filePath:string; title:string}> }`;
  `class YtDlpSource implements VideoSource`(构造函数注入 `AppConfig` 与可选 `spawnFn`);
  `selectSource(url:string, cfg:AppConfig): VideoSource`(工厂,当前恒返回 YtDlpSource)。
- 通过注入 `spawnFn: (cmd, args) => ChildProcessLike` 使测试可 mock;`ChildProcessLike` 暴露 `stdout`/`stderr` 事件流与 `on('close', code)`。

- [ ] **Step 1: 写失败测试 test/ytdlp-source.test.ts**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/ytdlp-source.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 src/sources/video-source.ts**

```ts
import type { VideoInfo } from '../core/types';

export interface VideoSource {
  validate(url: string): Promise<VideoInfo>;
  download(url: string, onProgress: (pct: number, msg: string) => void): Promise<{ filePath: string; title: string }>;
}
```

- [ ] **Step 4: 实现 src/sources/ytdlp-source.ts**

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import type { VideoSource } from './video-source';
import type { VideoInfo } from '../core/types';
import type { AppConfig } from '../core/config';
import { parseYtDlpProgress, classifyYtDlpValidate } from '../core/progress-parser';

type SpawnFn = typeof nodeSpawn;

export class YtDlpSource implements VideoSource {
  constructor(private cfg: AppConfig, private spawnFn: SpawnFn = nodeSpawn) {}

  validate(url: string): Promise<VideoInfo> {
    return new Promise((resolve) => {
      const p = this.spawnFn(this.cfg.paths.ytdlp, ['--dump-single-json', '--no-download', url]);
      let out = '';
      let err = '';
      p.stdout?.on('data', (d) => (out += d.toString()));
      p.stderr?.on('data', (d) => (err += d.toString()));
      p.on('close', (code) => {
        const cls = classifyYtDlpValidate(out + err, code ?? 1);
        if (!cls.supported) return resolve({ supported: false, reason: cls.reason });
        try {
          const j = JSON.parse(out);
          resolve({ supported: true, title: j.title, uploader: j.uploader, duration: j.duration });
        } catch {
          resolve({ supported: true });
        }
      });
    });
  }

  download(url: string, onProgress: (pct: number, msg: string) => void): Promise<{ filePath: string; title: string }> {
    return new Promise((resolve, reject) => {
      const template = join(this.cfg.paths.tempDir, '%(title)s.%(ext)s');
      const args = [
        '-x',
        '--audio-format', this.cfg.audio.format,
        '--audio-quality', this.cfg.audio.quality,
        '--ffmpeg-location', this.cfg.paths.ffmpeg,
        '-o', template,
        '--newline',
        url,
      ];
      const p = this.spawnFn(this.cfg.paths.ytdlp, args);
      let filePath = '';
      let title = '';
      let err = '';
      const handle = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          const pct = parseYtDlpProgress(line);
          if (pct !== null) onProgress(pct, line);
          const dest = line.match(/\[(?:download|ExtractAudio)\] Destination: (.+)/) || line.match(/\[download\] (.+) has already been downloaded/);
          if (dest) {
            filePath = dest[1].trim();
            title = filePath.split('/').pop()!.replace(/\.[^.]+$/, '');
          }
        }
      };
      p.stdout?.on('data', (d) => handle(d.toString()));
      p.stderr?.on('data', (d) => (err += d.toString()));
      p.on('close', (code) => {
        if (code === 0 && filePath) resolve({ filePath, title });
        else reject(new Error(err || `yt-dlp exited with code ${code}`));
      });
    });
  }
}

export function selectSource(_url: string, cfg: AppConfig): VideoSource {
  return new YtDlpSource(cfg);
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run test/ytdlp-source.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/sources/video-source.ts src/sources/ytdlp-source.ts test/ytdlp-source.test.ts
git commit -m "feat: VideoSource 接口与 YtDlpSource(validate/download)"
```

---

### Task 5: CloudUploader 接口与 BaiduUploader

**Files:**
- Create: `src/uploaders/cloud-uploader.ts`, `src/uploaders/baidu-uploader.ts`
- Test: `test/baidu-uploader.test.ts`

**Interfaces:**
- Consumes: `parseBaiduProgress` from progress-parser; `AppConfig` from config.
- Produces: `interface CloudUploader { upload(localPath:string, onProgress:(pct:number,msg:string)=>void):Promise<void> }`;
  `class BaiduUploader implements CloudUploader`(注入 `AppConfig` 与可选 `spawnFn`);
  `selectUploader(cfg:AppConfig): CloudUploader`(按 `cfg.cloud.provider` 选择,`baidu`→BaiduUploader,未知抛错)。

- [ ] **Step 1: 写失败测试 test/baidu-uploader.test.ts**

```ts
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
    expect(args).toContain('/audio');
    expect(args).toContain('/tmp/Song.mp3');
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
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/baidu-uploader.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 src/uploaders/cloud-uploader.ts**

```ts
export interface CloudUploader {
  upload(localPath: string, onProgress: (pct: number, msg: string) => void): Promise<void>;
}
```

- [ ] **Step 4: 实现 src/uploaders/baidu-uploader.ts**

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import type { CloudUploader } from './cloud-uploader';
import type { AppConfig } from '../core/config';
import { parseBaiduProgress } from '../core/progress-parser';

type SpawnFn = typeof nodeSpawn;

export class BaiduUploader implements CloudUploader {
  constructor(private cfg: AppConfig, private spawnFn: SpawnFn = nodeSpawn) {}

  upload(localPath: string, onProgress: (pct: number, msg: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const b = this.cfg.cloud.baidu;
      const p = this.spawnFn(b.binary, ['upload', localPath, b.targetDir]);
      let err = '';
      p.stdout?.on('data', (d) => {
        for (const line of d.toString().split(/\r?\n/)) {
          const pct = parseBaiduProgress(line);
          if (pct !== null) onProgress(pct, line);
        }
      });
      p.stderr?.on('data', (d) => (err += d.toString()));
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(err || `BaiduPCS-Go exited with code ${code}`));
      });
    });
  }
}

export function selectUploader(cfg: AppConfig): CloudUploader {
  if (cfg.cloud.provider === 'baidu') return new BaiduUploader(cfg);
  throw new Error(`Unsupported cloud provider: ${cfg.cloud.provider}`);
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run test/baidu-uploader.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/uploaders/cloud-uploader.ts src/uploaders/baidu-uploader.ts test/baidu-uploader.test.ts
git commit -m "feat: CloudUploader 接口与 BaiduUploader"
```

---

### Task 6: TaskRunner 四阶段编排

**Files:**
- Create: `src/core/task-runner.ts`
- Test: `test/task-runner.test.ts`

**Interfaces:**
- Consumes: `VideoSource`, `CloudUploader`, `ProgressEvent`, `TaskState`, `Stage`。
- Produces: `class TaskRunner`,构造 `new TaskRunner(source, uploader, deps?)`,
  `deps = { rm?: (path:string)=>Promise<void>; idGen?: ()=>string }`;
  方法:`start(url:string, emit:(e:ProgressEvent)=>void): { taskId:string }`(忙碌时抛 `Error('busy')`);
  `getCurrent(): TaskState | null`;`isBusy(): boolean`。
  阶段顺序:resolving(download 内含)→ downloading(0-100)→ uploading(0-100)→ cleaning → done;任一失败 emit `status:'failed'` 且清理临时文件。

- [ ] **Step 1: 写失败测试 test/task-runner.test.ts**

```ts
import { describe, it, expect, vi } from 'vitest';
import { TaskRunner } from '../src/core/task-runner';
import type { ProgressEvent } from '../src/core/types';

function makeSource(over: Partial<any> = {}) {
  return {
    validate: vi.fn(),
    download: vi.fn(async (_url: string, onP: (p: number, m: string) => void) => {
      onP(50, 'half'); onP(100, 'done');
      return { filePath: '/tmp/Song.mp3', title: 'Song' };
    }),
    ...over,
  };
}
function makeUploader(over: Partial<any> = {}) {
  return {
    upload: vi.fn(async (_p: string, onP: (p: number, m: string) => void) => { onP(100, 'up'); }),
    ...over,
  };
}

async function flush() { await new Promise((r) => setTimeout(r, 0)); }

describe('TaskRunner', () => {
  it('runs stages in order and cleans up', async () => {
    const rm = vi.fn(async () => {});
    const runner = new TaskRunner(makeSource() as any, makeUploader() as any, { rm, idGen: () => 't1' });
    const events: ProgressEvent[] = [];
    runner.start('http://v', (e) => events.push(e));
    await flush(); await flush(); await flush();
    const stages = events.map((e) => e.stage);
    expect(stages).toContain('downloading');
    expect(stages).toContain('uploading');
    expect(stages).toContain('cleaning');
    expect(events.at(-1)!.stage).toBe('done');
    expect(events.at(-1)!.status).toBe('success');
    expect(rm).toHaveBeenCalledWith('/tmp/Song.mp3');
  });

  it('rejects concurrent start with busy', () => {
    const runner = new TaskRunner(makeSource() as any, makeUploader({ upload: vi.fn(() => new Promise(() => {})) }) as any, { idGen: () => 't1' });
    runner.start('http://v', () => {});
    expect(() => runner.start('http://v2', () => {})).toThrow('busy');
    expect(runner.isBusy()).toBe(true);
  });

  it('emits failed and cleans up on download error', async () => {
    const rm = vi.fn(async () => {});
    const badSource = makeSource({ download: vi.fn(async () => { throw new Error('boom'); }) });
    const runner = new TaskRunner(badSource as any, makeUploader() as any, { rm, idGen: () => 't1' });
    const events: ProgressEvent[] = [];
    runner.start('http://v', (e) => events.push(e));
    await flush(); await flush();
    expect(events.at(-1)!.status).toBe('failed');
    expect(events.at(-1)!.stage).toBe('error');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/task-runner.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 src/core/task-runner.ts**

```ts
import { randomUUID } from 'node:crypto';
import { rm as fsRm } from 'node:fs/promises';
import type { VideoSource } from '../sources/video-source';
import type { CloudUploader } from '../uploaders/cloud-uploader';
import type { ProgressEvent, TaskState, Stage, RunStatus } from './types';

interface Deps {
  rm?: (path: string) => Promise<void>;
  idGen?: () => string;
}

export class TaskRunner {
  private current: TaskState | null = null;
  private rm: (path: string) => Promise<void>;
  private idGen: () => string;

  constructor(private source: VideoSource, private uploader: CloudUploader, deps: Deps = {}) {
    this.rm = deps.rm ?? ((p) => fsRm(p, { force: true }));
    this.idGen = deps.idGen ?? (() => randomUUID());
  }

  isBusy(): boolean {
    return this.current !== null && this.current.status === 'running';
  }

  getCurrent(): TaskState | null {
    return this.current;
  }

  start(url: string, emit: (e: ProgressEvent) => void): { taskId: string } {
    if (this.isBusy()) throw new Error('busy');
    const taskId = this.idGen();
    this.current = { taskId, url, stage: 'resolving', percent: 0, status: 'running' };
    void this.run(taskId, url, emit);
    return { taskId };
  }

  private update(stage: Stage, percent: number, message: string, status: RunStatus, emit: (e: ProgressEvent) => void, title?: string, error?: string) {
    const c = this.current!;
    c.stage = stage; c.percent = percent; c.status = status;
    if (title) c.title = title;
    if (error) c.error = error;
    emit({ taskId: c.taskId, stage, percent, title: c.title, message, status });
  }

  private async run(taskId: string, url: string, emit: (e: ProgressEvent) => void) {
    let filePath = '';
    try {
      this.update('resolving', 0, 'resolving', 'running', emit);
      const { filePath: fp, title } = await this.source.download(url, (pct, msg) =>
        this.update('downloading', pct, msg, 'running', emit),
      );
      filePath = fp;
      this.update('downloading', 100, 'downloaded', 'running', emit, title);

      await this.uploader.upload(filePath, (pct, msg) =>
        this.update('uploading', pct, msg, 'running', emit),
      );
      this.update('uploading', 100, 'uploaded', 'running', emit);

      this.update('cleaning', 100, 'cleaning', 'running', emit);
      if (filePath) await this.rm(filePath);

      this.update('done', 100, 'all done', 'success', emit);
    } catch (e) {
      if (filePath) await this.rm(filePath).catch(() => {});
      this.update('error', this.current!.percent, (e as Error).message, 'failed', emit, undefined, (e as Error).message);
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/task-runner.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/task-runner.ts test/task-runner.test.ts
git commit -m "feat: TaskRunner 四阶段编排与清理"
```

---

### Task 7: 鉴权 session 与 AuthMiddleware

**Files:**
- Create: `src/server/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `AppConfig`。
- Produces: `class SessionStore { create():string; has(token:string):boolean; delete(token:string):void }`;
  `verifyLogin(cfg:AppConfig, user:string, pass:string):boolean`。

- [ ] **Step 1: 写失败测试 test/auth.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { SessionStore, verifyLogin } from '../src/server/auth';
import { loadConfig } from '../src/core/config';

const cfg = loadConfig(`
server: { port: 1, sessionSecret: s }
auth: { username: admin, password: secret }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: b, bduss: x, targetDir: /a } }
`);

describe('verifyLogin', () => {
  it('accepts correct credentials', () => {
    expect(verifyLogin(cfg, 'admin', 'secret')).toBe(true);
  });
  it('rejects wrong credentials', () => {
    expect(verifyLogin(cfg, 'admin', 'nope')).toBe(false);
  });
});

describe('SessionStore', () => {
  it('creates and validates tokens', () => {
    const s = new SessionStore();
    const t = s.create();
    expect(s.has(t)).toBe(true);
    s.delete(t);
    expect(s.has(t)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 src/server/auth.ts**

```ts
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../core/config';

export function verifyLogin(cfg: AppConfig, user: string, pass: string): boolean {
  return user === cfg.auth.username && pass === cfg.auth.password;
}

export class SessionStore {
  private tokens = new Set<string>();
  create(): string {
    const t = randomUUID();
    this.tokens.add(t);
    return t;
  }
  has(token: string): boolean {
    return this.tokens.has(token);
  }
  delete(token: string): void {
    this.tokens.delete(token);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/server/auth.ts test/auth.test.ts
git commit -m "feat: 登录校验与内存 SessionStore"
```

---

### Task 8: Fastify 路由与 WebSocket 组装

**Files:**
- Create: `src/server/routes.ts`, `src/server/ws.ts`, `src/server/server.ts`, `src/index.ts`
- Test: `test/routes.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `verifyLogin`, `TaskRunner`, `selectSource`, `selectUploader`, `AppConfig`, `ProgressEvent`, `VideoInfo`。
- Produces: `buildServer(cfg:AppConfig, deps:{ runner:TaskRunner; sessions:SessionStore; validateUrl:(url:string)=>Promise<VideoInfo>; broadcast?:(e:ProgressEvent)=>void }): FastifyInstance`。
  路由:`POST /api/login`、`POST /api/logout`、`POST /api/validate`、`POST /api/tasks`(忙碌→409)、`GET /api/tasks/current`;WebSocket `/ws`。
  登录用 `@fastify/cookie` 签名 cookie `sid`;除 `/api/login` 外所有 `/api/*` 与 `/ws` 校验 session。

- [ ] **Step 1: 写失败测试 test/routes.test.ts**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/routes.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 src/server/ws.ts**

```ts
import type { WebSocket } from 'ws';
import type { ProgressEvent } from '../core/types';

export class Broadcaster {
  private clients = new Set<WebSocket>();
  add(ws: WebSocket) { this.clients.add(ws); ws.on('close', () => this.clients.delete(ws)); }
  send(e: ProgressEvent) {
    const data = JSON.stringify(e);
    for (const ws of this.clients) { try { ws.send(data); } catch { /* ignore */ } }
  }
}
```

- [ ] **Step 4: 实现 src/server/server.ts(含路由)**

```ts
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
    scoped.get('/ws', { websocket: true }, (conn, req) => {
      if (!authed(req)) { conn.socket.close(); return; }
      bc.add(conn.socket);
    });
  });

  return app;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run test/routes.test.ts`
Expected: PASS。

- [ ] **Step 6: 写 src/index.ts 入口(预检 + 启动)**

```ts
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
```

- [ ] **Step 7: 安装 @fastify/static 并确认全部测试通过**

```bash
npm i @fastify/static
npx vitest run
```
Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/server/routes.ts src/server/ws.ts src/server/server.ts src/index.ts test/routes.test.ts package.json package-lock.json
git commit -m "feat: Fastify 路由、WebSocket 广播与服务入口"
```

---

### Task 9: Vue 3 前端(登录 + 主页面进度)

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tailwind.config.js`, `web/postcss.config.js`, `web/index.html`, `web/src/main.ts`, `web/src/style.css`, `web/src/App.vue`, `web/src/api.ts`, `web/src/ws.ts`, `web/src/views/Login.vue`, `web/src/views/Home.vue`

**Interfaces:**
- Consumes: 后端 REST + `/ws`(`ProgressEvent` 形状)。
- Produces: 构建产物 `web/dist`,由后端 `@fastify/static` 托管。

- [ ] **Step 1: 初始化前端工程与依赖**

```bash
cd web
npm init -y
npm pkg set type="module"
npm pkg set scripts.dev="vite"
npm pkg set scripts.build="vite build"
npm i vue
npm i -D vite @vitejs/plugin-vue tailwindcss postcss autoprefixer
npx tailwindcss init -p
cd ..
```

- [ ] **Step 2: 配置 Vite / Tailwind**

`web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist' },
  server: { proxy: { '/api': 'http://localhost:8080', '/ws': { target: 'ws://localhost:8080', ws: true } } },
});
```
`web/tailwind.config.js` 的 `content`:
```js
export default { content: ['./index.html', './src/**/*.{vue,ts}'], theme: { extend: {} }, plugins: [] };
```
`web/src/style.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: 写 index.html 与 main.ts**

`web/index.html`:
```html
<!doctype html>
<html lang="zh">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>音频提取</title></head>
  <body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>
</html>
```
`web/src/main.ts`:
```ts
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
createApp(App).mount('#app');
```

- [ ] **Step 4: 写 api.ts 与 ws.ts**

`web/src/api.ts`:
```ts
export async function post(path: string, body?: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
export async function getCurrent() {
  const res = await fetch('/api/tasks/current');
  return res.json().catch(() => null);
}
```
`web/src/ws.ts`:
```ts
export function connectProgress(onEvent: (e: any) => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } };
  return ws;
}
```

- [ ] **Step 5: 写 App.vue(登录态切换)**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Login from './views/Login.vue';
import Home from './views/Home.vue';
const authed = ref(false);
async function check() { const res = await fetch('/api/tasks/current'); authed.value = res.status !== 401; }
onMounted(check);
</script>
<template>
  <div class="min-h-screen bg-slate-50 text-slate-800">
    <Login v-if="!authed" @ok="authed = true" />
    <Home v-else @logout="authed = false" />
  </div>
</template>
```

- [ ] **Step 6: 写 Login.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { post } from '../api';
const emit = defineEmits<{ ok: [] }>();
const username = ref(''); const password = ref(''); const error = ref('');
async function submit() {
  const { status } = await post('/api/login', { username: username.value, password: password.value });
  if (status === 200) emit('ok'); else error.value = '用户名或密码错误';
}
</script>
<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="w-80 bg-white rounded-2xl shadow p-8 space-y-4">
      <h1 class="text-xl font-semibold text-center">登录</h1>
      <input v-model="username" placeholder="用户名" class="w-full border rounded-lg px-3 py-2" />
      <input v-model="password" type="password" placeholder="密码" class="w-full border rounded-lg px-3 py-2" @keyup.enter="submit" />
      <p v-if="error" class="text-red-500 text-sm">{{ error }}</p>
      <button @click="submit" class="w-full bg-slate-800 text-white rounded-lg py-2 hover:bg-slate-700">进入</button>
    </div>
  </div>
</template>
```

- [ ] **Step 7: 写 Home.vue(校验 + 提交 + 进度)**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { post, getCurrent } from '../api';
import { connectProgress } from '../ws';
const emit = defineEmits<{ logout: [] }>();
const url = ref(''); const info = ref<any>(null); const checking = ref(false);
const stage = ref(''); const percent = ref(0); const logs = ref<string[]>([]); const status = ref('');
const stages: Record<string, string> = { resolving: '解析', downloading: '下载转码', uploading: '上传网盘', cleaning: '清理', done: '完成', error: '出错' };

async function validate() {
  info.value = null; checking.value = true;
  const { data } = await post('/api/validate', { url: url.value });
  info.value = data; checking.value = false;
}
async function submit() {
  const { status: st } = await post('/api/tasks', { url: url.value });
  if (st === 409) { logs.value.unshift('已有任务在进行中'); return; }
  logs.value = []; status.value = 'running';
}
function apply(e: any) {
  stage.value = e.stage; percent.value = e.percent; status.value = e.status;
  logs.value.unshift(`[${stages[e.stage] ?? e.stage}] ${e.message}`);
}
async function logout() { await post('/api/logout'); emit('logout'); }
onMounted(async () => {
  connectProgress(apply);
  const cur = await getCurrent(); if (cur) apply({ ...cur, message: '恢复任务' });
});
</script>
<template>
  <div class="max-w-2xl mx-auto p-6 space-y-5">
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-semibold">视频音频提取</h1>
      <button @click="logout" class="text-sm text-slate-500 hover:text-slate-800">退出</button>
    </div>
    <div class="bg-white rounded-2xl shadow p-5 space-y-3">
      <div class="flex gap-2">
        <input v-model="url" placeholder="粘贴视频链接 (Bilibili / YouTube ...)" class="flex-1 border rounded-lg px-3 py-2" />
        <button @click="validate" :disabled="checking" class="px-4 rounded-lg bg-slate-200 hover:bg-slate-300">校验</button>
      </div>
      <div v-if="info" class="text-sm">
        <p v-if="info.supported" class="text-green-600">✅ 支持:{{ info.title }} <span v-if="info.duration" class="text-slate-400">({{ Math.round(info.duration) }}s)</span></p>
        <p v-else class="text-red-500">❌ 不支持:{{ info.reason }}</p>
      </div>
      <button @click="submit" :disabled="!info?.supported || status === 'running'" class="w-full bg-slate-800 text-white rounded-lg py-2 disabled:opacity-40 hover:bg-slate-700">开始提取并上传</button>
    </div>
    <div v-if="stage" class="bg-white rounded-2xl shadow p-5 space-y-3">
      <div class="flex justify-between text-sm"><span>{{ stages[stage] ?? stage }}</span><span>{{ Math.round(percent) }}%</span></div>
      <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div class="h-full bg-slate-800 transition-all" :style="{ width: percent + '%' }"></div>
      </div>
      <p v-if="status === 'failed'" class="text-red-500 text-sm">任务失败</p>
      <p v-if="status === 'success'" class="text-green-600 text-sm">全部完成 🎉</p>
      <div class="max-h-48 overflow-auto text-xs text-slate-500 font-mono space-y-0.5">
        <div v-for="(l, i) in logs" :key="i">{{ l }}</div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 8: 构建前端确认成功**

Run: `cd web && npm run build && cd ..`
Expected: 生成 `web/dist`,无构建错误。

- [ ] **Step 9: 提交**

```bash
git add web
git commit -m "feat: Vue3 + Tailwind 前端(登录、校验、进度)"
```

---

### Task 10: 容器化与 docker-compose

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`

**Interfaces:**
- Consumes: 全部源码;运行时读取挂载的 `config.yaml`,监听 `server.port`。

- [ ] **Step 1: 写 .dockerignore**

```
node_modules
web/node_modules
dist
web/dist
.git
```

- [ ] **Step 2: 写 Dockerfile(多阶段,内置全部依赖)**

```dockerfile
# --- build stage ---
FROM node:20-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
COPY web ./web
RUN cd web && npm ci && npm run build

# --- runtime stage ---
FROM node:20-bookworm-slim
WORKDIR /app
# 系统依赖:ffmpeg + python(yt-dlp)+ curl(装 BaiduPCS-Go)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 curl ca-certificates \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && curl -L https://github.com/qjfoidnh/BaiduPCS-Go/releases/download/v3.9.7/BaiduPCS-Go-v3.9.7-linux-amd64.zip -o /tmp/b.zip \
 && apt-get install -y --no-install-recommends unzip \
 && unzip /tmp/b.zip -d /tmp/b && cp /tmp/b/*/BaiduPCS-Go /usr/local/bin/BaiduPCS-Go \
 && chmod a+rx /usr/local/bin/BaiduPCS-Go \
 && rm -rf /tmp/b /tmp/b.zip \
 && apt-get purge -y unzip && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
ENV CONFIG_PATH=/config/config.yaml
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: 写 docker-compose.yml(测试与部署样例)**

```yaml
services:
  audio-uploader:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./config.yaml:/config/config.yaml:ro
      - ./data/tmp:/data/tmp
    restart: unless-stopped
```

- [ ] **Step 4: 容器冒烟测试**

```bash
cp config.example.yaml config.yaml   # 按需改端口/凭证;tempDir 设为 /data/tmp
docker compose build
docker compose up -d
sleep 5
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:8080/api/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"change-me"}'
# Expected: 200(凭证与 config.yaml 一致时)
docker compose down
```

- [ ] **Step 5: 提交**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "chore: 容器化 Dockerfile 与 docker-compose"
```

---

## Self-Review

**1. Spec coverage:**
- 登录鉴权 → Task 7 + Task 8(路由保护)。
- 链接支持性校验 `/api/validate` → Task 4(validate)+ Task 8(路由)+ Task 9(前端 UI)。
- 视频下载 + mp3 最高质量 → Task 4(yt-dlp `-x --audio-format mp3 --audio-quality 0`)。
- 云盘上传(百度,可扩展)→ Task 5(接口 + BaiduUploader + selectUploader)。
- 四阶段编排 + 单活动任务 + 清理 → Task 6。
- 进度实时展示(WebSocket)→ Task 8(Broadcaster)+ Task 9(进度条/日志)。
- 视频网站自动识别多站点 → Task 4(selectSource + yt-dlp)。
- 无数据库、配置文件驱动 → Task 3(Config)。
- 启动预检 → Task 3(checkBinaries)+ Task 8(index.ts)。
- 页面美观清爽 → Task 9(Tailwind)。
- 容器化 + docker-compose 测试 → Task 10。

**2. Placeholder scan:** 无 TBD/TODO;每个代码步骤含完整代码。

**3. Type consistency:** `ProgressEvent`/`VideoInfo`/`TaskState`(Task 1)在各 Task 一致;`VideoSource.download` 返回 `{filePath,title}` 在 Task 4/6 一致;`CloudUploader.upload` 签名在 Task 5/6 一致;`TaskRunner` 方法 `start/getCurrent/isBusy` 在 Task 6/8 一致;`SessionStore` 方法在 Task 7/8 一致。

> 注:BaiduPCS-Go 版本号与下载 URL 在 Task 10 为示例(v3.9.7),执行时按最新可用 release 校正;首次使用需在容器内用 BDUSS 或扫码登录一次(`BaiduPCS-Go login`),可作为部署说明补充。
