/**
 * Admin tables. A test installs a fake with __setAdminStoreForTests.
 * A query that throws is the caller's problem; login turns it into 503.
 */

import { db, hasDatabase } from '../db.ts';

export interface AdminUserRow {
  id: string;
  passwordHash: string;
}

export interface AdminNote {
  id: string;
  kind: string;
  orderId: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface PendingPrompt {
  id: string;
  orderId: string;
  label: string;
  fieldRef: string | null;
  options: { label: string; value: string; suggested?: boolean }[] | null;
  source: 'agent' | 'admin';
}

export interface AdminStore {
  userByName(username: string): Promise<AdminUserRow | null>;
  failureCount(ip: string, sinceIso: string): Promise<number>;
  recordFailure(ip: string): Promise<void>;
  saveSession(adminId: string, tokenHash: string, expiresAtIso: string): Promise<void>;
  sessionByHash(tokenHash: string): Promise<{ adminId: string } | null>;
  dropSession(tokenHash: string): Promise<void>;
  notifications(): Promise<AdminNote[]>;
  markRead(id: string): Promise<void>;
  openPrompt(input: {
    orderId: string;
    label: string;
    fieldRef: string | null;
    options: unknown;
    source: 'agent' | 'admin';
  }): Promise<'ok' | 'conflict'>;
  pendingPrompt(orderId: string): Promise<PendingPrompt | null>;
  answerPrompt(orderId: string, answer: string): Promise<boolean>;
  notifyOnce(kind: string, orderId: string | null, body: string): Promise<void>;
}

const postgresStore: AdminStore = {
  async userByName(username) {
    if (!hasDatabase()) return null;
    const rows = await db()`select id, password_hash from admin_user where username = ${username} limit 1`;
    const row = rows[0] as { id: string; password_hash: string } | undefined;
    return row ? { id: row.id, passwordHash: row.password_hash } : null;
  },
  async failureCount(ip, sinceIso) {
    if (!hasDatabase()) return 0;
    const rows = await db()`
      select count(*)::int as n from admin_login_failure
       where ip = ${ip} and created_at > ${sinceIso}`;
    return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
  },
  async recordFailure(ip) {
    if (!hasDatabase()) return;
    await db()`insert into admin_login_failure (ip) values (${ip})`;
  },
  async saveSession(adminId, tokenHash, expiresAtIso) {
    await db()`insert into admin_session (admin_id, token_hash, expires_at)
      values (${adminId}, ${tokenHash}, ${expiresAtIso})`;
  },
  async sessionByHash(tokenHash) {
    if (!hasDatabase()) return null;
    const rows = await db()`
      select admin_id from admin_session
       where token_hash = ${tokenHash} and expires_at > now()`;
    const row = rows[0] as { admin_id: string } | undefined;
    return row ? { adminId: row.admin_id } : null;
  },
  async dropSession(tokenHash) {
    if (!hasDatabase()) return;
    await db()`delete from admin_session where token_hash = ${tokenHash}`;
  },
  async notifications() {
    if (!hasDatabase()) return [];
    const rows = await db()`
      select id, kind, order_id, body, created_at, read_at
        from admin_notification
       order by created_at desc
       limit 50`;
    return rows.map((row) => {
      const item = row as {
        id: string;
        kind: string;
        order_id: string | null;
        body: string;
        created_at: Date | string;
        read_at: Date | string | null;
      };
      return {
        id: item.id,
        kind: item.kind,
        orderId: item.order_id,
        body: item.body,
        createdAt: new Date(item.created_at).toISOString(),
        readAt: item.read_at ? new Date(item.read_at).toISOString() : null,
      };
    });
  },
  async markRead(id) {
    await db()`update admin_notification set read_at = now() where id = ${id} and read_at is null`;
  },
  async openPrompt(input) {
    if (!hasDatabase()) return 'conflict';
    const pending = await db()`
      select 1 from checkout_prompt where order_id = ${input.orderId} and status = 'pending'`;
    if (pending.length > 0) return 'conflict';
    await db()`insert into checkout_prompt (order_id, field_ref, label, options, source, status)
      values (${input.orderId}, ${input.fieldRef}, ${input.label}, ${input.options ? db().json(input.options as never) : null}, ${input.source}, 'pending')`;
    return 'ok';
  },
  async pendingPrompt(orderId) {
    if (!hasDatabase()) return null;
    const rows = await db()`
      select id, order_id, label, field_ref, options, source
        from checkout_prompt
       where order_id = ${orderId} and status = 'pending'
       limit 1`;
    const row = rows[0] as
      | {
          id: string;
          order_id: string;
          label: string;
          field_ref: string | null;
          options: PendingPrompt['options'];
          source: 'agent' | 'admin';
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      label: row.label,
      fieldRef: row.field_ref,
      options: row.options,
      source: row.source,
    };
  },
  async answerPrompt(orderId, answer) {
    if (!hasDatabase()) return false;
    const rows = await db()`
      update checkout_prompt
         set answer = ${answer}, status = 'answered', answered_at = now()
       where order_id = ${orderId} and status = 'pending'
      returning id`;
    return rows.length > 0;
  },
  async notifyOnce(kind, orderId, body) {
    if (!hasDatabase()) return;
    const existing = await db()`
      select 1 from admin_notification
       where kind = ${kind}
         and read_at is null
         and order_id is not distinct from ${orderId}
       limit 1`;
    if (existing.length > 0) return;
    await db()`insert into admin_notification (kind, order_id, body) values (${kind}, ${orderId}, ${body})`;
  },
};

let installed: AdminStore | null = null;

export function __setAdminStoreForTests(store: AdminStore | null): void {
  installed = store;
}

export function adminStore(): AdminStore {
  return installed ?? postgresStore;
}
