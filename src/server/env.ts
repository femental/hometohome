import "server-only";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_URL: z.string().url(),
  ADMIN_EMAILS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  EMAIL_FROM: z.string().min(1),
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  KAKAO_REST_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  PHOTO_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1).default("photos")),
});

export type ServerEnv = z.output<typeof schema>;

/** Pure validator (testable): throws an Error naming every invalid key. */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${detail}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
