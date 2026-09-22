import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        // Full desktop chrome (sidebar + 4-col summary) starts at ~1200px
        // so 1024–1199 never squeezes desktop layout into a tiny content column.
        xl: "1200px"
      },
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        primary: "var(--color-primary)",
        accent: "var(--color-accent)",
        muted: "var(--color-muted)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)"
      },
      borderRadius: {
        token: "var(--radius)"
      },
      boxShadow: {
        token: "var(--shadow)"
      }
    }
  },
  plugins: []
} satisfies Config;
