import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Библиотека" },
  { to: "/create", label: "Создать" },
  { to: "/history", label: "История" },
  { to: "/presets", label: "Шаблоны" },
];

export function Layout() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="px-4 py-5 text-sm font-semibold">llm-keartin</div>
        <nav className="flex flex-col gap-1 px-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm",
                  isActive ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
