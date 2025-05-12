export const config = {
  s3: {
    bucket: process.env.S3_BUCKET!,
    region: process.env.AWS_REGION!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  },
  database: {
    url: process.env.DATABASE_URL!
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 3001,
  },
}; 