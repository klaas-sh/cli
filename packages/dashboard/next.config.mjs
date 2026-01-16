/**
 * Next.js configuration for the Klaas user dashboard
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // Enable WebAssembly support for argon2-browser
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    }

    // Configure WASM loading for argon2-browser
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    })

    // Fallback for node modules when running in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      }
    }

    return config
  },
}

export default nextConfig
