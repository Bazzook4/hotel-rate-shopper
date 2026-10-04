import path from "path";
import { fileURLToPath } from "url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray package-lock.json in the home folder makes Next guess the home
  // folder as the workspace root; pin it to this project.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
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
