import { PrismaClient } from "../../generated/prisma/index.js";
const prisma = new PrismaClient({
    log: ["query", "info", "warn", "error"],
    errorFormat: "pretty",
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});
export default prisma;
