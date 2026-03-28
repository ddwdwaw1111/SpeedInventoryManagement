/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        ledger: {
          surface: "#f6fafe",
          low: "#f0f4f8",
          lowest: "#ffffff",
          ink: "#171c1f",
          muted: "#687588",
          panel: "#131b2e",
          panelDark: "#000000",
          blue: "#213552",
          pale: "#d5e3fc",
          line: "rgba(198, 198, 205, 0.15)"
        }
      },
      boxShadow: {
        ledger: "0 10px 24px rgba(23, 28, 31, 0.035)",
        modal: "0 20px 40px rgba(23, 28, 31, 0.06)"
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
        headline: ["Manrope", "Inter", "Segoe UI", "sans-serif"],
        body: ["Inter", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
};
