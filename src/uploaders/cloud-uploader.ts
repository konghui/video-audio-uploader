export interface CloudUploader {
  upload(localPath: string, onProgress: (pct: number, msg: string) => void): Promise<void>;
}
