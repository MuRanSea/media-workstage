/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: '#08090f',
          surface: '#12141e',
          card: '#151824',
          border: '#1f2438'
        }
      }
    },
  },
  plugins: [],
}
