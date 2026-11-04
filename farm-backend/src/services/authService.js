import mongoose from "mongoose";
import { randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { Challenge } from "../models/Challenge.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { token, digest } from "../lib/security.js";
import { ensure } from "../lib/errors.js";
export async function issueChallenge(user, purpose, config) {
  ensure(
    config.smtp || config.exposeOtp,
    503,
    "Email delivery is not configured",
  );
  const _id = new mongoose.Types.ObjectId(),
    code = String(randomInt(100000, 1000000));
  await Challenge.deleteMany({ user: user._id, purpose });
  const challenge = await Challenge.create({
    _id,
    user: user._id,
    purpose,
    codeHash: digest(String(_id) + ":" + code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  if (config.smtp) {
    try {
      await nodemailer.createTransport(config.smtp).sendMail({
        from: config.mailFrom,
        to: user.email,
        subject: "Harvest verification code",
        text:
          "Your Harvest " +
          purpose +
          " code is " +
          code +
          ". It expires in 10 minutes.",
      });
    } catch {
      await Challenge.deleteOne({ _id });
      ensure(false, 503, "Unable to deliver verification email");
    }
  }
  return {
    challengeId: String(challenge._id),
    expiresIn: 600,
    ...(config.exposeOtp ? { developmentCode: code } : {}),
  };
}
export async function consumeChallenge(challengeId, code, purpose, action) {
  // Count failed attempts even when the operation is rejected.
  const challenge = await Challenge.findOneAndUpdate(
    {
      _id: challengeId,
      purpose,
      consumed: false,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  ensure(challenge, 400, "Code expired or attempt limit reached");
  ensure(
    challenge.codeHash === digest(challengeId + ":" + code),
    400,
    "Incorrect code",
  );
  return mongoose.connection.transaction(async (session) => {
    const claimed = await Challenge.findOneAndUpdate(
      { _id: challengeId, consumed: false },
      { $set: { consumed: true } },
      { session, returnDocument: "after" },
    );
    ensure(claimed, 400, "Code already used");
    const user = await User.findById(claimed.user).session(session);
    ensure(user && user.active, 400, "Account is unavailable");
    await action(user, session);
    return user;
  });
}
export async function createSession(user, config) {
  const accessToken = token(),
    expiresAt = new Date(Date.now() + config.sessionDays * 86400000);
  await Session.create({
    tokenHash: digest(accessToken),
    user: user._id,
    expiresAt,
  });
  return { accessToken, expiresAt };
}
