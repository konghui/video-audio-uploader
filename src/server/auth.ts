import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../core/config.js';

export function verifyLogin(cfg: AppConfig, user: string, pass: string): boolean {
  return user === cfg.auth.username && pass === cfg.auth.password;
}

export class SessionStore {
  private tokens = new Set<string>();
  create(): string {
    const t = randomUUID();
    this.tokens.add(t);
    return t;
  }
  has(token: string): boolean {
    return this.tokens.has(token);
  }
  delete(token: string): void {
    this.tokens.delete(token);
  }
}
