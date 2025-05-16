import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3";
import { MongoClient } from "mongodb"; // Import MongoDB client
import { config } from "../config";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Readable } from "stream";

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

export const fileExists = async (key: string): Promise<boolean> => {
  const bucket = config.s3.bucket;

  if (!bucket) {
    console.error("S3 bucket is not configured. Check your .env file.");
    throw new Error("S3 bucket is not configured.");
  }

  try {
    // Sanitize the key to remove any trailing commas or whitespace
    const sanitizedKey = key.trim().replace(/,+$/, "");
    console.log(`Checking existence of file with sanitized key: ${sanitizedKey} in bucket: ${bucket}`); // Log the sanitized key

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: sanitizedKey, // Use the sanitized key to check if the file exists
    });

    await s3.send(command);
    console.log(`File exists in S3: ${sanitizedKey}`);
    return true; // File exists
  } catch (error) {
    if (error instanceof S3ServiceException && error.name === "NotFound") {
      console.warn(`File not found in S3: ${key}`);
      return false; // File does not exist
    }
    console.error("Error checking if file exists in S3:", error);
    throw new Error("Failed to check if file exists in S3.");
  }
};

export const getFileMetadata = async (key: string) => {
  const bucket = config.s3.bucket;

  try {
    console.log(`Fetching metadata for file with key: ${key}`); // Log the key for debugging
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key, // Use the full key to retrieve metadata
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
    throw new Error("Failed to retrieve file metadata");
  }
};

export const deleteFile = async (key: string): Promise<boolean> => {
  const bucket = config.s3.bucket;

  try {
    console.log(`Deleting file with key: ${key}`); // Log the key for debugging
    const exists = await fileExists(key);
    if (!exists) {
      console.warn(`File not found in S3: ${key}`);
      return false; // File does not exist
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

    return true; // File deleted successfully
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
    // Sanitize the key to remove any trailing commas or whitespace
    const sanitizedKey = key.trim().replace(/,+$/, "");
    console.log(`Sanitized key for database logging: ${sanitizedKey}`); // Log the sanitized key

    // Connect to the MongoDB client
    await mongoClient.connect();
    const db = mongoClient.db(); // Use the default database from the connection string
    const collection = db.collection("s3Service"); // Use the collection name

    // Check if the record already exists
    const existingRecord = await collection.findOne({ key: sanitizedKey });
    if (existingRecord) {
      console.log(`Key already exists in database: ${sanitizedKey}`); // Log if the key already exists
      return existingRecord;
    }

    // Insert a new record
    const result = await collection.insertOne({
      key: sanitizedKey,
      filename,
      mimetype,
      action,
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`Key logged in database: ${sanitizedKey}`); // Log the key after successful insertion
    return {
      id: result.insertedId,
      key: sanitizedKey,
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

export const listFiles = async () => {
  const s3 = new S3Client({ region: config.s3.region });
  const bucketName = config.s3.bucket;

  if (!bucketName) {
    console.error("S3_BUCKET environment variable is not defined.");
    throw new Error("S3_BUCKET environment variable is not defined.");
  }

  try {
    const command = new ListObjectsV2Command({ Bucket: bucketName });
    const response = await s3.send(command);

    return response.Contents?.map((item) => ({
      key: item.Key,
      lastModified: item.LastModified,
      size: item.Size,
    })) || [];
  } catch (error) {
    console.error("Error listing files:", error);
    throw new Error("Failed to list files. Ensure the bucket exists and is accessible.");
  }
};

export const getFileStream = async (key: string) => {
  const bucket = config.s3.bucket;

  console.log(`Attempting to fetch file from bucket: ${bucket}, key: ${key}`);

  if (!bucket) {
    console.error("S3_BUCKET environment variable is not defined.");
    throw new Error("S3_BUCKET environment variable is not defined.");
  }

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);

    const body = response.Body as Readable;

    if (!body || typeof body[Symbol.asyncIterator] !== "function") {
      throw new Error("Response body is not streamable");
    }

    return {
      Body: body,
      ContentType: response.ContentType,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      console.error(`File not found in S3: ${key}`);
      throw new Error("File not found");
    }
    console.error("Error fetching file stream:", error);
    throw new Error("Failed to fetch file stream");
  }
};

export const modifyFileContent = async (
  key: string, 
  searchText: string, 
  replaceText: string, 
  options: { 
    caseSensitive?: boolean, 
    regexSearch?: boolean 
  } = {}
): Promise<boolean> => {
  const bucket = config.s3.bucket;

  if (!bucket) {
    console.error("S3 bucket is not configured. Check your .env file.");
    throw new Error("S3 bucket is not configured.");
  }

  try {
    // Get the existing file
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3.send(getCommand);
    const contentType = response.ContentType || 'application/octet-stream';
    
    // Handle text-based files only
    if (!contentType.includes('text/') && 
        !contentType.includes('application/json') && 
        !contentType.includes('application/xml') &&
        !contentType.includes('application/javascript')) {
      console.warn(`Cannot modify binary file type: ${contentType}`);
      throw new Error("Cannot modify binary file. Only text-based files are supported.");
    }

    // Get the file content as text
    const body = response.Body as Readable;
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    const fileContent = Buffer.concat(chunks).toString('utf-8');

    // Perform the search and replace
    let modifiedContent: string;
    
    if (options.regexSearch) {
      try {
        // Use regex with proper flags
        const flags = options.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(searchText, flags);
        modifiedContent = fileContent.replace(regex, replaceText);
      } catch (error) {
        console.error("Invalid regex pattern:", error);
        throw new Error("Invalid regex pattern for search");
      }
    } else {
      // Simple string replace with global flag
      // Handle case sensitivity
      if (options.caseSensitive) {
        // Directly replace all occurrences
        const parts = fileContent.split(searchText);
        modifiedContent = parts.join(replaceText);
      } else {
        // Case insensitive replace - need to use regex
        const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        modifiedContent = fileContent.replace(regex, replaceText);
      }
    }

    // If no changes were made, don't update the file
    if (modifiedContent === fileContent) {
      console.log(`No changes were made to file: ${key}`);
      return false;
    }

    // Upload the modified content back to S3
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(modifiedContent, 'utf-8'),
      ContentType: contentType,
      // Preserve the metadata
      Metadata: response.Metadata,
      CacheControl: response.CacheControl || "max-age=31536000",
    });

    await s3.send(putCommand);
    console.log(`Successfully modified file: ${key}`);

    // Update the database record if it exists
    try {
      await mongoClient.connect();
      const db = mongoClient.db();
      const collection = db.collection("s3Service");

      // Update the record's modification timestamp
      await collection.updateOne(
        { key },
        { $set: { updatedAt: new Date() } }
      );
    } catch (dbError) {
      console.warn(`Failed to update database record for ${key}:`, dbError);
      // Continue even if DB update fails
    } finally {
      await mongoClient.close();
    }

    return true;
  } catch (error) {
    if (error instanceof S3ServiceException && error.name === "NoSuchKey") {
      console.error(`File not found: ${key}`);
      throw new Error(`File not found: ${key}`);
    }
    console.error("Error modifying file:", error);
    throw new Error("Failed to modify file content");
  }
};