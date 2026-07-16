"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// ─────────────────────────────────────────────────────────────
// Oldalváltás-animáció (AICON Oldalváltás-spec). A tartalom a route-váltáskor
// ÚJRA-MOUNTOL (key={pathname}) → a CSS be-animáció újrafut. Az irány dönti el a
// keyframe-et:
//   • mélyebbre (drill-in, pl. /clients → /clients/:id) → aiconPushIn (jobbról)
//   • feljebb (vissza, pl. /clients/:id → /clients)      → aiconPushBack (balról)
//   • azonos szint (lateral menüváltás)                  → aiconPageIn (fel-fade)
// Csak transform/opacity/filter animálódik (GPU, 60 fps). A prefers-reduced-
// motion a globals.css-ben null-közeli időre húzza. Az első mountnál az
// `initialMotion` dönt (a projekt-layoutban „push-in", mert oda mindig befelé
// lépünk; a top-layoutban „page-in").
// ─────────────────────────────────────────────────────────────

type Motion = "page-in" | "push-in" | "push-back";

function depthOf(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/** A ce/prev útvonalból az irány. */
function motionFor(prev: string | null, curr: string, initial: Motion): Motion {
  if (prev === null || prev === curr) return initial;
  const dPrev = depthOf(prev);
  const dCurr = depthOf(curr);
  const prevBase = prev === "/" ? "/" : `${prev}/`;
  const currBase = curr === "/" ? "/" : `${curr}/`;
  if (dCurr > dPrev && curr.startsWith(prevBase)) return "push-in"; // beljebb
  if (dCurr < dPrev && prev.startsWith(currBase)) return "push-back"; // feljebb
  return "page-in"; // oldalra (lateral)
}

const CLASS: Record<Motion, string> = {
  "page-in": "anim-page-in",
  "push-in": "anim-push-in",
  "push-back": "anim-push-back",
};

export function PageTransition({
  children,
  initialMotion = "page-in",
}: {
  children: ReactNode;
  initialMotion?: Motion;
}) {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  const motion = motionFor(prev.current, pathname, initialMotion);
  useEffect(() => {
    prev.current = pathname;
  }, [pathname]);

  return (
    <div key={pathname} className={CLASS[motion]}>
      {children}
    </div>
  );
}
