import { describe, it, expect } from 'vitest';
import { SessionStore, verifyLogin } from '../src/server/auth';
import { loadConfig } from '../src/core/config';

const cfg = loadConfig(`
server: { port: 1, sessionSecret: s }
auth: { username: admin, password: secret }
paths: { tempDir: /tmp, ytdlp: yt-dlp, ffmpeg: ffmpeg }
audio: { format: mp3, quality: "0" }
cloud: { provider: baidu, baidu: { binary: b, bduss: x, targetDir: /a } }
`);

describe('verifyLogin', () => {
  it('accepts correct credentials', () => {
    expect(verifyLogin(cfg, 'admin', 'secret')).toBe(true);
  });
  it('rejects wrong credentials', () => {
    expect(verifyLogin(cfg, 'admin', 'nope')).toBe(false);
  });
});

describe('SessionStore', () => {
  it('creates and validates tokens', () => {
    const s = new SessionStore();
    const t = s.create();
    expect(s.has(t)).toBe(true);
    s.delete(t);
    expect(s.has(t)).toBe(false);
  });
});
