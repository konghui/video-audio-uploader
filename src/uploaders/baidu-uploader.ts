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
      const p = this.spawnFn(b.binary, ['login', `-bduss=${b.bduss}`]);
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

  async upload(localPath: string, onProgress: (pct: number, msg: string) => void): Promise<void> {
    await this.login();
    return new Promise((resolve, reject) => {
      const b = this.cfg.cloud.baidu;
      const p = this.spawnFn(b.binary, ['upload', localPath, b.targetDir]);
      let err = '';
      let buf = '';
      let settled = false;
      const parseLine = (line: string) => {
        const pct = parseBaiduProgress(line);
        if (pct !== null) onProgress(pct, line);
      };
      p.stdout?.on('data', (d) => {
        buf += d.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const part of parts) parseLine(part.replace(/\r$/, ''));
      });
      p.stderr?.on('data', (d) => (err += d.toString()));
      p.on('error', (e) => {
        if (settled) return;
        settled = true;
        reject(e);
      });
      p.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (buf) parseLine(buf.replace(/\r$/, ''));
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
