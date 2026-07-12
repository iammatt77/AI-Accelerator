"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}

// Kliens-komponens: a szerver-action függőben lévő állapotát jelzi.
// Variánsok a token-rétegből: primary (lila — csak döntési pontokon,
// törvény 3), secondary (tömör felület), ghost (csendes). Tiltott állapot:
// halványítás + tiltott kurzor.
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  const base =
    "inline-flex items-center justify-center rounded-control px-4 py-2 text-body font-medium transition-all duration-[var(--motion-base)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none";
  const styles: Record<NonNullable<SubmitButtonProps["variant"]>, string> = {
    primary:
      "bg-action text-white shadow-action hover:bg-action-hover hover:shadow-action-hover",
    secondary:
      "border border-line bg-surface text-ink shadow-tile-sm hover:bg-sunken",
    ghost: "text-ink-secondary hover:bg-sunken hover:text-ink",
  };

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${base} ${styles[variant]} ${className}`}
    >
      {pending ? (pendingLabel ?? "Feldolgozás…") : children}
    </button>
  );
}
