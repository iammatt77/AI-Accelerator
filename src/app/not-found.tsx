import Link from "next/link";
import { getTranslations } from "next-intl/server";

// Lokalizált 404 — a notFound() (pl. érvénytelen projekt-id) ide fut be,
// a Next alapértelmezett angol oldala helyett.
export default async function NotFound() {
  const [tErrors, tCommon] = await Promise.all([
    getTranslations("errors"),
    getTranslations("common"),
  ]);

  return (
    <div className="glass-tile mx-auto mt-16 max-w-md p-8 text-center">
      <p className="font-mono text-metric">404</p>
      <h1 className="mt-2 text-title">{tErrors("notFoundTitle")}</h1>
      <p className="mt-2 text-body text-ink-secondary">{tErrors("notFoundBody")}</p>
      <Link
        href="/projects"
        className="mt-6 inline-flex items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-body font-medium shadow-tile-sm transition-colors duration-[var(--motion-base)] hover:bg-sunken"
      >
        {tCommon("backHome")}
      </Link>
    </div>
  );
}
