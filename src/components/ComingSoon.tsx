import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

// Placeholder-szakasz üres-állapota (design 1c minta): süllyesztett kártya,
// halk ikon + „hamarosan" cím + magyarázat. Törvény 7 szellemében csendes.
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
      <div className="card-sunken mx-auto mt-16 max-w-md p-10 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-pill border border-line bg-surface text-ink-tertiary">
          {icon}
        </div>
        <h2 className="mt-4 text-body font-semibold text-ink-secondary">
          {tEmpty("comingSoon")}
        </h2>
        <p className="mt-1 text-body text-ink-tertiary">{tEmpty("comingSoonBody")}</p>
      </div>
    </div>
  );
}
