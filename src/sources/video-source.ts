import type { VideoInfo } from '../core/types.js';

export interface VideoSource {
  validate(url: string): Promise<VideoInfo>;
  download(url: string, onProgress: (pct: number, msg: string) => void): Promise<{ filePath: string; title: string }>;
}
