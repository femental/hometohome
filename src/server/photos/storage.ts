import type { SupabaseClient } from "@supabase/supabase-js";

export interface PhotoStorage {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  publicUrl(path: string): string;
}

/** In-memory storage for tests. */
export class MemoryPhotoStorage implements PhotoStorage {
  files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(path: string, bytes: Uint8Array, contentType: string) {
    this.files.set(path, { bytes, contentType });
  }

  async remove(paths: string[]) {
    for (const p of paths) this.files.delete(p);
  }

  publicUrl(path: string) {
    return `memory://${path}`;
  }
}

const isBucketMissing = (error: { message?: string; statusCode?: string | number }) =>
  /bucket not found/i.test(error.message ?? "") || String(error.statusCode) === "404";

export class SupabasePhotoStorage implements PhotoStorage {
  private bucketEnsured = false;

  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  private upload(path: string, bytes: Uint8Array, contentType: string) {
    return this.client.storage
      .from(this.bucket)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
  }

  async put(path: string, bytes: Uint8Array, contentType: string) {
    let { error } = await this.upload(path, bytes, contentType);
    if (error && !this.bucketEnsured && isBucketMissing(error)) {
      // First upload against a fresh project: create the public bucket once, then retry.
      this.bucketEnsured = true;
      const created = await this.client.storage.createBucket(this.bucket, { public: true });
      if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
      ({ error } = await this.upload(path, bytes, contentType));
    }
    if (error) throw error;
  }

  async remove(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(paths);
    if (error) throw error;
  }

  publicUrl(path: string) {
    return this.client.storage.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }
}
