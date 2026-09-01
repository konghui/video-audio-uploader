import { describe, it, expect, vi } from 'vitest';
import { TaskRunner } from '../src/core/task-runner';
import type { ProgressEvent } from '../src/core/types';

function makeSource(over: Partial<any> = {}) {
  return {
    validate: vi.fn(),
    download: vi.fn(async (_url: string, onP: (p: number, m: string) => void) => {
      onP(50, 'half'); onP(100, 'done');
      return { filePath: '/tmp/Song.mp3', title: 'Song' };
    }),
    ...over,
  };
}
function makeUploader(over: Partial<any> = {}) {
  return {
    upload: vi.fn(async (_p: string, onP: (p: number, m: string) => void) => { onP(100, 'up'); }),
    ...over,
  };
}

async function flush() { await new Promise((r) => setTimeout(r, 0)); }

describe('TaskRunner', () => {
  it('runs stages in order and cleans up', async () => {
    const rm = vi.fn(async () => {});
    const runner = new TaskRunner(makeSource() as any, makeUploader() as any, { rm, idGen: () => 't1' });
    const events: ProgressEvent[] = [];
    runner.start('http://v', (e) => events.push(e));
    await flush(); await flush(); await flush();
    const stages = events.map((e) => e.stage);
    expect(stages).toContain('downloading');
    expect(stages).toContain('uploading');
    expect(stages).toContain('cleaning');
    expect(events.at(-1)!.stage).toBe('done');
    expect(events.at(-1)!.status).toBe('success');
    expect(rm).toHaveBeenCalledWith('/tmp/Song.mp3');
  });

  it('rejects concurrent start with busy', () => {
    const runner = new TaskRunner(makeSource() as any, makeUploader({ upload: vi.fn(() => new Promise(() => {})) }) as any, { idGen: () => 't1' });
    runner.start('http://v', () => {});
    expect(() => runner.start('http://v2', () => {})).toThrow('busy');
    expect(runner.isBusy()).toBe(true);
  });

  it('emits failed and cleans up on download error', async () => {
    const rm = vi.fn(async () => {});
    const badSource = makeSource({ download: vi.fn(async () => { throw new Error('boom'); }) });
    const runner = new TaskRunner(badSource as any, makeUploader() as any, { rm, idGen: () => 't1' });
    const events: ProgressEvent[] = [];
    runner.start('http://v', (e) => events.push(e));
    await flush(); await flush();
    expect(events.at(-1)!.status).toBe('failed');
    expect(events.at(-1)!.stage).toBe('error');
  });

  it('cleans up temp file when upload fails', async () => {
    const rm = vi.fn(async () => {});
    const badUploader = makeUploader({ upload: vi.fn(async () => { throw new Error('upload boom'); }) });
    const runner = new TaskRunner(makeSource() as any, badUploader as any, { rm, idGen: () => 't1' });
    const events: ProgressEvent[] = [];
    runner.start('http://v', (e) => events.push(e));
    await flush(); await flush(); await flush();
    expect(events.at(-1)!.status).toBe('failed');
    expect(events.at(-1)!.stage).toBe('error');
    expect(rm).toHaveBeenCalledWith('/tmp/Song.mp3');
  });
});
