/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/dashboard/admin',
        destination: '/dashboard/account',
        permanent: true,
      },
    ]
  },
  async headers() {
    // Without application/wasm, hosts often serve .wasm as octet-stream → browser downloads
    // the file instead of feeding instantiateStreaming(); Stellarium stays black.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // Atlas embeds /stellarium/engine.html in an iframe; DENY above blocks the sky viewer.
      // Last matching rule wins for duplicate keys (Next.js merges headers).
      {
        source: '/stellarium/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: '/stellarium/js/stellarium-web-engine.wasm',
        headers: [{ key: 'Content-Type', value: 'application/wasm' }],
      },
    ]
  },
  images: {
    domains: ['localhost'],
  },
  outputFileTracingIncludes: {
    '/*': [
      './Classic DSO Imaging Sequence.json',
      './Classic DSO Imaging Sequence Multi Filter.json',
      './Variable Star Sequence.json',
      './End Night Session.json',
      './EStop.json',
      './Variables/index.csv',
    ],
    '/api/imaging/variable-stars': ['./Variables/index.csv'],
    '/api/imaging/variable-star-lookup': ['./Variables/index.csv'],
  },
}

module.exports = nextConfig

