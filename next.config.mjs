/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A V2 run on a long clip can outlast the default server action budget.
  experimental: { proxyTimeout: 900_000 },
};
export default nextConfig;
