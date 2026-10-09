import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

/*
 * Themes: every palette the UI uses is a CSS variable, so components keep their
 * dark-first class names and the light theme only swaps values.
 *   - slate (the neutral scale) is mirrored: 100 text becomes 900 text, 800
 *     surfaces become 200 surfaces.
 *   - accent palettes swap their light tints (text on dark) for deep tones and
 *     their dark tones (tinted backgrounds) for light tints; 500–700 stay, so
 *     solid buttons keep white text.
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const MIRROR = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 };
const ACCENT_LIGHT = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 600, 700: 700, 800: 200, 900: 100, 950: 50 };
const ACCENTS = ['amber', 'indigo', 'emerald', 'pink', 'rose', 'violet', 'red', 'sky', 'teal', 'orange', 'lime'];

const CANVAS = {
  dark: { bg: '#08090f', surface: '#12141e', card: '#151824', border: '#1f2438' },
  light: { bg: '#f3f4f8', surface: '#ffffff', card: '#ffffff', border: '#dfe3ec' },
};

const channels = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const ref = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const darkVars = { 'color-scheme': 'dark' };
const lightVars = { 'color-scheme': 'light' };
const palette = {};

for (const [name, map] of [['slate', MIRROR], ...ACCENTS.map((a) => [a, ACCENT_LIGHT])]) {
  palette[name] = {};
  for (const shade of SHADES) {
    darkVars[`--c-${name}-${shade}`] = channels(colors[name][shade]);
    lightVars[`--c-${name}-${shade}`] = channels(colors[name][map[shade]]);
    palette[name][shade] = ref(`${name}-${shade}`);
  }
}
palette.canvas = {};
for (const key of Object.keys(CANVAS.dark)) {
  darkVars[`--c-canvas-${key}`] = channels(CANVAS.dark[key]);
  lightVars[`--c-canvas-${key}`] = channels(CANVAS.light[key]);
  palette.canvas[key] = ref(`canvas-${key}`);
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: palette,
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        // A subtree marked data-theme="dark" (overlays on media) keeps the dark palette.
        ':root, [data-theme="dark"]': darkVars,
        ':root[data-theme="light"]': lightVars,
      });
    }),
  ],
}
