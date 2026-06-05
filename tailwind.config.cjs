/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // "void" = warm neutral surfaces (higher number = lighter, ivory page bg)
        void: {
          950: '#fbf7f2', // page background — ivory
          900: '#f4ece3', // soft panel
          800: '#fcf8f4', // cards / inputs (warm white)
          700: '#e8dccf', // borders / light fills
          600: '#d6c6b5', // stronger borders / ticks
        },
        // "arcane" = blush rose accent (lower = paler, higher = deeper)
        arcane: {
          100: '#fbeef1',
          200: '#f6dde3',
          300: '#ecc3cc',
          400: '#dd93a3',
          500: '#cf7587',
          600: '#bd5e72',
          700: '#a84e63',
          800: '#8c4153',
          900: '#6f3340',
        },
        // gilded gold
        gold: {
          400: '#d9b45a',
          500: '#c9a24b',
          600: '#ae8836',
        },
        // warm charcoal text ramp, inverted (lower number = darker / more prominent)
        gray: {
          300: '#4a3f3a',
          400: '#6a5d54',
          500: '#877a6f',
          600: '#a2958a',
          700: '#bfb3a6',
        },
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'bounce-in': 'bounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'fade-in': 'fadeIn 0.3s ease-out',
        'roll': 'roll 0.1s linear infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.85', filter: 'brightness(1.3)' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        roll: {
          '0%': { transform: 'rotate(0deg) scale(1)' },
          '25%': { transform: 'rotate(90deg) scale(0.95)' },
          '50%': { transform: 'rotate(180deg) scale(1)' },
          '75%': { transform: 'rotate(270deg) scale(0.95)' },
          '100%': { transform: 'rotate(360deg) scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
