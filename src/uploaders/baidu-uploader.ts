import { spawn as nodeSpawn } from 'node:child_process';
import type { CloudUploader } from './cloud-uploader.js';
import type { AppConfig } from '../core/config.js';
import { parseBaiduProgress } from '../core/progress-parser.js';

type SpawnFn = typeof nodeSpawn;

export class BaiduUploader implements CloudUploader {
  constructor(private cfg: AppConfig, private spawnFn: SpawnFn = nodeSpawn) {}

  private login(): Promise<void> {
    return new Promise((resolve, reject) => {
      const b = this.cfg.cloud.baidu;
      const args = ['login', `-bduss=${b.bduss}`];
      if (b.stoken) args.push(`-stoken=${b.stoken}`);
      if (b.ptoken) args.push(`-ptoken=${b.ptoken}`);
      const p = this.spawnFn(b.binary, args);
      let err = '';
      let settled = false;
      p.stderr?.on('data', (d) => (err += d.toString()));
      p.on('error', (e) => {
        if (settled) return;
        settled = true;
        reject(e);
      });
      p.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) resolve();
        else reject(new Error(err || `BaiduPCS-Go login exited with code ${code}`));
      });
    });
  }

  // Best-effort: ensure the target directory exists. BaiduPCS-Go upload fails
  // with "代码: -9, 消息: 文件不存在" when the dir is missing. mkdir on an
  // existing dir is harmless, so we ignore its exit code and output. A
  // spawn-level error (e.g. binary missing) is still a real failure.
  private ensureDir(): Promise<void> {
    return new Promise((resolve, reject) => {
      const b = this.cfg.cloud.baidu;
      const p = this.spawnFn(b.binary, ['mkdir', b.targetDir]);
      let settled = false;
      p.on('error', (e) => {
        if (settled) return;
        settled = true;
        reject(e);
      });
      p.on('close', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  }

  async upload(localPath: string, onProgress: (pct: number, msg: string) => void): Promise<void> {
    await this.login();
    await this.ensureDir();
    return new Promise((resolve, reject) => {
      const b = this.cfg.cloud.baidu;
      const p = this.spawnFn(b.binary, ['upload', localPath, b.targetDir]);
      let out = '';
      let buf = '';
      let settled = false;
      const parseLine = (line: string) => {
        const pct = parseBaiduProgress(line);
        if (pct !== null) onProgress(pct, line);
      };
      p.stdout?.on('data', (d) => {
        const s = d.toString();
        out += s;
        buf += s;
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const part of parts) parseLine(part.replace(/\r$/, ''));
      });
      p.stderr?.on('data', (d) => (out += d.toString()));
      p.on('error', (e) => {
        if (settled) return;
        settled = true;
        reject(e);
      });
      p.on('close', () => {
        if (settled) return;
        settled = true;
        if (buf) parseLine(buf.replace(/\r$/, ''));
        // BaiduPCS-Go returns exit code 0 even when the upload FAILS, so we
        // MUST decide success from the output, not the exit code. Resolving on
        // a false success would let TaskRunner delete the local mp3 -> data loss.
        const failureMarkers = ['上传失败', '失败文件数', '以下文件上传失败', '请重新登录'];
        const isFailure = failureMarkers.some((m) => out.includes(m));
        if (isFailure) {
          const idx = out.lastIndexOf('消息:');
          let reason = '上传失败';
          if (idx !== -1) {
            const tail = out.slice(idx + '消息:'.length).split('\n')[0]?.trim();
            if (tail) reason = tail;
          }
          reject(new Error(reason));
          return;
        }
        // BaiduPCS-Go SKIPS (exit 0) when the target file already exists,
        // printing e.g. "目标文件, /path, 已存在, 跳过...". The file IS on the
        // netdisk, so this is effectively a success. The failure check above
        // runs first, so a real failure marker still wins over this skip case.
        const isSkippedExisting = /已存在[,，\s]*跳过/.test(out);
        const isSuccess = out.includes('上传文件成功') || out.includes('上传成功') || isSkippedExisting;
        if (isSuccess) {
          resolve();
          return;
        }
        // Neither marker present: ambiguous. Reject conservatively to avoid a
        // false success (and subsequent local-file deletion).
        reject(new Error('上传结果未知: ' + out.slice(-200)));
      });
    });
  }
}

export function selectUploader(cfg: AppConfig): CloudUploader {
  if (cfg.cloud.provider === 'baidu') return new BaiduUploader(cfg);
  throw new Error(`Unsupported cloud provider: ${cfg.cloud.provider}`);
}
