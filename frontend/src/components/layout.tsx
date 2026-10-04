import { Moon, Sun } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const links = [
  { to: "/", label: "Библиотека" },
  { to: "/topics", label: "Темы" },
  { to: "/create", label: "Создать" },
  { to: "/images", label: "Картинки" },
  { to: "/history", label: "История" },
  { to: "/presets", label: "Шаблоны" },
  { to: "/config", label: "Конфигурация" },
];

export function Layout() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";

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
        <div className="mt-auto border-t border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="dark-mode" className="flex cursor-pointer items-center gap-2 font-normal text-muted-foreground">
              {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              Тёмная тема
            </Label>
            <Switch
              id="dark-mode"
              checked={dark}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              aria-label="Тёмная тема"
            />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
