import { Router } from "express";
import * as c from "../controllers/communityController.js";
import { authenticate, roles, approved } from "../middleware/auth.js";
export const communityRoutes = Router();
communityRoutes.use(authenticate);
communityRoutes.post("/reviews", roles("consumer"), c.createReview);
communityRoutes.patch(
  "/reviews/:id/reply",
  roles("producer"),
  approved,
  c.replyReview,
);
communityRoutes.get("/tickets", c.tickets);
communityRoutes.post("/tickets", c.createTicket);
communityRoutes.patch(
  "/tickets/:id/resolve",
  roles("administrator"),
  c.resolveTicket,
);
