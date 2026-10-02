/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // /data, /indicators, /strategy, /risk, /backtest live at the repo root
    // (see CLAUDE.md structure) rather than under /src.
  },
};

export default nextConfig;
