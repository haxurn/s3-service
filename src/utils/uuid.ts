import { randomUUID } from "crypto";

export function generateFileKey(action: string, originalName: string) {
  const ext = originalName.split(".").pop() ?? "bin";
  return `${action}/${randomUUID()}.${ext}`;
}