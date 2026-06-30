import type { S3Client } from "bun";
import { mkdir, unlink, readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

// `bun` is a runtime builtin (the server runs under Bun), not a bundle-time
// module — a value import makes the Node-based bundler warn and externalize it.
// Import the type only and read the constructor off the global at call time.
function s3ClientCtor(): typeof S3Client {
  const bun = (globalThis as { Bun?: { S3Client?: typeof S3Client } }).Bun;
  if (!bun?.S3Client) {
    throw new Error("S3 object storage requires the Bun runtime; unset S3_* to use local storage.");
  }
  return bun.S3Client;
}

/**
 * Storage backend for uploaded document originals. Two implementations:
 *  - S3Store: any S3-compatible object store (garage, MinIO, AWS) — durable
 *    across container replacement. Used when S3_* env vars are set.
 *  - LocalStore: writes under ./uploads — the zero-config dev/test fallback.
 *
 * Documents persist the opaque `key` (not an absolute path) as `storagePath`;
 * the store resolves it against whichever backend is active.
 */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const DEFAULT_UPLOADS_DIR = resolve("./uploads");

export class LocalStore implements ObjectStore {
  constructor(private baseDir: string = DEFAULT_UPLOADS_DIR) {}

  private path(key: string): string {
    // Back-compat: legacy rows stored an absolute path rather than a key.
    if (key.startsWith("/")) return key;
    return join(this.baseDir, key);
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await Bun.write(p, bytes);
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => {});
  }
}

export class S3Store implements ObjectStore {
  constructor(private client: S3Client) {}

  async put(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
    await this.client.write(key, bytes, contentType ? { type: contentType } : undefined);
  }

  async read(key: string): Promise<Uint8Array> {
    return await this.client.file(key).bytes();
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }
}

/** Build the configured store. S3 when S3_BUCKET + credentials are set, else local. */
export function makeObjectStore(env: Record<string, string | undefined> = process.env): ObjectStore {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    const Ctor = s3ClientCtor();
    return new S3Store(
      new Ctor({
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION ?? "us-east-1",
      }),
    );
  }
  return new LocalStore();
}

let cached: ObjectStore | null = null;
/** Process-wide store, memoised. */
export function getObjectStore(): ObjectStore {
  return (cached ??= makeObjectStore());
}
