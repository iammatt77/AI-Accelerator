import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

// Placeholder-szakasz üres-állapota (Master lapos-tömör nyelv): fehér
// surface-shell kártya, egy árnyék-token, accent-fill ikon-kör + „hamarosan"
// cím + magyarázat. Törvény 7 szellemében csendes — nincs funkció.
export async function ComingSoon({
  sectionKey,
  icon,
}: {
  sectionKey: "inbox" | "library" | "settings";
  icon: ReactNode;
}) {
  const [tNav, tEmpty] = await Promise.all([
    getTranslations("nav"),
    getTranslations("empty"),
  ]);

  return (
    <div>
      <h1 className="text-title">{tNav(sectionKey)}</h1>
      <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3.5 rounded-shell border border-line bg-surface p-12 text-center shadow-card">
        <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-accent-fill text-action-deep">
          {icon}
        </span>
        <h2 className="text-[15px] font-bold tracking-tight">{tEmpty("comingSoon")}</h2>
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          {tEmpty("comingSoonBody")}
        </p>
      </div>
    </div>
  );
}
