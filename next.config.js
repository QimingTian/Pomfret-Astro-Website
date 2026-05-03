/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    // Without application/wasm, hosts often serve .wasm as octet-stream → browser downloads
    // the file instead of feeding instantiateStreaming(); Stellarium stays black.
    return [
      {
        source: '/stellarium/js/stellarium-web-engine.9b8f0e47.wasm',
        headers: [{ key: 'Content-Type', value: 'application/wasm' }],
      },
    ]
  },
  // Stellarium Web hardcodes CDNs that only allow Origin: https://stellarium-web.org.
  // Same-origin proxy so fetch/XHR from pomfretastro.org succeeds (see public/stellarium/index.html).
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/stellarium-cdn-do/:path*',
          destination: 'https://stellarium.sfo2.cdn.digitaloceanspaces.com/:path*',
        },
        {
          source: '/stellarium-cdn-cf/:path*',
          destination: 'https://d3ufh70wg9uzo4.cloudfront.net/:path*',
        },
        {
          source: '/stellarium-cdn-noctua/:path*',
          destination: 'https://api.noctuasky.com/:path*',
        },
      ],
    }
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
    ],
  },
}

module.exports = nextConfig

