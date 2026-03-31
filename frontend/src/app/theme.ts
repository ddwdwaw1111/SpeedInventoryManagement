import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
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
