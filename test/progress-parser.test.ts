import { describe, it, expect } from 'vitest';
import { parseYtDlpProgress, parseBaiduProgress, classifyYtDlpValidate, parseBaiduList } from '../src/core/progress-parser';

describe('parseYtDlpProgress', () => {
  it('parses a download percent line', () => {
    expect(parseYtDlpProgress('[download]  42.3% of 5.00MiB at 1.00MiB/s')).toBeCloseTo(42.3);
  });
  it('returns null for non-progress lines', () => {
    expect(parseYtDlpProgress('[info] Writing metadata')).toBeNull();
  });
});

describe('parseBaiduProgress', () => {
  it('parses a percent from baidupcs-go output', () => {
    expect(parseBaiduProgress('↑ 12.34% 1.2MB/2.4MB 500KB/s in 2s')).toBeCloseTo(12.34);
  });
  it('returns null when no percent present', () => {
    expect(parseBaiduProgress('preparing upload')).toBeNull();
  });
});

describe('parseBaiduList', () => {
  const sample = `当前目录: /我的音频
----
  #    文件大小         修改日期               文件(目录)         
  0      323.29KB  2026-09-02 15:54:23  Me at the zoo.mp3         
  19           -  2025-05-29 00:59:28  游戏/
     总: 323.29KB                       文件总数: 1, 目录总数: 0  
----`;

  it('parses a file row and a dir row', () => {
    const files = parseBaiduList(sample);
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ name: 'Me at the zoo.mp3', size: '323.29KB', date: '2026-09-02 15:54:23', isDir: false });
    expect(files[1]).toEqual({ name: '游戏', size: '-', date: '2025-05-29 00:59:28', isDir: true });
  });

  it('returns [] on param error output', () => {
    expect(parseBaiduList('param error')).toEqual([]);
  });

  it('returns [] on empty input', () => {
    expect(parseBaiduList('')).toEqual([]);
  });
});

describe('classifyYtDlpValidate', () => {
  it('supported when exit 0', () => {
    expect(classifyYtDlpValidate('{"title":"x"}', 0)).toEqual({ supported: true });
  });
  it('unsupported site reason', () => {
    const r = classifyYtDlpValidate('ERROR: Unsupported URL: http://x', 1);
    expect(r.supported).toBe(false);
    expect(r.reason).toContain('Unsupported');
  });
});
