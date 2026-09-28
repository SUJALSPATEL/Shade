import type { NextConfig } from 'next';

/**
 * Next configuration.
 *
 * The one decision that matters here is the `/api/*` rewrite.
 *
 * In development the browser talks to a single origin (`localhost:3000`) and
 * Next proxies API calls to the Fastify server. That is not cosmetic: the
 * session cookie is `httpOnly` and `SameSite=Lax`, so keeping it first-party
 * means the app never needs a CORS preflight on a credentialled request and
 * never has to relax `SameSite` to make uploads work. It also means the browser
 * can enforce a single, honest origin for everything it stores.
 *
 * Setting `NEXT_PUBLIC_API_BASE_URL` to an absolute URL opts out of the proxy
 * and talks to the API directly — which is what a deployment where the two are
 * on separate origins needs. The client reads that variable in `src/lib/api.ts`,
 * so the two halves of the decision live together.
 */

const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `@shade/shared` ships TypeScript source, not a build artifact — it is a
  // workspace package resolved through a symlink, and Next does not run its
  // compiler over node_modules by default. Without this the first import of a
  // shared type fails at build time with a syntax error on a `.ts` file.
  transpilePackages: ['@shade/shared'],

  webpack(config) {
    // The shared package uses NodeNext-style `./constants.js` specifiers that
    // point at `.ts` files. TypeScript's Bundler resolution maps those itself;
    // webpack needs to be told the same mapping, or the first cross-module
    // import inside the package resolves to a file that does not exist.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        // The dashboard shows user-uploaded documents and extracted content.
        // Nothing here should ever be framed by another origin, and the
        // browser should not be allowed to re-interpret a response type.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
