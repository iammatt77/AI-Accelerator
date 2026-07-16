import { PageSkeleton } from "@/components/Skeletons";

// Ügyfél-lap betöltés-váza (AICON Oldalváltás §4c). A drill-in azonnal belép
// (PageTransition push-in), a lassú lekérés helyén skeleton-shimmer.
export default function Loading() {
  return <PageSkeleton rows={4} />;
}
