import type { ArtifactStatus } from "@/lib/db/types";

// Törvény 4: státusz = ikon + szöveg, sosem csak szín.
// Az artefaktum-státuszok feliratai mindkét UI-nyelven angolul maradnak
// (terminus technicus) — a label mégis paraméter, hogy a hívó a
// messages-fájlból adhassa (mindkét locale ugyanazt az értéket hordozza).

type PillVariant = ArtifactStatus | "locked";

const VARIANT_STYLE: Record<PillVariant, string> = {
  draft: "border-active/40 text-active",
  in_review: "border-pivot/40 text-pivot",
  approved: "border-done/40 text-done",
  locked: "border-locked/40 text-locked",
};

function PillIcon({ variant }: { variant: PillVariant }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (variant) {
    case "draft":
      // toll — készülő munka
      return (
        <svg {...common}>
          <path d="M11.5 2.5l2 2L5 13l-2.7.7L3 11l8.5-8.5z" />
        </svg>
      );
    case "in_review":
      // szem — áttekintés alatt
      return (
        <svg {...common}>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "approved":
      // pipa — jóváhagyva
      return (
        <svg {...common}>
          <path d="M2.5 8.5l3.5 3.5 7-8" />
        </svg>
      );
    case "locked":
      // lakat — zárt elem (törvény 7)
      return (
        <svg {...common}>
          <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
      );
  }
}

export function StatusPill({
  variant,
  label,
  title,
}: {
  variant: PillVariant;
  label: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-pill border bg-surface px-2 py-0.5 text-mono-sm font-sans ${VARIANT_STYLE[variant]}`}
    >
      <PillIcon variant={variant} />
      {label}
    </span>
  );
}
