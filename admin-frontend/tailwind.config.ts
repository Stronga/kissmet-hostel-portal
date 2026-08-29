import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        primary: "var(--color-primary)",
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
      },
      spacing: {
        token: "var(--spacing)"
      }
    }
  },
  plugins: []
} satisfies Config;
