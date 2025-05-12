import type { Context } from "hono";
import { uploadToS3, getFileMetadata, deleteFile as deleteFileService, logUploadToDB } from "../service/s3.service";
import { generateFileKey } from "../utils/uuid";

export const uploadFile = async (c: Context) => {
  try {
    const formData = await c.req.formData();
    const fileData = formData.getAll("file");
    const action = formData.get("action") as string;

    if (!fileData || fileData.length === 0) {
      return c.json({ error: "File is required" }, 400);
    }
    
    if (!action || typeof action !== 'string') {
      return c.json({ error: "Valid action is required" }, 400);
    }

    // Handle both single file and multiple files
    if (fileData.length === 1 && fileData[0] instanceof File) {
      // Single file upload
      const file = fileData[0] as File;
      const key = generateFileKey(action, file.name);
      const buffer = await file.arrayBuffer();
      
      const url = await uploadToS3(Buffer.from(buffer), key, file.type);
      
      const logResult = await logUploadToDB({
        key,
        url,
        action,
        filename: file.name,
        mimetype: file.type,
      });

      if ('error' in logResult) {
        return c.json({
          url,
          key,
          warning: "File uploaded successfully, but database logging failed"
        }, 201);
      }

      return c.json({ url, key }, 201);
    } else if (fileData.length > 0) {
      // Multiple files upload
      const uploadPromises = fileData.map(async (fileItem) => {
        if (!(fileItem instanceof File)) {
          return { error: "Invalid file data" };
        }
        
        const file = fileItem as File;
        const key = generateFileKey(action, file.name);
        const buffer = await file.arrayBuffer();
        
        try {
          const url = await uploadToS3(Buffer.from(buffer), key, file.type);
          
          const logResult = await logUploadToDB({
            key,
            url,
            action,
            filename: file.name,
            mimetype: file.type,
          });

          if ('error' in logResult) {
            return {
              url,
              key,
              filename: file.name,
              warning: "File uploaded successfully, but database logging failed"
            };
          }

          return { url, key, filename: file.name };
        } catch (error) {
          console.error(`Error uploading file ${file.name}:`, error);
          return { error: `Failed to upload file ${file.name}`, filename: file.name };
        }
      });

      const results = await Promise.all(uploadPromises);
      
      // Extract successful uploads
      const successful = results.filter(result => !result.error);
      const failed = results.filter(result => result.error);
      
      return c.json({
        files: results,
        urls: successful.map(file => file.url),
        keys: successful.map(file => file.key),
        totalUploaded: successful.length,
        totalFailed: failed.length
      }, 201);
    } else {
      return c.json({ error: "Invalid file data format" }, 400);
    }
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Failed to upload file" }, 500);
  }
};

export const getUploadedFile = async (c: Context) => {
  try {
    const { key } = c.req.param();
    
    if (!key) {
      return c.json({ error: "File key is required" }, 400);
    }
    
    const fileInfo = await getFileMetadata(key);

    if (!fileInfo) {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json(fileInfo);
  } catch (error) {
    console.error("Get file error:", error);
    return c.json({ error: "Failed to retrieve file information" }, 500);
  }
};

export const deleteFile = async (c: Context) => {
  try {
    const { key } = c.req.param();
    
    if (!key) {
      return c.json({ error: "File key is required" }, 400);
    }

    const deleted = await deleteFileService(key);
    
    if (!deleted) {
      return c.json({ error: "Failed to delete file" }, 500);
    }

    return c.json({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    return c.json({ error: "Failed to delete file" }, 500);
  }
};
