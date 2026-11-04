import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticate, roles } from "../middleware/auth.js";
import { reverseAddress } from "../services/reverseGeocodeService.js";

export const locationRoutes = Router();
locationRoutes.use(authenticate, roles("consumer", "producer"));
locationRoutes.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));
locationRoutes.get("/reverse", async (req, res) => {
  const point = z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  }).strict().parse(req.query);
  const address = await reverseAddress(
    point,
    req.app.locals.config.reverseGeocodeUrl,
  );
  res.json({ address, attribution: "© OpenStreetMap contributors" });
});
