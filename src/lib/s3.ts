import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config";

const region = config.s3.region;

if (!region) {
  console.error("AWS region is not configured. Check your .env file.");
  throw new Error("AWS region is not configured.");
}

const credentials = config.s3.accessKeyId && config.s3.secretAccessKey
  ? {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    }
  : undefined;

if (!credentials) {
  console.error("AWS credentials are not configured. Check your .env file.");
  throw new Error("AWS credentials are not configured.");
}

export const s3 = new S3Client({
  region,
  credentials,
});
