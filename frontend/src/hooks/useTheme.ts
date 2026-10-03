import { useLayoutEffect, useState } from "react";
import { applyTheme, persistTheme, resolveTheme, storedTheme, systemTheme, type Theme } from "@/lib/theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (storedTheme()) return;
      const next = systemTheme();
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return {
    theme,
    setTheme: (next: Theme) => {
      persistTheme(next);
      setTheme(next);
    },
  };
}
