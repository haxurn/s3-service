import { PrismaClient } from "../../generated/prisma"; 


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