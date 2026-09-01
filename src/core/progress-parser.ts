export function parseYtDlpProgress(line: string): number | null {
  const m = line.match(/\[download\]\s+([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

export function parseBaiduProgress(line: string): number | null {
  const m = line.match(/([\d.]+)%/);
  return m ? parseFloat(m[1]) : null;
}

export function classifyYtDlpValidate(
  stdout: string,
  exitCode: number,
): { supported: boolean; reason?: string } {
  if (exitCode === 0) return { supported: true };
  const err = stdout.match(/ERROR:\s*(.+)/);
  return { supported: false, reason: err ? err[1].trim() : 'validation failed' };
}
