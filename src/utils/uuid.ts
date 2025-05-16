import { randomUUID } from "crypto";

export function generateFileKey(action: string, originalName: string) {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "bin"; // Ensure the extension is lowercase
  const sanitizedAction = action.replace(/[^a-zA-Z0-9_-]/g, ""); // Sanitize the action to remove invalid characters
  return `${sanitizedAction}/${randomUUID()}.${ext}`; // Ensure the full path is generated
}