// Web app manifest, so "Add to Home Screen" / "Install app" gets Nido's name
// and icon instead of an OS-generated letter tile.
//
// Every URL here is relative, so it resolves against the origin that served
// the manifest. The same static build is served on the apex and on every
// account (<C>.nido.fyi) and name subdomain, and each of those is its own
// origin with its passkeys bound to it, so an app installed from an account
// page opens that account's origin: `/` there redirects to /account/ (see
// pages/index.astro). With no `id`, the app's identity is its start_url, which
// is per origin too, so two installed accounts are two apps.
//
// The colors are nido.css's --cream, as NidoLayout's theme-color is.
import type { APIRoute } from "astro";
import { APP_NAME } from "../lib/network";

const CREAM = "#FFF8F0";

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: APP_NAME,
        short_name: APP_NAME,
        description: "A safe place for everything you own — secured by your passkey on Stellar.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: CREAM,
        theme_color: CREAM,
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
