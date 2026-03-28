import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import App from "./App";
import { I18nProvider } from "./lib/i18n";
import { SettingsProvider } from "./lib/settings";
import "./styles/tailwind.css";
import "./styles/global.css";

const theme = createTheme({
  palette: {
    primary: {
      light: "#5f86ad",
      main: "#274c77",
      dark: "#17324d",
      contrastText: "#ffffff"
    },
    secondary: {
      light: "#a6b4c3",
      main: "#64748b",
      dark: "#334155",
      contrastText: "#ffffff"
    },
    success: {
      light: "#6d908c",
      main: "#3c6e71",
      dark: "#274b4d",
      contrastText: "#ffffff"
    },
    warning: {
      light: "#ddbf8a",
      main: "#c79b5d",
      dark: "#9a7443",
      contrastText: "#1f2937"
    },
    error: {
      light: "#d08d80",
      main: "#b76857",
      dark: "#8f4f42",
      contrastText: "#ffffff"
    },
    info: {
      light: "#7d98b4",
      main: "#3f6b92",
      dark: "#27425c",
      contrastText: "#ffffff"
    },
    background: {
      default: "#f6f8fb",
      paper: "#ffffff"
    },
    text: {
      primary: "#1f2937",
      secondary: "#64748b"
    },
    divider: "#d7dee7"
  },
  shape: {
    borderRadius: 14
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700,
          borderRadius: 999
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700
        }
      }
    }
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SettingsProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </SettingsProvider>
    </ThemeProvider>
  </React.StrictMode>
);
