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
// Stílus: süllyesztett sáv + tömör aktív szegmens — lila NINCS (törvény 3:
// a nyelvváltás nem döntési pont); a feliratok ink/secondary szintűek
// (törvény 1: tertiary csak meta-szövegre).
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("settings");
  const [isPending, startTransition] = useTransition();

  const localeName: Record<Locale, string> = {
    hu: t("hungarian"),
    en: t("english"),
  };

  return (
    <div
      role="group"
      aria-label={t("language")}
      className="inline-flex items-center rounded-pill border border-line bg-sunken p-0.5"
    >
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
            className={`rounded-pill px-2.5 py-1 text-mono-sm font-medium transition-colors duration-[var(--motion-fast)] disabled:cursor-default ${
              active
                ? "bg-surface text-ink shadow-tile-sm"
                : "text-ink-secondary hover:text-ink"
            } ${isPending ? "opacity-50" : ""}`}
          >
            {LOCALE_LABEL[value]}
          </button>
        );
      })}
    </div>
  );
}
