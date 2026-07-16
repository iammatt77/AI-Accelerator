import { getTranslations } from "next-intl/server";

// Skeleton-villódzás (AICON Oldalváltás-spec, §4c): a navigáció SOHA nem vár a
// fetch-re — a route azonnal vált (PageTransition push-in), a lassú adat helyén
// pedig skeleton-shimmer jelzi, hogy tölt. A négy mező 0/0.1/0.2/0.3 s
// késleltetéssel villog, hogy ne egyszerre. A valós tartalom a szerver-render
// megérkeztével lép a helyére (a route saját aiconPageIn-jével).

export function SkeletonGrid({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-tile border border-line bg-surface p-3.5">
          <div
            className="skeleton-bar h-2 w-[52%]"
            style={{ animationDelay: `${(i % 4) * 0.1}s` }}
          />
          <div
            className="skeleton-bar mt-2.5 h-3.5 w-[80%]"
            style={{ animationDelay: `${(i % 4) * 0.1}s` }}
          />
        </div>
      ))}
    </div>
  );
}

/** Teljes-szegmens skeleton (loading.tsx): fejléc-váz + „betöltés" + mező-rács. */
export async function PageSkeleton({ rows = 4 }: { rows?: number }) {
  const t = await getTranslations("common");
  return (
    <div className="space-y-5">
      {/* fejléc-váz */}
      <div className="flex items-center gap-3.5">
        <div className="skeleton-bar h-[46px] w-[46px] rounded-[10px]" />
        <div className="flex-1 space-y-2">
          <div className="skeleton-bar h-4 w-[42%]" />
          <div className="skeleton-bar h-2.5 w-[28%]" style={{ animationDelay: "0.1s" }} />
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold text-action-deep">
          <span className="anim-breathe h-1.5 w-1.5 rounded-full bg-action" />
          {t("loading")}
        </span>
      </div>
      <SkeletonGrid rows={rows} />
    </div>
  );
}
