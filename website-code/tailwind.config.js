/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'apple-gray': '#D4CDCB',
        'apple-dark': '#17181F',
        'apple-blue': '#000000',
        'apple-blue-hover': '#000000',
      },
      // Site-wide surface radius (cards, panels, modals, session rows).
      // Controls (pills / inputs) keep using rounded-full → 9999px.
      borderRadius: {
        sm: '1rem',
        DEFAULT: '1rem',
        md: '1rem',
        lg: '1rem',
        xl: '1rem',
        '2xl': '1rem',
        '3xl': '1rem',
      },
    },
  },
  plugins: [],
}
