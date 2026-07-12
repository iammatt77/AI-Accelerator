"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  className?: string;
}

// Kliens-komponens: a szerver-action függőben lévő állapotát jelzi.
// Semmilyen titkot / LLM-hívást nem tartalmaz.
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-[var(--accent)] text-white hover:opacity-90"
      : "border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--background)]";

  return (
    <button type="submit" disabled={pending} className={`${base} ${styles} ${className}`}>
      {pending ? (pendingLabel ?? "Feldolgozás…") : children}
    </button>
  );
}
