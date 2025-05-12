import { randomUUID } from "crypto";
export function generateFileKey(action, originalName) {
    const ext = originalName.split(".").pop() ?? "bin";
    return `${action}/${randomUUID()}.${ext}`;
}
