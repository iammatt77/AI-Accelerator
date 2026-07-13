import type { FieldState } from "@/lib/artifacts/config";

// Törvény 4: mező-állapot = ikon + szöveg, sosem csak szín.
// confirmed zöld pipa · ai_filled borostyán „AI-javaslat" · manual semleges
// „kézi" · missing halk „hiányzik" (C melléklet).

const STATE_STYLE: Record<FieldState, string> = {
  confirmed: "border-done/40 text-done",
  ai_filled: "border-gate/50 text-gate",
  manual: "border-line text-ink-secondary",
  missing: "border-line text-ink-tertiary",
};

function StateIcon({ state }: { state: FieldState }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (state) {
    case "confirmed":
      // pipa — ember erősítette meg
      return (
        <svg {...common}>
          <path d="M2.5 8.5l3.5 3.5 7-8" />
        </svg>
      );
    case "ai_filled":
      // szikra — AI-javaslat, megerősítésre vár
      return (
        <svg {...common}>
          <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l2 2M9.8 9.8l2 2M11.8 4.2l-2 2M6.2 9.8l-2 2" />
        </svg>
      );
    case "manual":
      // toll — kézzel írt
      return (
        <svg {...common}>
          <path d="M11.5 2.5l2 2L5 13l-2.7.7L3 11l8.5-8.5z" />
        </svg>
      );
    case "missing":
      // szaggatott kör — nincs érték
      return (
        <svg {...common} strokeDasharray="2.5 2.5">
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      );
  }
}

export function FieldStateBadge({
  state,
  label,
}: {
  state: FieldState;
  label: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill border bg-surface px-2 py-0.5 text-mono-sm font-sans ${STATE_STYLE[state]}`}
    >
      <StateIcon state={state} />
      {label}
    </span>
  );
}
