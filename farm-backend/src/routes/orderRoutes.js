import { Router } from "express";
import * as c from "../controllers/orderController.js";
import * as tracking from "../controllers/trackingController.js";
import { messages, sendMessage } from "../controllers/communityController.js";
import { authenticate, roles, approved } from "../middleware/auth.js";
export const orderRoutes = Router();
orderRoutes.use(authenticate);
orderRoutes.post("/slot-quote", roles("consumer"), c.quoteSlot);
orderRoutes.get("/:id/tracking", tracking.tracking);
orderRoutes.post(
  "/:id/tracking/start",
  roles("delivery"),
  approved,
  tracking.start,
);
orderRoutes.put(
  "/:id/tracking/location",
  roles("delivery"),
  approved,
  tracking.publish,
);
orderRoutes.post(
  "/:id/tracking/stop",
  roles("delivery"),
  approved,
  tracking.stop,
);
orderRoutes.get("/", c.listOrders);
orderRoutes.post("/", roles("consumer"), c.createOrder);
orderRoutes.get("/:id", c.getOrder);
orderRoutes.get("/:id/receipt", c.receipt);
orderRoutes.post("/:id/cancel", c.cancel);
orderRoutes.patch("/:id/status", roles("producer"), approved, c.progress);
orderRoutes.post(
  "/:id/complete",
  roles("producer", "delivery"),
  approved,
  c.complete,
);
orderRoutes.get("/:id/messages", messages);
orderRoutes.post("/:id/messages", sendMessage);
export const deliveryRoutes = Router();
deliveryRoutes.use(authenticate, roles("delivery"), approved);
deliveryRoutes.get("/dashboard", c.deliveryDashboard);
deliveryRoutes.put("/me/location", c.updateDeliveryLocation);
deliveryRoutes.patch("/me/availability", c.setDeliveryAvailability);
deliveryRoutes.get("/available", c.availableDeliveries);
deliveryRoutes.post("/:id/start", c.startDelivery);
deliveryRoutes.post("/:id/claim", c.claimDelivery);
