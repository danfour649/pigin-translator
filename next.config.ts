import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The /embed route is built to live in other people's iframes —
        // starting with crustaceansoftware.ca and its Vercel previews.
        // Everywhere else the site stays unframed by default policy of
        // the embedding page, not ours; this header only opens /embed.
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://crustaceansoftware.ca https://*.vercel.app",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
