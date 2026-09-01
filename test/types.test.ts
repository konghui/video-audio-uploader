import { describe, it, expect } from 'vitest';
import type { ProgressEvent, VideoInfo, TaskState, Stage } from '../src/core/types';

describe('types', () => {
  it('constructs a ProgressEvent', () => {
    const e: ProgressEvent = { taskId: 't1', stage: 'downloading', percent: 12, message: 'x', status: 'running' };
    expect(e.stage).toBe('downloading');
  });
  it('constructs a VideoInfo unsupported', () => {
    const v: VideoInfo = { supported: false, reason: 'unsupported site' };
    expect(v.supported).toBe(false);
  });
  it('constructs a TaskState', () => {
    const s: TaskState = { taskId: 't1', url: 'u', stage: 'resolving', percent: 0, status: 'running' };
    const st: Stage = s.stage;
    expect(st).toBe('resolving');
  });
});
