import { z } from "zod";
import { email, password, text } from "../lib/validation.js";
import { publicUser } from "../models/User.js";
import {
  setupAvailable,
  createAdministrator,
} from "../services/adminAccessService.js";
const input = z.object({ name: text(2, 100), email, password }).strict();
export async function status(_req, res) {
  res.json({ available: await setupAvailable() });
}
export async function setup(req, res) {
  const user = await createAdministrator(input.parse(req.body));
  res.status(201).json({ user: publicUser(user) });
}
export async function create(req, res) {
  const user = await createAdministrator(input.parse(req.body), req.user._id);
  res.status(201).json({ user: publicUser(user) });
}
