import type { Context } from "hono";
import { uploadToS3, getFileMetadata, deleteFile as deleteFileService, logUploadToDB, listFiles, modifyFileContent } from "../service/s3.service";
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

    // Sanitize the key to remove any trailing commas or whitespace
    const sanitizedKey = key.trim().replace(/,+$/, "");
    console.log(`Retrieving file with sanitized key: ${sanitizedKey}`); // Log the sanitized key

    const fileInfo = await getFileMetadata(sanitizedKey); // Use the sanitized key to retrieve metadata

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
      return c.json({ error: "File not found or already deleted" }, 404);
    }

    return c.json({ message: "File deleted successfully" }, 200);
  } catch (error) {
    console.error("Delete error:", error);
    return c.json({ error: "Failed to delete file" }, 500);
  }
};

export const fetchFiles = async (c: Context) => {
  try {
    const files = await listFiles();

    if (!files || files.length === 0) {
      console.warn("No files found in the S3 bucket.");
      return c.json({ message: "No files found" }, 404);
    }

    return c.json({ files }, 200);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Fetch files error:", error.message);
    } else {
      console.error("Fetch files error:", error);
    }
    return c.json({ error: "Failed to fetch files. Ensure the bucket exists and is accessible." }, 500);
  }
};

export const modifyFile = async (c: Context) => {
  try {
    // Get the request body
    const body = await c.req.json();
    
    // Validate required fields
    const { key, searchText, replaceText, options } = body;
    
    if (!key) {
      return c.json({ error: "File key is required" }, 400);
    }
    
    if (searchText === undefined || searchText === null) {
      return c.json({ error: "Search text is required" }, 400);
    }
    
    if (replaceText === undefined || replaceText === null) {
      return c.json({ error: "Replace text is required" }, 400);
    }
    
    // Prepare options with defaults
    const modifyOptions = {
      caseSensitive: options?.caseSensitive === true,
      regexSearch: options?.regexSearch === true
    };
    
    // Decode and sanitize the key
    const sanitizedKey = decodeURIComponent(key.trim());
    console.log(`Modifying file with key: ${sanitizedKey}`);
    
    // Check if the file exists
    const fileInfo = await getFileMetadata(sanitizedKey);
    if (!fileInfo) {
      return c.json({ error: "File not found" }, 404);
    }
    
    // Perform the modification
    const modified = await modifyFileContent(
      sanitizedKey, 
      searchText, 
      replaceText, 
      modifyOptions
    );
    
    if (!modified) {
      return c.json({ 
        message: "No modifications were made", 
        key: sanitizedKey
      }, 200);
    }
    
    return c.json({ 
      message: "File content modified successfully", 
      key: sanitizedKey
    }, 200);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("binary file")) {
        return c.json({ error: "Cannot modify binary file. Only text-based files are supported." }, 400);
      }
      if (error.message.includes("Invalid regex")) {
        return c.json({ error: "Invalid regex pattern provided" }, 400);
      }
      console.error("Modify file error:", error.message);
      return c.json({ error: error.message }, 500);
    }
    console.error("Modify file error:", error);
    return c.json({ error: "Failed to modify file content" }, 500);
  }
};
