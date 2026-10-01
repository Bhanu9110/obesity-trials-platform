import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9ebff",
          500: "#2b7fff",
          600: "#1366e6",
          700: "#0f4fb4",
        },
      },
    },
  },
  plugins: [],
};

export default config;
