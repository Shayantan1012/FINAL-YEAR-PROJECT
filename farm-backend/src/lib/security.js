import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);
  return salt + ":" + key.toString("hex");
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  // Perform the expensive work even when the account does not exist.
  const key = await derive(password, salt || "missing-account-placeholder", 64);
  const expected = Buffer.from(hash || "00".repeat(64), "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
