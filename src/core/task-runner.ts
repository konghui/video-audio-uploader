import { randomUUID } from 'node:crypto';
import { rm as fsRm } from 'node:fs/promises';
import type { VideoSource } from '../sources/video-source.js';
import type { CloudUploader } from '../uploaders/cloud-uploader.js';
import type { ProgressEvent, TaskState, Stage, RunStatus } from './types.js';

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

  start(url: string, emit: (e: ProgressEvent) => void, format?: string): { taskId: string } {
    if (this.isBusy()) throw new Error('busy');
    const taskId = this.idGen();
    this.current = { taskId, url, stage: 'resolving', percent: 0, status: 'running' };
    void this.run(url, emit, format);
    return { taskId };
  }

  private update(stage: Stage, percent: number, message: string, status: RunStatus, emit: (e: ProgressEvent) => void, title?: string, error?: string) {
    const c = this.current!;
    c.stage = stage; c.percent = percent; c.status = status;
    if (title) c.title = title;
    if (error) c.error = error;
    emit({ taskId: c.taskId, stage, percent, title: c.title, message, status });
  }

  private async run(url: string, emit: (e: ProgressEvent) => void, format?: string) {
    let filePath = '';
    try {
      this.update('resolving', 0, 'resolving', 'running', emit);
      const { filePath: fp, title } = await this.source.download(url, (pct, msg) =>
        this.update('downloading', pct, msg, 'running', emit),
      format);
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
