import { describe, it, expect } from 'vitest';
import { parseYtDlpProgress, parseBaiduProgress, classifyYtDlpValidate } from '../src/core/progress-parser';

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
