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
