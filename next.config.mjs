/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Disable webpack caching to prevent corruption issues
    config.cache = false;
    return config;
  },
  async redirects() {
    return [
      // The admin page moved from /manage-properties to /admin; keep old
      // links and bookmarks working.
      {
        source: "/manage-properties",
        destination: "/admin",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
