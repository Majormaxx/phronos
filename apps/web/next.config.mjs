/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@phronos/shared", "@phronos/db"],
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
  },
  webpack(config, { isServer }) {
    // NodeNext-style .js imports in workspace packages → resolve to .ts source
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    // wagmi/connectors bundles every connector; alias optional peer deps that
    // aren't installed so webpack treats them as empty modules.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@metamask/connect-evm": false,
      "@react-native-async-storage/async-storage": false,
      "porto/internal": false,
      "@base-org/account": false,
    };
    // Circle DCW SDK is server-only (workers). Stub it entirely on the client
    // to prevent bundling Node built-ins and TextEncoder polyfills that break
    // under MetaMask's SES lockdown.
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@circle-fin/developer-controlled-wallets": false,
      };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
