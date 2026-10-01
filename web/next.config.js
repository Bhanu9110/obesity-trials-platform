/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg is a server-only dependency; keep it external to the bundle.
  serverExternalPackages: ["pg"],
};

module.exports = nextConfig;
