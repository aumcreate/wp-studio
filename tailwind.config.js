/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fef3ee',
          100: '#fde3d4',
          200: '#fbc4a8',
          300: '#f79d71',
          400: '#f27040',
          500: '#e8501a',
          600: '#d03e10',
          700: '#ac2f0f',
          800: '#8a2714',
          900: '#702313',
          950: '#3c0f07',
        },
        surface: {
          0:   '#ffffff',
          50:  '#f7f7f7',
          100: '#eeeeee',
          200: '#e0e0e0',
          300: '#c8c8c8',
          400: '#aaaaaa',
          500: '#888888',
        },

        // ── Ink scale ──────────────────────────────────────────────────────
        // Semantic text and overlay tokens for day-mode.
        // Replaces the dark-theme pattern of text-white / text-white/<opacity>.
        //
        // Text usage:
        //   ink             → primary body text   (#1a1a1a)
        //   ink-secondary   → secondary labels    (#444444)
        //   ink-muted       → placeholder/caption (#888888)
        //   ink-faint       → de-emphasised hints (#aaaaaa)
        //   ink-ghost       → barely-visible      (#cccccc)
        //
        // Surface overlay usage (bg-ink-*, border-ink-*, divide-ink-*):
        //   Simulates the dark-theme bg-white/<alpha> pattern but inverted —
        //   a dark ink at low opacity over a white surface, producing subtle
        //   grey tints that match the day palette.
        ink: {
          DEFAULT:   '#1a1a1a',
          secondary: '#444444',
          muted:     '#888888',
          faint:     '#aaaaaa',
          ghost:     '#cccccc',

          // Overlay tints — bg-ink-N / border-ink-N / divide-ink-N
          4:  'rgba(0,0,0,0.03)',
          5:  'rgba(0,0,0,0.04)',
          6:  'rgba(0,0,0,0.05)',
          8:  'rgba(0,0,0,0.06)',
          10: 'rgba(0,0,0,0.08)',
          12: 'rgba(0,0,0,0.09)',
          15: 'rgba(0,0,0,0.10)',
          20: 'rgba(0,0,0,0.12)',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
