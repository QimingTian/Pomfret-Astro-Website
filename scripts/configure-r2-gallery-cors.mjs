import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

const endpoint = process.env.R2_ENDPOINT?.trim()
const bucket = process.env.R2_BUCKET?.trim()
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim()
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim()

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY.')
  process.exit(1)
}

const client = new S3Client({
  region: process.env.R2_REGION ?? 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
})

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [
            'https://www.pomfretastro.org',
            'https://pomfretastro.org',
            'http://localhost:3000',
          ],
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  })
)

console.log(`Configured gallery upload CORS on bucket "${bucket}".`)
