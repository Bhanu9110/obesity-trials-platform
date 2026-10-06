import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Dark "intelligence platform" theme.
// The site's markup uses light-theme classes (bg-white cards, slate text, pastel
// badges). Instead of rewriting every class, the palettes are flipped here:
//   white      -> glass card surface
//   slate-50…950 -> navy surfaces (low numbers) … near-white text (high numbers)
//   emerald/rose/amber/sky/violet… 50 <-> 950, 100 <-> 900 …  (pastel badge -> dark tinted badge)
// so every page turns dark consistently. Values live in CSS variables (globals.css)
// for slate/white/brand so opacity modifiers keep working.

type Scale = Record<string, string>;
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
function invert(scale: Scale): Scale {
  const out: Scale = {};
  STEPS.forEach((s, i) => { out[s] = scale[STEPS[STEPS.length - 1 - i]]; });
  return out;
}
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const fromVars = (prefix: string): Scale => Object.fromEntries(STEPS.map((s) => [s, v(`${prefix}-${s}`)]));

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
        emerald: invert(colors.emerald),
        green: invert(colors.green),
        rose: invert(colors.rose),
        red: invert(colors.red),
        amber: invert(colors.amber),
        yellow: invert(colors.yellow),
        orange: invert(colors.orange),
        sky: invert(colors.sky),
        blue: invert(colors.blue),
        indigo: invert(colors.indigo),
        violet: invert(colors.violet),
        purple: invert(colors.purple),
        teal: invert(colors.teal),
        cyan: invert(colors.cyan),
        fuchsia: invert(colors.fuchsia),
        pink: invert(colors.pink),
        lime: invert(colors.lime),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--brand-500) / 0.25), 0 0 24px -4px rgb(var(--brand-500) / 0.45)",
        "glow-violet": "0 0 0 1px rgb(var(--accent-500) / 0.25), 0 0 24px -4px rgb(var(--accent-500) / 0.45)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        orbit: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        shimmer: { from: { backgroundPosition: "0% 50%" }, to: { backgroundPosition: "200% 50%" } },
      },
      animation: {
        "fade-up": "fade-up .35s ease-out both",
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
        orbit: "orbit 24s linear infinite",
        shimmer: "shimmer 6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
