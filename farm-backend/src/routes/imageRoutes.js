import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, roles, approved } from "../middleware/auth.js";
import { getImage, uploadImage } from "../controllers/imageController.js";
export const imageRoutes = Router();
imageRoutes.get("/:id", getImage);
imageRoutes.post(
  "/",
  authenticate,
  roles("producer"),
  approved,
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  json({ limit: "7mb" }),
  uploadImage,
);
