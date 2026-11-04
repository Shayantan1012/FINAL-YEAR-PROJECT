import { Router } from "express";
import * as c from "../controllers/productController.js";
import { reviews } from "../controllers/communityController.js";
import { authenticate, roles, approved } from "../middleware/auth.js";
export const productRoutes = Router();
productRoutes.get("/", c.listProducts);
productRoutes.get("/mine", authenticate, roles("producer"), c.ownProducts);
productRoutes.get("/:id/reviews", reviews);
productRoutes.get("/:id", c.getProduct);
productRoutes.post(
  "/",
  authenticate,
  roles("producer"),
  approved,
  c.createProduct,
);
productRoutes.patch(
  "/:id",
  authenticate,
  roles("producer", "administrator"),
  approved,
  c.updateProduct,
);
productRoutes.delete(
  "/:id",
  authenticate,
  roles("producer", "administrator"),
  approved,
  c.deleteProduct,
);
