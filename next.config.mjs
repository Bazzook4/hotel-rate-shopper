/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Disable webpack caching to prevent corruption issues
    config.cache = false;
    return config;
  },
};

export default nextConfig;
