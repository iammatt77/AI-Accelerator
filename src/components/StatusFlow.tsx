import { useTranslations } from "next-intl";
import type { ArtifactStatus } from "@/lib/db/types";

// ─────────────────────────────────────────────────────────────
// Státusz-lánc VIZUÁLIS folyam (v2 editor fejléc): Draft → In review →
// Approved irányított folyamatábraként — a JELENLEGI csomópont dominál
// (tömör kitöltés + árnyék), a múltbeli lépések zöld pipával, a jövőbeli
// lakattal halkak. A tömör kitöltés a v2 terv (locked spec): az aktív
// in_review a --status-gate (#B4801E), az approved a --status-done (#3E9E6E)
// tömör tónusa fehér szöveggel. A tényleges akciók a szerkesztő láblécében.
// ─────────────────────────────────────────────────────────────

const ORDER: ArtifactStatus[] = ["draft", "in_review", "approved"];

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 6.5 L5 9 L9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="6" r="2.6" fill="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="5.5" width="7" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 5.5 V4 a2 2 0 0 1 4 0 V5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function StatusFlow({ status }: { status: ArtifactStatus }) {
  const t = useTranslations("artifacts");
  const idx = ORDER.indexOf(status);

  return (
    <div className="flex items-center">
      {ORDER.map((step, i) => {
        const done = i < idx;
        const active = i === idx;
        const future = i > idx;

        // Tömör aktív csomópont (v2): in_review = gate-tónus, approved = done-tónus,
        // draft = semleges tömör „itt vagy" jelölés.
        let cls: string;
        let icon: React.ReactNode;
        if (active && status === "approved") {
          cls = "border-done bg-done text-white shadow-tile-sm";
          icon = <CheckIcon />;
        } else if (active && status === "in_review") {
          cls = "border-gate bg-gate text-white shadow-tile-sm";
          icon = <DotIcon />;
        } else if (active) {
          // draft aktív
          cls = "border-ink-secondary bg-ink-secondary text-white shadow-tile-sm";
          icon = <DotIcon />;
        } else if (done) {
          cls = "border-done/40 bg-tint-done text-done";
          icon = <CheckIcon />;
        } else {
          // jövőbeli — halk, lakat
          cls = "border-line bg-neutral-150 text-ink-tertiary";
          icon = <LockIcon />;
        }

        // Csatlakozó rúd: zöld, ha a KÖVETKEZŐ csomópont már elért (done/active);
        // szürke, ha jövőbeli.
        const connectorReached = i < idx;

        return (
          <div key={step} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden
                className={`h-[1.5px] w-3.5 ${connectorReached ? "bg-done" : "bg-neutral-300"}`}
              />
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-mono-sm ${active ? "font-bold" : "font-semibold"} ${cls}`}
              aria-current={active ? "step" : undefined}
            >
              {icon}
              {t(`status.${step}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
