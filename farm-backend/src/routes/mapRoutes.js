import { Router, static as serveStatic } from "express";
import { fileURLToPath } from "node:url";
export const mapRoutes = Router();
mapRoutes.use((_req, res, next) => {
  // This public document contains no order data. The authenticated app sends pins locally.
  res.removeHeader("X-Frame-Options");
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; frame-ancestors *",
  );
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
mapRoutes.use(
  "/leaflet",
  serveStatic(
    fileURLToPath(new URL("../../node_modules/leaflet/dist/", import.meta.url)),
  ),
);
mapRoutes.use(
  serveStatic(fileURLToPath(new URL("../../public/map/", import.meta.url))),
);
