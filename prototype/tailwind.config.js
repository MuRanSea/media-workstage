/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#0f1117',
        card: '#1a1d26',
        cardBorder: '#2e3344',
        accent: '#6366f1',
        accentHover: '#4f46e5'
      }
    },
  },
  plugins: [],
}
