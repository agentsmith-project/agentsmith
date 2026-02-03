/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./stories/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // MBOS v1 design system tokens (Google AI Studio-like)
        // All tokens are defined as RGB triplets in globals.css:
        //   --token-name: <r> <g> <b>
        // We use `rgb(var(--token) / <alpha-value>)` to support opacity.
        background: "rgb(var(--bg-base) / <alpha-value>)",
        panel: "rgb(var(--bg-sidebar) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        "surface-high": "rgb(var(--bg-surface-high) / <alpha-value>)",
        hover: "rgb(var(--bg-hover) / <alpha-value>)",

        // Text
        foreground: "rgb(var(--text-strong) / <alpha-value>)", // #FFFFFF
        primary: "rgb(var(--text-primary) / <alpha-value>)", // #D4D4D4
        secondary: "rgb(var(--text-secondary) / <alpha-value>)", // #D4D4D4 (same as primary by default)
        tertiary: "rgb(var(--text-tertiary) / <alpha-value>)", // #8C8C8C
        "icon-default": "rgb(var(--icon-default) / <alpha-value>)", // #C4C6CF

        // Accents & semantics
        accent: "rgb(var(--accent) / <alpha-value>)", // #87A9FF
        success: "rgb(var(--success) / <alpha-value>)", // #3DDB85
        error: "rgb(var(--error) / <alpha-value>)", // #F44336
        warning: "rgb(var(--warning) / <alpha-value>)",

        // Dialog-specific (layered hierarchy)
        dialog: "rgb(var(--bg-dialog) / <alpha-value>)",
        input: "rgb(var(--bg-input) / <alpha-value>)",
        "border-input": "rgb(var(--border-input) / <alpha-value>)",

        // Borders
        border: "rgb(var(--border) / <alpha-value>)",
        subtle: "rgb(var(--border-subtle) / <alpha-value>)",
      },
      borderRadius: {
        sm: "var(--radius-sm)", // 8px
        md: "var(--radius-md)", // 12px
        lg: "var(--radius-lg)", // 16px
      },
      spacing: {
        xs: "var(--spacing-xs)",
        sm: "var(--spacing-sm)",
        md: "var(--spacing-md)",
        lg: "var(--spacing-lg)",
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans SC", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        // Only for floating layers (dropdown/dialog). Keep subtle per design doc.
        float: "0 8px 16px -4px rgba(0,0,0,0.10)",
      },
      ringOffsetColor: {
        dialog: "rgb(var(--bg-dialog))",
      },
    },
  },
  plugins: [],
};
