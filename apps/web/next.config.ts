import type { NextConfig } from 'next';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  /**
   * Sends browser calls to the API through this origin, so no CORS setup is
   * needed, and forwards the capture path as well, since the URL shown on a bin
   * page points at this origin.
   */
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiBase}/api/:path*` },
      { source: '/i/:path*', destination: `${apiBase}/i/:path*` },
    ];
  },
};

export default nextConfig;
