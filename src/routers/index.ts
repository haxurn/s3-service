import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { Scalar } from '@scalar/hono-api-reference';
import { publicProcedure, router } from '../lib/trpc';
import s3Router from './s3.routes';
import path from 'path';
import fs from 'fs';

import type { Context } from 'hono';

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return 'OK';
  }),
});
export type AppRouter = typeof appRouter;

const apiKeyMiddleware = async (c: Context, next: () => Promise<void>) => {
  // Exclude the `/docs` route from the middleware
  if (c.req.path === '/docs') {
    return next();
  }

  const apiKey = c.req.header('x-api-key');
  const validApiKey = process.env.API_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return c.json({ error: 'Unauthorized: Invalid API key' }, 401);
  }

  await next();
};

export function createAppRoutes() {
  const routes = new Hono();

  // Apply API key middleware to all routes
  routes.use('*', apiKeyMiddleware);

  routes.route('/s3', s3Router);

  const openapiDir = path.resolve('./public/openapi');
  if (!fs.existsSync(openapiDir)) {
    fs.mkdirSync(openapiDir, { recursive: true });
  }

  routes.use('/openapi/*', serveStatic({ root: './public' }));

  routes.get(
    '/docs',
    Scalar({
      url: '/openapi/openapi.json',
      pageTitle: 'S3 Service API Documentation',
      theme: 'purple',
      customCss: `
        * { font-family: "Arial", sans-serif; }
        .scalar-container { background-color: #f9f9f9; }
      `,
      metaData: {
        description: 'Documentation for the S3 Service API',
        ogTitle: 'S3 Service API Docs',
        ogImage: 'https://localhost:3001/og-image.png',
        twitterCard: 'summary_large_image',
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local Development Server',
        },
      ],
    })
  );

  routes.get('/health', (c: Context) => {
    return c.json({
      status: 'OK',
      service: 's3-service',
      timestamp: new Date().toISOString(),
    });
  });

  routes.get('/', (c: Context) => c.redirect('/docs'));

  return routes;
}

export const app = createAppRoutes();

export default app;