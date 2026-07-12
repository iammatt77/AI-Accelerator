"use client";

import { useTranslations } from "next-intl";

// Lokalizált hiba-határ: a render-útvonalon vagy sima <form action>-ből
// dobott hibák (pl. DB-hiba a kliens/projekt-létrehozásnál) itt jelennek
// meg olvasható, honosított képernyőként a Next generikus „Application
// error" oldala helyett. (Prod-ban a Next a hibaüzenetet kiszűri — a
// részletek a szerver-logban; a teljes FormState-átállás a parkolóban.)
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  return (
    <div className="glass-tile mx-auto mt-16 max-w-md p-8 text-center">
      <h1 className="text-title text-danger">{t("genericTitle")}</h1>
      <p className="mt-2 text-body text-ink-secondary">{t("genericBody")}</p>
      {error.digest && (
        <p className="mt-2 font-mono text-mono-sm text-ink-tertiary">
          digest: {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex items-center justify-center rounded-control bg-action px-4 py-2 text-body font-medium text-white shadow-action transition-all duration-[var(--motion-base)] hover:bg-action-hover"
      >
        {t("retry")}
      </button>
    </div>
  );
}
