import { useTranslations } from "next-intl";
import type { ArtifactStatus } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Státusz-lánc VIZUÁLIS folyam (Redesign #1, editor fejléc): Draft →
// In review → Approved három pillként, valós állapotjelöléssel (a lánc a
// design 1a/1b szerint a fejlécben ül). A tényleges akciók a StatusChain-
// ben élnek (footer) — ez csak a jelenlegi pozíció megjelenítése.
// Törvény 4: állapot mindig ikon + szöveg.
// ─────────────────────────────────────────────────────────────

const ORDER: ArtifactStatus[] = ["draft", "in_review", "approved"];

export function StatusFlow({ status }: { status: ArtifactStatus }) {
  const t = useTranslations("artifacts");
  const idx = ORDER.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {ORDER.map((step, i) => {
        const done = i < idx;
        const active = i === idx;
        // Törvény 1: a törzs-kontraszt megtartásáért az „approved" aktív pill
        // NEM fehér-a-zöldön (≈3,3:1 bukna), hanem sötétzöld a halvány zöld
        // fátylon (magas kontraszt); a jelenlegi lépést a gyűrű + félkövér +
        // aria-current különíti el a múltbeli zöld lépésektől. Nincs hardcode
        // hex és nincs nem-létező bg-status-done utility.
        const approvedActive = active && status === "approved";
        const cls = approvedActive
          ? "border-done bg-tint-done text-done font-semibold ring-1 ring-done/40"
          : done
            ? "border-done/40 bg-tint-done text-done"
            : active
              ? status === "in_review"
                ? "border-gate/50 bg-tint-gate text-gate font-semibold ring-1 ring-gate/40"
                : "border-line bg-sunken text-ink-secondary font-semibold ring-1 ring-line"
              : "border-line bg-surface text-ink-tertiary";
        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-ink-tertiary">
                →
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-mono-sm font-medium ${cls}`}
              aria-current={active ? "step" : undefined}
            >
              <span aria-hidden>{done || approvedActive ? "✓" : active ? "•" : "○"}</span>
              {t(`status.${step}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
