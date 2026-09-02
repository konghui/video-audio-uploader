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

export interface CloudFile {
  name: string;
  size?: string;
  date?: string;
  isDir: boolean;
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
