// Inline SVG ikonkészlet (nincs új csomag-függőség).
// Nav-ikonok + fázis-állapot ikonok (a v0.4 lexikon szerint).

import type { PhaseState } from "@/lib/phases/machine";

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

// ── Nav ──────────────────────────────────────────────────────

export function IconDashboard({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

export function IconClients({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.8 13.5c.5-2.5 2.2-3.8 4.2-3.8s3.7 1.3 4.2 3.8" />
      <path d="M10.5 3.4a2.5 2.5 0 0 1 0 4.2M12.4 9.9c1 .6 1.7 1.7 2 3.3" />
    </svg>
  );
}

export function IconProjects({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2h4.5A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7z" />
    </svg>
  );
}

export function IconInbox({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2 9.5l2-6h8l2 6" />
      <path d="M2 9.5h3.5l1 2h3l1-2H14v3A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-3z" />
    </svg>
  );
}

export function IconLibrary({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 2.5h7A2.5 2.5 0 0 1 12.5 5v8.5H5A2 2 0 0 1 3 11.5v-9z" />
      <path d="M3 11.5A2 2 0 0 1 5 9.5h7.5" />
    </svg>
  );
}

export function IconSettings({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" />
    </svg>
  );
}

// ── Fázis-állapot (v0.4 lexikon: MINDIG ikon + szöveg) ──────

export function IconLock({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function IconCircle({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="8" r="4.5" />
    </svg>
  );
}

export function IconSquareDot({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconDiamond({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect
        x="4.6"
        y="4.6"
        width="6.8"
        height="6.8"
        transform="rotate(45 8 8)"
        fill="none"
      />
    </svg>
  );
}

export function IconCheck({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2.5 8.5l3.5 3.5 7-8" />
    </svg>
  );
}

/** Fázis-állapot → ikon (törvény 4: a hívó mellé szöveget is tesz). */
export function PhaseStateIcon({
  state,
  size = 12,
  className,
}: IconProps & { state: PhaseState }) {
  switch (state) {
    case "locked":
      return <IconLock size={size} className={className} />;
    case "open":
      return <IconCircle size={size} className={className} />;
    case "in_progress":
      return <IconSquareDot size={size} className={className} />;
    case "gate_pending":
      return <IconDiamond size={size} className={className} />;
    case "completed":
      return <IconCheck size={size} className={className} />;
  }
}

/** Fázis-állapot → token-színosztály (szöveghez/ikonhoz). */
export const PHASE_STATE_TEXT: Record<PhaseState, string> = {
  locked: "text-locked",
  open: "text-ink-secondary",
  in_progress: "text-active",
  gate_pending: "text-gate",
  completed: "text-done",
};
