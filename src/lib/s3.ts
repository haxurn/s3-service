import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config";

const region = config.s3.region;

const credentials = config.s3.accessKeyId && config.s3.secretAccessKey
  ? {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    }
  : undefined;

export const s3 = new S3Client({
  region,
  credentials,
});
