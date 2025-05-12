import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3";
import { MongoClient } from "mongodb"; // Import MongoDB client
import { config } from "../config";

const mongoClient = new MongoClient(process.env.DATABASE_URL!); // Use the DATABASE_URL from .env

export const uploadToS3 = async (buffer: Buffer, key: string, contentType: string): Promise<string> => {
  const bucket = config.s3.bucket;
  const region = config.s3.region;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "max-age=31536000",
    });

    await s3.send(command);
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  } catch (error) {
    if (error instanceof S3ServiceException) {
      console.error(`S3 upload error: ${error.name} - ${error.message}`);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
    console.error("Unexpected error during S3 upload:", error);
    throw new Error("Failed to upload file to S3");
  }
};

export const getFileMetadata = async (key: string) => {
  const bucket = config.s3.bucket;

  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      await s3.send(headCommand);
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === "NotFound") {
        return null;
      }
      throw error;
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3.send(command);

    return {
      key,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      metadata: response.Metadata,
      eTag: response.ETag,
    };
  } catch (err) {
    console.error("Error fetching file metadata:", err);
    if (err instanceof S3ServiceException) {
      throw new Error(`S3 error: ${err.message}`);
    }
    throw new Error("Failed to retrieve file metadata");
  }
};

export const deleteFile = async (key: string): Promise<boolean> => {
  const bucket = config.s3.bucket;

  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      await s3.send(headCommand);
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === "NotFound") {
        console.warn(`File ${key} not found in S3, nothing to delete`);
        return false;
      }
      throw error;
    }

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3.send(command);

    // Delete from database using MongoDB client
    try {
      await mongoClient.connect();
      const db = mongoClient.db();
      const collection = db.collection("s3Service");

      const result = await collection.deleteOne({ key });
      if (result.deletedCount === 0) {
        console.warn(`No record found in the database for key: ${key}`);
      }
    } catch (dbError) {
      console.error("Failed to delete file record from database:", dbError);
    } finally {
      await mongoClient.close();
    }

    return true;
  } catch (err) {
    console.error("Error deleting file:", err);
    if (err instanceof S3ServiceException) {
      throw new Error(`S3 deletion error: ${err.message}`);
    }
    throw new Error("Failed to delete file");
  }
};

export const logUploadToDB = async ({
  filename,
  mimetype,
  action,
  key,
  url,
}: {
  filename: string;
  mimetype: string;
  action: string;
  key: string;
  url: string;
}) => {
  try {
    // Connect to the MongoDB client
    await mongoClient.connect();
    const db = mongoClient.db(); // Use the default database from the connection string
    const collection = db.collection("s3Service"); // Use the collection name

    // Check if the record already exists
    const existingRecord = await collection.findOne({ key });
    if (existingRecord) {
      return existingRecord;
    }

    // Insert a new record
    const result = await collection.insertOne({
      key,
      filename,
      mimetype,
      action,
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      id: result.insertedId,
      key,
      filename,
      mimetype,
      action,
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
    }; // Return the inserted document
  } catch (error) {
    console.error("Failed to log upload to database:", error);
    throw new Error("Database logging failed");
  } finally {
    await mongoClient.close(); // Ensure the client is closed after the operation
  }
};

export const fileExists = async (key: string): Promise<boolean> => {
  const bucket = config.s3.bucket;

  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3.send(command);
    return true;
  } catch (error) {
    if (error instanceof S3ServiceException && error.name === "NotFound") {
      return false;
    }
    console.error("Error checking if file exists:", error);
    throw new Error("Failed to check if file exists");
  }
};