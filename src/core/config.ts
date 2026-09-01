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
