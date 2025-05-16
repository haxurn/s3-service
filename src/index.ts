import { config as dotenvConfig } from "dotenv";
dotenvConfig();
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { createContext } from "./lib/context";
import { appRouter, app as appRoutes } from "./routers/index";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { cache } from "hono/cache"; // Ensure cache is imported

const openapiDir = path.resolve('./public/openapi');
if (!fs.existsSync(openapiDir)) {
	console.log('Creating OpenAPI directory...');
	fs.mkdirSync(openapiDir, { recursive: true });
}

const app = new Hono();
app.use(logger());
app.use(prettyJSON());
app.use(
	"/*",
	cors({
		origin: process.env.CORS_ORIGIN || "*", // Default to allow any origin if not specified
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
		exposeHeaders: ["Content-Length", "Content-Type", "ETag"],
		maxAge: 86400,
	}),
);

// Error handling middleware
app.onError((err, c) => {
	console.error("Application error:", err);
	return c.json({ error: "Internal Server Error" }, 500);
});

// Mount tRPC router
app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
	}),
);

// Mount all application routes directly (not nested under another path)
app.route("", appRoutes);

// Cache middleware check
if (typeof caches === "undefined") {
  console.warn("Cache Middleware is not enabled because caches is not defined.");
} else {
  console.log("Cache Middleware is enabled.");
}

// Start the server
const port = config.server.port;
console.log(`🚀 Server starting on port ${port}`);

export default {
	fetch: app.fetch.bind(app),
	port
};
