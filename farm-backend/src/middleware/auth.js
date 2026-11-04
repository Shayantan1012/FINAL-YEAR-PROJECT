import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { digest } from "../lib/security.js";
import { ensure } from "../lib/errors.js";
export async function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  ensure(
    /^Bearer [a-f0-9]{64}$/.test(authorization),
    401,
    "Authentication required",
  );
  const session = await Session.findOne({
    tokenHash: digest(authorization.slice(7)),
    expiresAt: { $gt: new Date() },
  });
  ensure(session, 401, "Session expired or invalid");
  const user = await User.findById(session.user);
  ensure(user && user.active && user.verified, 401, "Account is unavailable");
  req.user = user;
  req.authSession = session;
  next();
}
export const roles =
  (...allowed) =>
  (req, res, next) => {
    ensure(
      allowed.includes(req.user.role),
      403,
      "Your role cannot perform this action",
    );
    next();
  };
export function approved(req, res, next) {
  ensure(req.user.approved, 403, "Administrator approval is required");
  next();
}
