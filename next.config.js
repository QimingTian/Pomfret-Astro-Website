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

