"use server";

import { redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServerClient } from "@/server/auth/supabase";

/**
 * Signs out. Guest pages post a `locale` field and land on that locale's home; the admin posts none
 * and lands on the (Korean) login page.
 */
export async function signOut(formData?: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const locale = routing.locales.find((l) => l === formData?.get("locale"));
  redirect(locale ? `/${locale}` : "/ko/login");
}
