import { type Theme, themeFor } from "@lukas/ui";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

const ThemeContext = createContext<Theme>(themeFor("light"));

/** Sigue el modo claro u oscuro del sistema. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => themeFor(scheme === "dark" ? "dark" : "light"), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);
