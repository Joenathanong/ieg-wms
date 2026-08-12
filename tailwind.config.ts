import type { Config } from 'tailwindcss';

/**
 * SAP GUI 8.0 — Dual Theme
 *   Dark  : "Quartz Dark / Dark Crystal"  (default)
 *   Light : "SAP Morning Horizon"
 *
 * Semua warna menunjuk CSS variable channel RGB di globals.css
 * (html[data-theme='dark'|'light']) sehingga opacity modifier
 * seperti bg-sap-blue/15 tetap berfungsi di kedua tema.
 */
const rgb = (v: string) => `rgb(var(--sap-${v}-rgb) / <alpha-value>)`;

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
          sysbar: rgb('sysbar'),
          /* Background utama */
          bg: rgb('bg'),
          /* Table & panel container */
          panel: rgb('panel'),
          /* Panel alternatif / header tabel */
          panelalt: rgb('panelalt'),
          /* Elemen input & shell */
          shell: rgb('shell'),
          /* Border */
          border: rgb('border'),
          /* Accent SAP Blue */
          blue: rgb('blue'),
          bluehover: rgb('bluehover'),
          blueactive: rgb('blueactive'),
          bluesoft: 'var(--sap-blue-soft)',
          /* Text */
          text: rgb('text'),
          muted: rgb('muted'),
          /* Permukaan tambahan */
          nav: rgb('nav'),
          topbar2: rgb('topbar2'),
          cmd: rgb('cmd'),
          toolbar: rgb('toolbar'),
          titlebar: rgb('titlebar'),
          field: rgb('field'),
          fielddis: rgb('fielddis'),
          btn: rgb('btn'),
          btnhover: rgb('btnhover'),
          btnactive: rgb('btnactive'),
          neutralbg: rgb('neutralbg'),
          neutralborder: rgb('neutralborder'),
          hover: 'var(--sap-hover)',
          /* Semantic tones (badge / message) */
          oktext: rgb('oktext'),
          okbg: rgb('okbg'),
          okborder: rgb('okborder'),
          errtext: rgb('errtext'),
          errbg: rgb('errbg'),
          errborder: rgb('errborder'),
          warntext: rgb('warntext'),
          warnbg: rgb('warnbg'),
          warnborder: rgb('warnborder'),
          infotext: rgb('infotext'),
          infobg: rgb('infobg'),
          infoborder: rgb('infoborder'),
          /* Danger button */
          dangerbg: rgb('dangerbtn-bg'),
          dangerborder: rgb('dangerbtn-border'),
          dangertext: rgb('dangerbtn-text'),
          dangerhover: rgb('dangerbtn-hover'),
          /* Message semantics */
          success: rgb('success'),
          error: rgb('error'),
          warning: rgb('warning'),
          info: rgb('blue'),
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
        sap: 'var(--sap-shadow)',
      },
    },
  },
  plugins: [],
};

export default config;
