import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function netlifyFunctionLocalMiddleware(): Plugin {
  return {
    name: 'netlify-function-local-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/') && !url.startsWith('/.netlify/functions/api')) {
          return next();
        }
        try {
          const mod = await server.ssrLoadModule('/netlify/functions/api.mts');
          const handler = mod.default;

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const bodyBuffer = Buffer.concat(chunks);

          const protocol = 'http';
          const host = req.headers.host || 'localhost:5173';
          const fullUrl = `${protocol}://${host}${url}`;

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) {
              headers.set(k, v.join(', '));
            } else if (typeof v === 'string') {
              headers.set(k, v);
            }
          }

          const method = (req.method || 'GET').toUpperCase();
          const fetchReq = new Request(fullUrl, {
            method,
            headers,
            body: method !== 'GET' && method !== 'HEAD' && bodyBuffer.length > 0 ? bodyBuffer : undefined,
          });

          const response: Response = await handler(fetchReq, {
            ip: req.socket.remoteAddress || '127.0.0.1',
          });

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          const respBuf = Buffer.from(await response.arrayBuffer());
          res.end(respBuf);
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'Internal Dev Server Error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), netlifyFunctionLocalMiddleware()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
