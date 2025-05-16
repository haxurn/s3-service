import { Hono } from "hono";
import { cache } from "hono/cache";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { uploadFile, getUploadedFile, deleteFile, fetchFiles, modifyFile } from "../controller/s3.controller";
import { fileExists, getFileMetadata, getFileStream, deleteFile as deleteFileService } from "../service/s3.service";
import { Readable } from "stream";

const s3Router = new Hono();

const uploadValidator = zValidator("form", z.object({
  file: z.any().refine(
    (val) => {
      // Check if it's a single File
      if (val instanceof File) return true;
      
      // Check if it's an array of Files
      if (Array.isArray(val) && val.every(f => f instanceof File)) return true;
      
      // If we get here through formData.getAll, each item should be a File
      if (val && typeof val === 'object' && Object.keys(val).length > 0) {
        return Object.values(val).every(f => f instanceof File);
      }
      
      return false;
    }, 
    "File is required"
  ),
  action: z.string().min(1, "Action is required")
}));

const cacheConfig = {
  cacheName: "s3-cache",
  cacheControl: "max-age=300, must-revalidate",
  wait: true, // Ensure the cache middleware is enabled
};

s3Router.post("/upload", uploadValidator, uploadFile);

// Route to handle file retrieval with query parameter
s3Router.get("/file", async (c) => {
  try {
    const key = c.req.query("key");

    if (!key) {
      console.error("File key is missing in the query string.");
      return c.json({ error: "File key is required" }, 400);
    }

    // Decode and sanitize the key
    const sanitizedKey = decodeURIComponent(key.trim());
    console.log(`Fetching file with query param key: ${sanitizedKey}`);

    // Check if the file exists
    const exists = await fileExists(sanitizedKey);
    if (!exists) {
      console.warn(`File not found in S3: ${sanitizedKey}`);
      return c.json({ error: "File not found" }, 404);
    }

    // Get file metadata
    const fileInfo = await getFileMetadata(sanitizedKey);
    
    if (!fileInfo) {
      return c.json({ error: "File not found" }, 404);
    }
    
    return c.json(fileInfo);
  } catch (error) {
    console.error("Error fetching file:", error);
    return c.json({ error: "Failed to fetch file" }, 500);
  }
});

// Route for rendering file - specific route needs to be before parameterized routes
s3Router.get("/file/render", async (c) => {
  try {
    const key = c.req.query("key");

    if (!key) {
      console.error("File key is missing in the query string.");
      return c.json({ error: "File key is required" }, 400);
    }

    // Decode and sanitize the key
    const sanitizedKey = decodeURIComponent(key.trim());
    console.log(`Fetching file with sanitized key: ${sanitizedKey}`);

    // Check if the file exists
    const exists = await fileExists(sanitizedKey);
    if (!exists) {
      console.warn(`File not found in S3: ${sanitizedKey}`);
      return c.json({ error: "File not found" }, 404);
    }

    const fileStream = await getFileStream(sanitizedKey);

    if (!fileStream) {
      console.warn(`File not found: ${sanitizedKey}`);
      return c.json({ error: "File not found" }, 404);
    }

    c.header("Content-Type", fileStream.ContentType || "application/octet-stream");
    c.header("Content-Disposition", `inline; filename="${sanitizedKey.split("/").pop()}"`);

    const body = fileStream.Body as Readable;

    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    const responseBody = Buffer.concat(chunks);
    return c.body(responseBody);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error rendering file:", error.message);
    } else {
      console.error("Error rendering file:", error);
    }
    return c.json({ error: error instanceof Error ? error.message : "An unknown error occurred" }, 500);
  }
});

s3Router.get("/file/:key", cache(cacheConfig), async (c) => {
  try {
    const { key } = c.req.param();

    if (!key) {
      console.error("File key is missing in the request.");
      return c.json({ error: "File key is required" }, 400);
    }

    // Sanitize the key to remove any trailing commas or whitespace
    const sanitizedKey = key.trim().replace(/,+$/, "");
    console.log(`Fetching file with sanitized key: ${sanitizedKey}`); // Log the sanitized key

    const exists = await fileExists(sanitizedKey); // Check if the file exists in S3

    if (!exists) {
      console.warn(`File not found in S3: ${sanitizedKey}`);
      return c.json({ error: "File not found" }, 404);
    }

    // Instead of reusing c with the original key, get file metadata directly
    const fileInfo = await getFileMetadata(sanitizedKey);
    
    if (!fileInfo) {
      return c.json({ error: "File not found" }, 404);
    }
    
    return c.json(fileInfo);
  } catch (error) {
    console.error("Error fetching file:", error);
    return c.json({ error: "Failed to fetch file" }, 500);
  }
});

