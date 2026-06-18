import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#F7F5F0",
        surface: "#FFFFFF",
        brand: "#1A3A2A",
        text: "#1A1A1A",
        muted: "#6B6B6B",
        "checked-text": "#AFAFAF",
        "checked-bg": "#E8F0EB",
        border: "#E5E2DC",
        danger: "#C4363A",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        ui: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
