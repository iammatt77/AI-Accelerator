import { PageTransition } from "@/components/PageTransition";

// Top-szintű (nem-projekt) oldalak tartalmi kerete: a globális sidebar
// mellett egyetlen main-oszlop. A projekt-útvonalak saját layoutja a
// kontextuális második nav-oszlopot is rendereli (Master ◆ SIDEBAR).
// A tartalom oldalváltáskor beúszik (PageTransition; a globális sidebar áll).
export default function TopLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-w-0 flex-1">
      <div className="mx-auto max-w-[1360px] px-6 py-7">
        <PageTransition initialMotion="page-in">{children}</PageTransition>
      </div>
    </main>
  );
}
