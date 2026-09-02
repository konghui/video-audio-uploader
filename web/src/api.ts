export async function post(path: string, body?: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
export async function getCurrent() {
  const res = await fetch('/api/tasks/current');
  return res.json().catch(() => null);
}
export async function getFormats() {
  const res = await fetch('/api/formats');
  return res.json().catch(() => null);
}
export async function getCloudFiles() {
  const res = await fetch('/api/cloud/files');
  return res.json().catch(() => ({ targetDir: '', files: [] }));
}
export async function deleteCloudFile(name: string) {
  return post('/api/cloud/delete', { name });
}
