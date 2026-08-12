/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand green, extracted directly from the IQRA logo (#00453a)
        brand: {
          50: '#f0f9f8',
          100: '#ddf4f0',
          200: '#b0e8df',
          300: '#70dbca',
          400: '#35d4bb',
          500: '#19b39a',
          600: '#098b76',
          700: '#007563',
          800: '#006151',
          900: '#005245',
          950: '#00453a',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
