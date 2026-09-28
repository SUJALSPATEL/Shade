/**
 * PostCSS configuration.
 *
 * Tailwind v4 is a PostCSS plugin and nothing else — there is no
 * `tailwind.config.js` in this project. The design tokens live in
 * `src/app/globals.css` under `@theme`, which is where Tailwind v4 reads them,
 * and where a reader looking for "what colour is the accent" will find them.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
