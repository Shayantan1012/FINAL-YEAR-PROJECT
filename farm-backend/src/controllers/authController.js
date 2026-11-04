import { Order } from "../models/Order.js";
import { z } from "zod";
import mongoose from "mongoose";
import { User, publicUser } from "../models/User.js";
import { Session } from "../models/Session.js";
import { email, password, text, id, postalCode } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import {
  issueChallenge,
  consumeChallenge,
  createSession,
} from "../services/authService.js";
const credentials = z.object({ email, password }).strict();
export async function register(req, res) {
  const data = z
    .object({
      name: text(2, 100),
      address: text(0, 500).optional(),
      email,
      password,
      role: z.enum(["consumer", "producer", "delivery"]),
      language: z
        .enum(["en", "bn", "hi", "as", "or", "ne", "ta", "te"])
        .optional(),
      farmName: text(2, 100).optional(),
      city: text(0, 100).optional(),
      state: text(0, 100).optional(),
      postalCode: postalCode.optional(),
      phone: z.string().trim().max(40)
        .transform((value) => value.replace(/[\s()-]/g, ""))
        .refine((value) => value === "" || /^\+?[0-9]{7,15}$/.test(value), "Enter a valid phone number with 7–15 digits")
        .optional(),
    })
    .strict()
    .parse(req.body);
  ensure(
    data.role !== "producer" || data.farmName,
    400,
    "Farm name is required",
  );
  ensure(
    req.app.locals.config.smtp || req.app.locals.config.exposeOtp,
    503,
    "Email delivery is not configured",
  );
  const user = await User.create({
    ...data,
    password: undefined,
    passwordHash: await hashPassword(data.password),
    approved: data.role === "consumer",
  });
  const challenge = await issueChallenge(user, "verify", req.app.locals.config);
  res.status(201).json({ user: publicUser(user), ...challenge });
}
export async function verify(req, res) {
  const data = z
    .object({ challengeId: id, code: z.string().regex(/^\d{6}$/) })
    .strict()
    .parse(req.body);
  const user = await consumeChallenge(
    data.challengeId,
    data.code,
    "verify",
    async (user, session) => {
      user.verified = true;
      await user.save({ session });
    },
  );
  res.json({
    user: publicUser(user),
    ...(await createSession(user, req.app.locals.config)),
  });
}
export async function login(req, res) {
  const data = credentials.parse(req.body);
  const user = await User.findOne({ email: data.email }).select(
    "+passwordHash",
  );
  const valid = await verifyPassword(data.password, user?.passwordHash);
  ensure(valid && user?.active, 401, "Invalid email or password");
  ensure(user.verified, 403, "Verify your email before signing in");
  res.json({
    user: publicUser(user),
    ...(await createSession(user, req.app.locals.config)),
  });
}
export async function requestCode(req, res) {
  const data = z
    .object({ email, purpose: z.enum(["verify", "reset"]) })
    .strict()
    .parse(req.body);
  const user = await User.findOne({ email: data.email, active: true });
  let challenge = {
    challengeId: String(new mongoose.Types.ObjectId()),
    expiresIn: 600,
  };
  if (user && (data.purpose === "reset" || !user.verified))
    challenge = await issueChallenge(user, data.purpose, req.app.locals.config);
  res.status(202).json({
    message: "If the account is eligible, a code has been sent.",
    ...challenge,
  });
}
export async function resetPassword(req, res) {
  const data = z
    .object({ challengeId: id, code: z.string().regex(/^\d{6}$/), password })
    .strict()
    .parse(req.body);
  const passwordHash = await hashPassword(data.password);
  await consumeChallenge(
    data.challengeId,
    data.code,
    "reset",
    async (user, session) => {
      user.passwordHash = passwordHash;
      await user.save({ session });
      await Session.deleteMany({ user: user._id }).session(session);
    },
  );
  res.json({ message: "Password changed. Sign in again." });
}
export async function logout(req, res) {
  await Order.updateMany(
    { driver: req.user._id, trackingAuthSession: req.authSession._id },
    {
      $unset: {
        trackingSession: 1,
        trackingAuthSession: 1,
        driverLocation: 1,
        locationRecordedAt: 1,
        locationReceivedAt: 1,
        locationAccuracy: 1,
      },
    },
  );
  await req.authSession.deleteOne();
  res.status(204).end();
}
