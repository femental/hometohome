/** Public URL of a stored photo. Safe for client components (no Supabase client needed). */
export function photoUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const bucket = process.env.NEXT_PUBLIC_PHOTO_BUCKET ?? "photos";
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}
