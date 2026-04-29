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
    },
  },
  plugins: [],
}

