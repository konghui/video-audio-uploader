export function parseYtDlpProgress(line: string): number | null {
  const m = line.match(/\[download\]\s+([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

export function parseBaiduProgress(line: string): number | null {
  const m = line.match(/([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

import type { CloudFile } from './types.js';

// Parse `BaiduPCS-Go ls <dir>` output into a list of files/dirs. A data row is
// an index int, a size token (e.g. 323.29KB or '-' for a directory), a
// timestamp, then the name (which may contain spaces; dirs end with '/').
// Header / `----` / `当前目录` / `总:` lines are ignored.
export function parseBaiduList(stdout: string): CloudFile[] {
  const out: CloudFile[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*\d+\s+(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+?)\s*$/);
    if (!m) continue;
    const size = m[1];
    const date = m[2];
    let name = m[3];
    const isDir = size === '-' || name.endsWith('/');
    if (name.endsWith('/')) name = name.slice(0, -1);
    out.push({ name, size, date, isDir });
  }
  return out;
}

export function classifyYtDlpValidate(
  stdout: string,
  exitCode: number,
): { supported: boolean; reason?: string } {
  if (exitCode === 0) return { supported: true };
  const err = stdout.match(/ERROR:\s*(.+)/);
  return { supported: false, reason: err ? err[1].trim() : 'validation failed' };
}
