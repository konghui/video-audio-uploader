export async function post(path: string, body?: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
export async function getCurrent() {
  const res = await fetch('/api/tasks/current');
  return res.json().catch(() => null);
}
