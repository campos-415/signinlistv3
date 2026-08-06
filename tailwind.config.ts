import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          50: "#eef4ff",
          100: "#dbe6fe",
          400: "#7a9cf7",
          500: "#4a72ef",
          600: "#3457dd",
          700: "#2a44b3",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,20,20,0.04), 0 12px 28px -12px rgba(20,20,20,0.10)",
      },
      borderRadius: {
        "2xl": "1.1rem",
        "3xl": "1.6rem",
      },
    },
  },
  plugins: [],
};
export default config;
