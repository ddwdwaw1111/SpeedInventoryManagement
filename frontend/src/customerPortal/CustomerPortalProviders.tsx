import type { ReactNode } from "react";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";

import { appTheme } from "../app/theme";
import { I18nProvider } from "../lib/i18n";

export function CustomerPortalProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <I18nProvider>
        {children}
      </I18nProvider>
    </ThemeProvider>
  );
}
