/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

