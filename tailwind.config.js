/** Tailwind wird lokal gebaut (npm run build:css) – kein CDN, die App läuft auch offline. */
module.exports = {
  darkMode: 'class',
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          500: '#10b981',
          600: '#059669',
          700: '#047857'
        }
      }
    }
  }
};
