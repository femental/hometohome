/** The one photo bucket setting, shared by server and browser. */
export function photoBucket(): string {
  return process.env.NEXT_PUBLIC_PHOTO_BUCKET || "photos";
}

/** Public URL of a stored photo. Safe for client components (no Supabase client needed). */
export function photoUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${photoBucket()}/${path}`;
}
