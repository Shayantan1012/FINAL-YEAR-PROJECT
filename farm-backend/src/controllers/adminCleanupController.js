import { z } from "zod";
import { ensure } from "../lib/errors.js";
import { verifyPassword } from "../lib/security.js";
import { User } from "../models/User.js";
import { cleanupPreview, performCleanup } from "../services/adminCleanupService.js";

const input = z.object({
  scope: z.enum(["orders", "products", "accounts", "all", "sessions", "audit"]),
  confirmation: z.string(),
  password: z.string().min(1),
}).strict();

export async function preview(_req, res) {
  res.json(await cleanupPreview());
}

export async function clean(req, res) {
  const body = input.parse(req.body);
  ensure(body.confirmation === `DELETE ${body.scope.toUpperCase()}`, 400,
    "Confirmation phrase does not match");
  const actor = await User.findById(req.user._id).select("+passwordHash");
  ensure(actor && await verifyPassword(body.password, actor.passwordHash), 403,
    "Administrator password is incorrect");
  res.json(await performCleanup(body.scope, req.user._id));
}
