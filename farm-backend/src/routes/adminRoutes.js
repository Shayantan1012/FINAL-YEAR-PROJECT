import { Router } from "express";
import * as c from "../controllers/adminController.js";
import { create } from "../controllers/adminSetupController.js";
import { authenticate, roles } from "../middleware/auth.js";
import rateLimit from "express-rate-limit";
import * as cleanup from "../controllers/adminCleanupController.js";
export const adminRoutes = Router();
adminRoutes.use(authenticate, roles("administrator"));
adminRoutes.get("/users", c.users);
adminRoutes.post("/administrators", create);
adminRoutes.patch("/users/:id/admin-access", c.adminAccess);
adminRoutes.get("/products", c.products);
adminRoutes.get("/reviews", c.reviews);
adminRoutes.patch("/users/:id", c.moderateUser);
adminRoutes.get("/dashboard", c.dashboard);
adminRoutes.get("/audit", c.auditLog);
adminRoutes.get("/cleanup", cleanup.preview);
adminRoutes.post("/cleanup", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}), cleanup.clean);
export const producerRoutes = Router();
producerRoutes.use(authenticate, roles("producer"));
producerRoutes.get("/dashboard", c.dashboard);
