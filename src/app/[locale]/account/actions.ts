"use server";

import { z } from "zod";
import { routing, type Locale } from "@/i18n/routing";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/guest";

const localeSchema = z.enum(routing.locales);

/** Saves the signed-in guest's language (used for their emails). Called by the language switch. */
export async function updateLocaleAction(locale: Locale): Promise<void> {
  const user = await requireUser();
  const parsed = localeSchema.parse(locale);
  await prisma.user.update({ where: { id: user.id }, data: { locale: parsed } });
}
