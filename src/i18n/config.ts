// i18n alapkonfiguráció — routing NÉLKÜL (nincs /hu /en prefix).
// A locale cookie-ban él; default: hu.

export const locales = ["hu", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "hu";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
