/** @type {import('next').NextConfig} */

/**
 * Header keamanan dasar.
 *
 * Aplikasi ini adalah sistem internal yang dipasang di alamat publik, jadi dua
 * hal perlu ditutup sejak awal:
 *  - `X-Robots-Tag: noindex` supaya layar logon tidak muncul di hasil mesin
 *    pencari. Alamat Vercel bisa ditebak dan bisa terindeks tanpa diminta.
 *  - `X-Frame-Options: DENY` supaya halaman tidak bisa disematkan di situs
 *    lain — pertahanan terhadap clickjacking pada layar logon.
 */
const securityHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
