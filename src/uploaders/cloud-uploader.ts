import type { CloudFile } from '../core/types.js';

export interface CloudUploader {
  upload(localPath: string, onProgress: (pct: number, msg: string) => void): Promise<void>;
  list(): Promise<CloudFile[]>;
  remove(name: string): Promise<void>;
  fetch(name: string, localDir: string): Promise<string>;
}
