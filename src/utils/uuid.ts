import { randomUUID } from "crypto";

export function generateFileKey(action: string, originalName: string) {
  // Ensure originalName is a string and fallback if not
  const safeName =
    typeof originalName === "string" && originalName.length > 0
      ? originalName
      : `file-${randomUUID()}.bin`;
  const ext = safeName.split(".").pop()?.toLowerCase() ?? "bin"; // Ensure the extension is lowercase
  const sanitizedAction = action.replace(/[^a-zA-Z0-9_-]/g, ""); // Sanitize the action to remove invalid characters
  return `${sanitizedAction}/${randomUUID()}.${ext}`; // Ensure the full path is generated
}