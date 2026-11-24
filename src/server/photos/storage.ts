import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoredFile {
  path: string;
  createdAt: Date;
}

export interface PhotoStorage {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  publicUrl(path: string): string;
  /** A one-time URL + token the browser uploads `path` to directly (no server body size limit). */
  signedUpload(path: string): Promise<{ signedUrl: string; token: string }>;
  /** The object's bytes, or null when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Files directly under `prefix` (e.g. `rooms/<id>`). */
  list(prefix: string): Promise<StoredFile[]>;
  /** The owner folders under `root` (`houses` / `rooms`). */
  listFolders(root: string): Promise<string[]>;
}

/** In-memory storage for tests. */
export class MemoryPhotoStorage implements PhotoStorage {
  files = new Map<string, { bytes: Uint8Array; contentType: string; createdAt: Date }>();
  signed: string[] = [];

  async put(path: string, bytes: Uint8Array, contentType: string, createdAt = new Date()) {
    this.files.set(path, { bytes, contentType, createdAt });
  }

  async remove(paths: string[]) {
    for (const p of paths) this.files.delete(p);
  }

  publicUrl(path: string) {
    return `memory://${path}`;
  }

  async signedUpload(path: string) {
    this.signed.push(path);
    return { signedUrl: `memory://upload/${path}`, token: `token-${this.signed.length}` };
  }

  async read(path: string) {
    return this.files.get(path)?.bytes ?? null;
  }

  async list(prefix: string) {
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(`${prefix}/`) && !p.slice(prefix.length + 1).includes("/"))
      .map(([path, f]) => ({ path, createdAt: f.createdAt }));
  }

  async listFolders(root: string) {
    const folders = new Set<string>();
    for (const p of this.files.keys()) {
      const parts = p.split("/");
      if (parts[0] === root && parts.length === 3) folders.add(`${root}/${parts[1]}`);
    }
    return [...folders];
  }
}

/**
 * Supabase Storage. The public bucket is created once by `scripts/setup-storage.ts`; a missing
 * bucket at runtime is a deployment error and surfaces as one.
 */
export class SupabasePhotoStorage implements PhotoStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  private get store() {
    return this.client.storage.from(this.bucket);
  }

  async put(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.store.upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw error;
  }

  async remove(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.store.remove(paths);
    if (error) throw error;
  }

  publicUrl(path: string) {
    return this.store.getPublicUrl(path).data.publicUrl;
  }

  async signedUpload(path: string) {
    const { data, error } = await this.store.createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("could not create a signed upload URL");
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async read(path: string) {
    const { data, error } = await this.store.download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async list(prefix: string) {
    const { data, error } = await this.store.list(prefix, { limit: 1000 });
    if (error) throw error;
    return (data ?? [])
      .filter((f) => f.id !== null) // folders have no id
      .map((f) => ({ path: `${prefix}/${f.name}`, createdAt: f.created_at ? new Date(f.created_at) : new Date() }));
  }

  async listFolders(root: string) {
    const { data, error } = await this.store.list(root, { limit: 1000 });
    if (error) throw error;
    return (data ?? []).filter((f) => f.id === null).map((f) => `${root}/${f.name}`);
  }
}
