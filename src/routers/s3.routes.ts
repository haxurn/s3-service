import { Hono } from "hono";
import { cache } from "hono/cache";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { uploadFile, getUploadedFile, deleteFile } from "../controller/s3.controller";
import { fileExists, getFileMetadata } from "../service/s3.service";

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
  wait: false
};

s3Router.post("/upload", uploadValidator, uploadFile);

s3Router.get("/file/:key", cache(cacheConfig), getUploadedFile);

s3Router.use("/file/:key", async (c, next) => {
  if (c.req.method === "HEAD") {
    try {
      const { key } = c.req.param();
      const exists = await fileExists(key);
      
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

s3Router.delete("/file/:key", deleteFile);

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

export default s3Router; 