import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir as fsMkdir, rm as fsRm } from 'node:fs/promises';
import type { VideoSource } from './video-source.js';
import type { VideoInfo } from '../core/types.js';
import type { AppConfig } from '../core/config.js';
import { parseYtDlpProgress, classifyYtDlpValidate } from '../core/progress-parser.js';

type SpawnFn = typeof nodeSpawn;

interface FsDeps {
  mkdir?: (path: string) => Promise<void>;
  rmrf?: (path: string) => Promise<void>;
  idGen?: () => string;
}

export class YtDlpSource implements VideoSource {
  private mkdir: (path: string) => Promise<void>;
  private rmrf: (path: string) => Promise<void>;
  private idGen: () => string;

  constructor(private cfg: AppConfig, private spawnFn: SpawnFn = nodeSpawn, deps: FsDeps = {}) {
    this.mkdir = deps.mkdir ?? (async (p) => { await fsMkdir(p, { recursive: true }); });
    this.rmrf = deps.rmrf ?? ((p) => fsRm(p, { recursive: true, force: true }));
    this.idGen = deps.idGen ?? (() => randomUUID());
  }

  validate(url: string): Promise<VideoInfo> {
    return new Promise((resolve) => {
      const p = this.spawnFn(this.cfg.paths.ytdlp, ['--dump-single-json', '--no-download', url]);
      let out = '';
      let err = '';
      let settled = false;
      p.stdout?.on('data', (d) => (out += d.toString()));
      p.stderr?.on('data', (d) => (err += d.toString()));
      p.on('error', (e) => {
        if (settled) return;
        settled = true;
        resolve({ supported: false, reason: (e as Error).message });
      });
      p.on('close', (code) => {
        if (settled) return;
        settled = true;
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

  async download(url: string, onProgress: (pct: number, msg: string) => void, format?: string): Promise<{ filePath: string; title: string }> {
    const fmt = format ?? this.cfg.audio.format;
    const subdir = join(this.cfg.paths.tempDir, `dl-${this.idGen()}`);
    await this.mkdir(subdir);
    try {
      return await new Promise<{ filePath: string; title: string }>((resolve, reject) => {
        const template = join(subdir, '%(title)s.%(ext)s');
        const args = [
          '-x',
          '--audio-format', fmt,
          '--audio-quality', this.cfg.audio.quality,
        ];
        // --ffmpeg-location expects a path/dir; only pass it when the config
        // value is an actual path. A bare command name (e.g. "ffmpeg") must be
        // resolved from PATH by yt-dlp itself, so omit the flag in that case.
        if (this.cfg.paths.ffmpeg.includes('/')) {
          args.push('--ffmpeg-location', this.cfg.paths.ffmpeg);
        }
        args.push('-o', template, '--newline', url);
        const p = this.spawnFn(this.cfg.paths.ytdlp, args);
        let filePath = '';
        let title = '';
        let err = '';
        let buf = '';
        let settled = false;
        const parseLine = (line: string) => {
          const pct = parseYtDlpProgress(line);
          if (pct !== null) onProgress(pct, line);
          const dest = line.match(/\[(?:download|ExtractAudio)\] Destination: (.+)/) || line.match(/\[download\] (.+) has already been downloaded/);
          if (dest) {
            filePath = dest[1].trim();
            title = filePath.split('/').pop()!.replace(/\.[^.]+$/, '');
          }
        };
        const handle = (chunk: string) => {
          buf += chunk;
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          for (const part of parts) parseLine(part.replace(/\r$/, ''));
        };
        p.stdout?.on('data', (d) => handle(d.toString()));
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
          if (code !== 0) return reject(new Error(err || `yt-dlp exited with code ${code}`));
          if (!filePath) return reject(new Error('Download succeeded but no output file path found in yt-dlp output'));
          resolve({ filePath, title });
        });
      });
    } catch (e) {
      await this.rmrf(subdir).catch(() => {});
      throw e;
    }
  }
}

export function selectSource(_url: string, cfg: AppConfig): VideoSource {
  return new YtDlpSource(cfg);
}
