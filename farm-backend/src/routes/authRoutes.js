import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as c from "../controllers/authController.js";
import * as setup from "../controllers/adminSetupController.js";
import { authenticate } from "../middleware/auth.js";
export const authRoutes = Router();
authRoutes.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: { message: "Too many authentication attempts. Try again later." },
    },
  }),
);
authRoutes.post("/register", c.register);
authRoutes.get("/admin-setup", setup.status);
authRoutes.post("/admin-setup", setup.setup);
authRoutes.post("/verify", c.verify);
authRoutes.post("/login", c.login);
authRoutes.post("/request-code", c.requestCode);
authRoutes.post("/reset-password", c.resetPassword);
authRoutes.post("/logout", authenticate, c.logout);
