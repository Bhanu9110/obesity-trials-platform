import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import colors from "tailwindcss/colors";

// Two themes from one set of class names.
//   Light (default): Tailwind's normal palettes, white glass cards, cyan + violet accents.
//   Dark ([data-theme="dark"] on <html>): navy surfaces; every colour scale flipped
//   (50 <-> 950 …) so pastel badges become dark tinted badges and text stays readable.
// Every colour is a CSS variable ("r g b"), so opacity modifiers like bg-brand-500/10 work.

type Scale = Record<string, string>;
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const FAMILIES = [
  "emerald", "green", "rose", "red", "amber", "yellow", "orange", "sky", "blue",
  "indigo", "violet", "purple", "teal", "cyan", "fuchsia", "pink", "lime",
] as const;

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const invert = (s: Scale): Scale => Object.fromEntries(STEPS.map((k, i) => [k, s[STEPS[STEPS.length - 1 - i]]]));
const vars = (name: string, s: Scale) => Object.fromEntries(STEPS.map((k) => [`--${name}-${k}`, rgb(s[k])]));
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const fromVars = (name: string): Scale => Object.fromEntries(STEPS.map((k) => [k, v(`${name}-${k}`)]));

// Navy greys for dark mode (low numbers = surfaces, high numbers = text).
const NAVY: Scale = {
  50: "#10182d", 100: "#17213a", 200: "#202c4a", 300: "#2d3c60", 400: "#68779e", 500: "#8694b6",
  600: "#a5b1cd", 700: "#c4cde1", 800: "#dde4f1", 900: "#eef2fa", 950: "#f8fafd",
};
// Brand (cyan) and accent (violet) per theme.
const BRAND_LIGHT = colors.cyan as Scale;
const BRAND_DARK: Scale = {
  50: "#082f42", 100: "#0c4258", 200: "#125d75", 300: "#0e7d99", 400: "#06b6d4", 500: "#22d3ee",
  600: "#22d3ee", 700: "#67e8f9", 800: "#a5f3fc", 900: "#cffafe", 950: "#ecfeff",
};
const ACCENT_LIGHT = colors.violet as Scale;
const ACCENT_DARK: Scale = {
  50: "#28125c", 100: "#341878", 200: "#4c1d95", 300: "#6d28d9", 400: "#8b5cf6", 500: "#a78bfa",
  600: "#a78bfa", 700: "#c4b5fd", 800: "#ddd6fe", 900: "#ede9fe", 950: "#f5f3ff",
};

const lightVars: Record<string, string> = {
  ...vars("slate", colors.slate as Scale),
  ...vars("brand", BRAND_LIGHT),
  ...vars("accent", ACCENT_LIGHT),
  ...Object.assign({}, ...FAMILIES.map((f) => vars(f, colors[f] as Scale))),
};
const darkVars: Record<string, string> = {
  ...vars("slate", NAVY),
  ...vars("brand", BRAND_DARK),
  ...vars("accent", ACCENT_DARK),
  ...Object.assign({}, ...FAMILIES.map((f) => vars(f, invert(colors[f] as Scale)))),
};

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: v("surface"),
        slate: fromVars("slate"),
        gray: fromVars("slate"),
        brand: fromVars("brand"),
        accent: fromVars("accent"),
        ...Object.fromEntries(FAMILIES.map((f) => [f, fromVars(f)])),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--brand-500) / 0.25), 0 0 24px -4px rgb(var(--brand-500) / 0.45)",
        "glow-violet": "0 0 0 1px rgb(var(--accent-500) / 0.25), 0 0 24px -4px rgb(var(--accent-500) / 0.45)",
        pop: "0 30px 80px -20px rgb(var(--shadow) / var(--shadow-strength))",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        orbit: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
      },
      animation: {
        "fade-up": "fade-up .35s ease-out both",
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
        orbit: "orbit 24s linear infinite",
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ":root": lightVars, ':root[data-theme="dark"]': darkVars });
    }),
  ],
};

export default config;
