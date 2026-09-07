import type { NextConfig } from 'next';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  /** Sends browser calls to the API through this origin, so no CORS setup is needed. */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
