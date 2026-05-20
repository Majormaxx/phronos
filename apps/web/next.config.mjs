/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@phronos/shared", "@phronos/db"],
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
