"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

// Nyelvváltás: a cookie-t szerveroldalon állítjuk, majd a teljes fa
// újrarenderel — a választás reload után is él (cookie-perzisztencia).
export async function setLocale(value: string): Promise<void> {
  const locale = isLocale(value) ? value : defaultLocale;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
