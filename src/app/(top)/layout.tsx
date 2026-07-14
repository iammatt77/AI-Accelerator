// Top-szintű (nem-projekt) oldalak tartalmi kerete: a globális sidebar
// mellett egyetlen main-oszlop. A projekt-útvonalak saját layoutja a
// kontextuális második nav-oszlopot is rendereli (Master ◆ SIDEBAR).
export default function TopLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-w-0 flex-1">
      <div className="mx-auto max-w-[1360px] px-6 py-7">{children}</div>
    </main>
  );
}
