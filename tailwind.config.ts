import type { Config } from 'tailwindcss';

/**
 * SAP GUI 8.0 — Theme "Quartz Dark / Dark Crystal"
 * Palette resmi yang dipakai di seluruh aplikasi.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sap: {
          /* Top System Bar */
          sysbar: '#181C24',
          /* Background utama */
          bg: '#1E232A',
          /* Table & panel container */
          panel: '#2A2F3B',
          /* Panel alternatif / header tabel */
          panelalt: '#242934',
          /* Elemen input & shell */
          shell: '#2D323E',
          /* Border */
          border: '#3A4050',
          /* Accent SAP Blue */
          blue: '#367BF5',
          bluehover: '#2B65CC',
          bluesoft: 'rgba(54,123,245,0.14)',
          /* Text */
          text: '#E2E8F0',
          muted: '#94A3B8',
          /* Message semantics */
          success: '#3FA45B',
          error: '#E5484D',
          warning: '#E9A23B',
          info: '#367BF5',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Mono"', 'Consolas', '"Courier New"', 'monospace'],
        sans: ['"Segoe UI"', '"72"', 'Arial', 'sans-serif'],
      },
      fontSize: {
        xxs: ['10px', '14px'],
        '2xs': ['11px', '15px'],
      },
      boxShadow: {
        sap: '0 2px 10px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
