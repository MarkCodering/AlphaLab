import type { NextConfig } from 'next';

const apiOrigin = process.env.ALPHALAB_API_ORIGIN ?? 'http://127.0.0.1:4310';

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.ALPHALAB_NEXT_DIST_DIR ?? '.next',
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/control/:path*',
        destination: `${apiOrigin}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
