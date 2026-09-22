import type { NextConfig } from 'next';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  // Traces the server and its dependencies into .next/standalone, so the image
  // carries no node_modules of its own.
  output: 'standalone',

  /**
   * Sends browser calls to the API through this origin, so no CORS setup is
   * needed.
   *
   * Only `/api` is forwarded. The capture path must not be served here, because
   * the session cookie belongs to this origin and a browser opening a capture
   * URL would send it along with the request being captured.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
