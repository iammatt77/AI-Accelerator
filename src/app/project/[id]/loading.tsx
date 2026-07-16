import { PageSkeleton } from "@/components/Skeletons";

// Projekt-cockpit betöltés-váza (AICON Oldalváltás §4c).
export default function Loading() {
  return <PageSkeleton rows={6} />;
}
