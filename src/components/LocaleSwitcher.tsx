"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/i18n/locale-actions";
import { locales, type Locale } from "@/i18n/config";

const LOCALE_LABEL: Record<Locale, string> = {
  hu: "HU",
  en: "EN",
};

// Kompakt HU | EN pill az oldalsáv alján. Server action állítja a cookie-t,
// a fa újrarenderel; a választás reload után is él.
// Stílus (Master ◆ SIDEBAR): aktív = tömör lila, inaktív = keretezett halk.
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("settings");
  const [isPending, startTransition] = useTransition();

  const localeName: Record<Locale, string> = {
    hu: t("hungarian"),
    en: t("english"),
  };

  return (
    <div role="group" aria-label={t("language")} className="inline-flex items-center gap-1.5">
      {locales.map((value) => {
        const active = value === locale;
        return (
          <button
            key={value}
            type="button"
            disabled={isPending || active}
            aria-pressed={active}
            title={localeName[value]}
            onClick={() =>
              startTransition(async () => {
                await setLocale(value);
              })
            }
            className={`rounded-3 px-1.5 py-px font-mono text-[10.5px] transition-colors duration-[var(--motion-fast)] disabled:cursor-default ${
              active
                ? "bg-action text-white"
                : "border border-neutral-350 bg-surface text-ink-tertiary hover:text-ink-secondary"
            } ${isPending ? "opacity-50" : ""}`}
          >
            {LOCALE_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}
