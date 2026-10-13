/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#C46A4A',
          orangeDark: '#A85538',
          orangeLight: '#F5E1DA',
          peach: '#F5E1DA',
          charcoal: '#1F1E1C',
          warmBg: '#FAF8F5',
          warmBorder: '#E6E1DA',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