s3Router.delete("/file/:key", async (c) => {
  try {
    const { key } = c.req.param(); // Extract the key from the route parameter

    if (!key) {
      return c.json({ error: "File key is required" }, 400);
    }

    // Sanitize the key to remove any trailing commas or whitespace
    const sanitizedKey = key.trim().replace(/,+$/, "");
    console.log(`Deleting file with sanitized key: ${sanitizedKey}`);

    // Call the service function directly with the sanitized key instead of passing context
    const deleted = await deleteFileService(sanitizedKey); 

    if (!deleted) {
      return c.json({ error: "File not found or already deleted" }, 404); // Return 404 if the file does not exist
    }

    return c.json({ message: "File deleted successfully" }, 200);
  } catch (error) {
    console.error("Error deleting file:", error);
    return c.json({ error: "Failed to delete file" }, 500);
  }
});

// Ensure HEAD requests are handled correctly
s3Router.use("/file/:key", async (c, next) => {
  if (c.req.method === "HEAD") {
    try {
      const { key } = c.req.param();
      
      // Sanitize the key to remove any trailing commas or whitespace
      const sanitizedKey = key.trim().replace(/,+$/, "");
      console.log(`Checking existence of file with sanitized key: ${sanitizedKey}`);
      
      const exists = await fileExists(sanitizedKey);

      if (!exists) {
        return c.notFound();
      }

      return c.body(null, 200);
    } catch (error) {
      console.error("Error checking file existence:", error);
      return c.body(null, 500);
    }
  }
  return next();
});

s3Router.post("/batch", async (c) => {
  try {
    const { operations } = await c.req.json<{ operations: Array<{ 
      type: 'exists' | 'metadata', 
      key: string 
    }> }>();
    
    if (!operations || !Array.isArray(operations)) {
      return c.json({ error: "Valid operations array is required" }, 400);
    }
    
    if (operations.length > 10) {
      return c.json({ error: "Maximum 10 operations per batch" }, 400);
    }
    
    const results = await Promise.allSettled(
      operations.map(async (op) => {
        if (op.type === 'exists') {
          return { key: op.key, exists: await fileExists(op.key) };
        } else if (op.type === 'metadata') {
          return await getFileMetadata(op.key);
        }
        return null;
      })
    );
    
    return c.json({ results });
  } catch (error) {
    console.error("Batch operation error:", error);
    return c.json({ error: "Failed to process batch operation" }, 500);
  }
});

s3Router.get("/files", fetchFiles);

// Route to handle file deletion with query parameter
s3Router.delete("/file", async (c) => {
  try {
    const key = c.req.query("key");

    if (!key) {
      console.error("File key is missing in the query string.");
      return c.json({ error: "File key is required" }, 400);
    }

    // Decode and sanitize the key
    const sanitizedKey = decodeURIComponent(key.trim());
    console.log(`Deleting file with query param key: ${sanitizedKey}`);

    const exists = await fileExists(sanitizedKey);
    if (!exists) {
      console.warn(`File not found in S3: ${sanitizedKey}`);
      return c.json({ error: "File not found or already deleted" }, 404);
    }

    // Call the service function with the sanitized key
    const deleted = await deleteFileService(sanitizedKey);

    if (!deleted) {
      return c.json({ error: "File not found or already deleted" }, 404);
    }

    return c.json({ message: "File deleted successfully" }, 200);
  } catch (error) {
    console.error("Error deleting file:", error);
    return c.json({ error: "Failed to delete file" }, 500);
  }
});

// Route to handle file modification
s3Router.patch("/file/modify", async (c) => {
  return modifyFile(c);
});

// Alternative route with query parameters
s3Router.patch("/file", async (c) => {
  return modifyFile(c);
});

export default s3Router;