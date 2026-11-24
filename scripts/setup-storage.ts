/**
 * One-time: creates the public photo bucket in a Supabase project (local or production).
 *
 *   npm run setup:storage
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_PHOTO_BUCKET (default
 * "photos") from the environment or `.env.local`. Safe to run again: an existing bucket is kept and
 * its settings are updated.
 */
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: rely on the environment
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.NEXT_PUBLIC_PHOTO_BUCKET || "photos";

const options = {
  public: true,
  fileSizeLimit: 10 * 1024 * 1024, // PHOTO_UPLOAD_MAX_BYTES
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

async function main() {
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const storage = createClient(url, key, { auth: { persistSession: false } }).storage;
  const { data } = await storage.getBucket(bucket);
  const { error } = data ? await storage.updateBucket(bucket, options) : await storage.createBucket(bucket, options);
  if (error) throw error;
  console.log(`${data ? "Updated" : "Created"} public bucket "${bucket}" at ${new URL(url).host}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
