/**
 * 贴吧 Cookie 落盘：AES-256-GCM 密文，接口层只暴露 missing | valid | expired。
 * 密钥来自 COOKIE_ENCRYPTION_KEY（32 字节 hex 或 base64）。没有可用密钥时：
 * 读状态当作 missing；写入由调用方转成 500，这里抛 CookieKeyError。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toIso } from '../../cards/time.js';

export type CookiePublicStatus = 'missing' | 'valid' | 'expired';

export interface CookieStatusView {
  status: CookiePublicStatus;
  updated_at: string | null;
}

export class CookieKeyError extends Error {
  constructor(message = 'COOKIE_ENCRYPTION_KEY is missing or invalid') {
    super(message);
    this.name = 'CookieKeyError';
  }
}

interface CookiePayload {
  status: 'valid' | 'expired';
  updated_at: string;
  /** 只存在于内存和密文里，禁止打日志、禁止放进 HTTP 响应。 */
  header: string;
}

interface CipherEnvelope {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string;
  tag: string;
  ct: string;
}

const KEY_LOG =
  '[tieba-cookie] COOKIE_ENCRYPTION_KEY is missing or not a 32-byte hex/base64 key; cookie write refused';

/** 64 位 hex，或解码后恰好 32 字节的标准 base64 / base64url。其它一律视为没有密钥。 */
export function decodeCookieKey(raw: string | undefined | null): Buffer | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const candidate = normalized + pad;
  if (!/^[A-Za-z0-9+/]+=*$/.test(candidate)) return null;
  const buf = Buffer.from(candidate, 'base64');
  if (buf.length !== 32) return null;
  // Buffer.from 会吞掉非法字符；往返不一致就拒绝，避免把短字符串误当成密钥。
  const recanon = buf.toString('base64').replace(/=+$/, '');
  if (recanon !== candidate.replace(/=+$/, '')) return null;
  return buf;
}

export function resolveTiebaCookieStorePath(): string {
  const override = process.env.TIEBA_COOKIE_STORE?.trim();
  if (override) return path.resolve(override);
  // 本文件在 backend/src/ingest/tieba/，默认密文落在 backend/data/tieba-cookie.enc。
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../data/tieba-cookie.enc',
  );
}

export interface TiebaCookieStoreOptions {
  filePath: string;
  /**
   * undefined：读环境变量 COOKIE_ENCRYPTION_KEY。
   * null 或空串：强制视为未配置（测试隔离，不碰进程环境）。
   */
  encryptionKey?: string | null;
}

export interface TiebaCookieStore {
  status(): Promise<CookieStatusView>;
  save(header: string, now: Date): Promise<void>;
  clear(): Promise<void>;
  markExpired(): Promise<void>;
  /** status===valid 时返回 Cookie 头的值；missing / expired / 无密钥 → null（不附带）。 */
  headerForRequest(): Promise<string | null>;
}

function resolveKey(explicit: string | null | undefined): Buffer | null {
  if (explicit === null) return null;
  const raw = explicit === undefined ? process.env.COOKIE_ENCRYPTION_KEY : explicit;
  return decodeCookieKey(raw ?? null);
}

function encryptPayload(key: Buffer, payload: CookiePayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const envelope: CipherEnvelope = {
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

function decryptPayload(key: Buffer, raw: string): CookiePayload | null {
  let envelope: Partial<CipherEnvelope>;
  try {
    envelope = JSON.parse(raw) as Partial<CipherEnvelope>;
  } catch {
    console.error('[tieba-cookie] cookie store is not valid ciphertext; treating status as missing');
    return null;
  }
  if (envelope.v !== 1 || envelope.alg !== 'AES-256-GCM') {
    console.error('[tieba-cookie] unsupported cookie store version; treating status as missing');
    return null;
  }
  if (
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.ct !== 'string'
  ) {
    console.error('[tieba-cookie] cookie store envelope is incomplete; treating status as missing');
    return null;
  }
  try {
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ct = Buffer.from(envelope.ct, 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const data = JSON.parse(plain) as Partial<CookiePayload>;
    if (
      (data.status !== 'valid' && data.status !== 'expired') ||
      typeof data.updated_at !== 'string' ||
      typeof data.header !== 'string' ||
      data.header === ''
    ) {
      console.error('[tieba-cookie] decrypted cookie payload has unexpected shape');
      return null;
    }
    return { status: data.status, updated_at: data.updated_at, header: data.header };
  } catch {
    // 认证失败或明文损坏。只记原因，不把密文/明文写进日志。
    console.error('[tieba-cookie] failed to decrypt cookie store; treating status as missing');
    return null;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT';
}

export function createTiebaCookieStore(opts: TiebaCookieStoreOptions): TiebaCookieStore {
  const filePath = opts.filePath;

  async function readPayload(key: Buffer): Promise<CookiePayload | null> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (isEnoent(err)) return null;
      console.error('[tieba-cookie] failed to read cookie store; treating status as missing');
      return null;
    }
    return decryptPayload(key, raw);
  }

  async function writePayload(key: Buffer, payload: CookiePayload): Promise<void> {
    const body = encryptPayload(key, payload);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // 先写临时文件再 rename，避免进程中断留下半截密文被当成有效 cookie。
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, filePath);
      await fs.chmod(filePath, 0o600);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  function requireKey(): Buffer {
    const key = resolveKey(opts.encryptionKey);
    if (!key) {
      console.error(KEY_LOG);
      throw new CookieKeyError();
    }
    return key;
  }

  return {
    async status(): Promise<CookieStatusView> {
      // 没密钥时即使磁盘上有旧文件，也对外表现为 missing，避免泄露「曾经配置过」以外的内容。
      const key = resolveKey(opts.encryptionKey);
      if (!key) return { status: 'missing', updated_at: null };
      const payload = await readPayload(key);
      if (!payload) return { status: 'missing', updated_at: null };
      return { status: payload.status, updated_at: payload.updated_at };
    },

    async save(header: string, now: Date): Promise<void> {
      const key = requireKey();
      await writePayload(key, {
        status: 'valid',
        updated_at: toIso(now),
        header,
      });
    },

    async clear(): Promise<void> {
      requireKey();
      try {
        await fs.rm(filePath, { force: true });
      } catch (err) {
        if (isEnoent(err)) return;
        throw err;
      }
    },

    async markExpired(): Promise<void> {
      const key = resolveKey(opts.encryptionKey);
      if (!key) {
        console.error('[tieba-cookie] cannot mark cookie expired without COOKIE_ENCRYPTION_KEY');
        return;
      }
      const payload = await readPayload(key);
      if (!payload || payload.status === 'expired') return;
      payload.status = 'expired';
      // updated_at 保持上次成功写入的时间，状态位单独表示已失效。
      await writePayload(key, payload);
    },

    async headerForRequest(): Promise<string | null> {
      const key = resolveKey(opts.encryptionKey);
      if (!key) return null;
      const payload = await readPayload(key);
      if (!payload || payload.status !== 'valid') return null;
      return payload.header;
    },
  };
}
