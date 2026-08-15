import type { NextConfig } from 'next';

const apiOrigin = process.env.ALPHALAB_API_ORIGIN ?? 'http://127.0.0.1:4310';
const workerOrigin = process.env.ALPHALAB_WORKER_ORIGIN ?? 'http://127.0.0.1:4311';
const modelOrigin = process.env.ALPHALAB_MODEL_ORIGIN ?? 'http://127.0.0.1:8100';
const experimentOrigin = process.env.ALPHALAB_EXPERIMENT_ORIGIN ?? 'http://127.0.0.1:8101';
const verifierOrigin = process.env.ALPHALAB_VERIFIER_ORIGIN ?? 'http://127.0.0.1:8102';

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
      { source: '/api/runtime/worker/:path*', destination: `${workerOrigin}/v1/:path*` },
      { source: '/api/runtime/model/:path*', destination: `${modelOrigin}/v1/:path*` },
      {
        source: '/api/runtime/experiment/:path*',
        destination: `${experimentOrigin}/v1/:path*`,
      },
      { source: '/api/runtime/verifier/:path*', destination: `${verifierOrigin}/v1/:path*` },
    ];
  },
};

export default nextConfig;
