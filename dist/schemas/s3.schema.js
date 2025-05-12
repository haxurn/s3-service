import { z } from "zod";
export const uploadSchema = z.object({
    action: z
        .string()
        .min(1, "Action is required")
        .regex(/^[a-zA-Z0-9_-]+$/, "Invalid characters in action"),
    files: z.array(z.any()).nonempty("At least one file is required"),
});
