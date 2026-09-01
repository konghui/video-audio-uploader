import { describe, it, expect } from 'vitest';
import { loadConfig, checkBinaries } from '../src/core/config';

const good = `
server: { port: 8080, sessionSecret: s }
auth: { username: admin, password: p }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: BaiduPCS-Go, bduss: b, targetDir: /a } }
`;

describe('loadConfig', () => {
  it('parses a valid config', () => {
    const c = loadConfig(good);
    expect(c.server.port).toBe(8080);
    expect(c.cloud.baidu.targetDir).toBe('/a');
  });
  it('throws when a required field is missing', () => {
    expect(() => loadConfig('server: { port: 8080 }')).toThrow();
  });
});

describe('checkBinaries', () => {
  it('reports missing binaries', () => {
    const c = loadConfig(good);
    const missing = checkBinaries(c, (b) => b === 'yt-dlp');
    expect(missing).toContain('ffmpeg');
    expect(missing).toContain('BaiduPCS-Go');
    expect(missing).not.toContain('yt-dlp');
  });
});
