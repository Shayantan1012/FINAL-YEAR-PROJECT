import mongoose from "mongoose";
import { AdminControl } from "../models/AdminControl.js";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { Audit } from "../models/Audit.js";
import { ensure } from "../lib/errors.js";
import { hashPassword } from "../lib/security.js";

export async function setupAvailable() {
  const control = await AdminControl.findById("administrators");
  return (
    !control?.initialized && !(await User.exists({ role: "administrator" }))
  );
}
async function lock(session, actor) {
  const control = await AdminControl.findOneAndUpdate(
    { _id: "administrators" },
    { $inc: { revision: 1 } },
    { session, returnDocument: "after" },
  );
  ensure(
    control,
    503,
    "Administrator setup is not ready. Restart the backend.",
  );
  if (actor)
    ensure(
      await User.exists({
        _id: actor,
        role: "administrator",
        active: true,
        verified: true,
      }).session(session),
      403,
      "Administrator access is no longer available",
    );
  return control;
}
export async function createAdministrator(input, actor) {
  const passwordHash = await hashPassword(input.password);
  return mongoose.connection.transaction(async (session) => {
    const control = await lock(session, actor);
    if (!actor)
      ensure(
        !control.initialized &&
          !(await User.exists({ role: "administrator" }).session(session)),
        409,
        "First administrator already exists. Sign in or ask an administrator for access.",
      );
    ensure(
      !(await User.exists({ email: input.email }).session(session)),
      409,
      "Email already registered. Sign in as an administrator to grant this account access, or use a different email.",
    );
    const [user] = await User.create(
      [
        {
          name: input.name,
          email: input.email,
          passwordHash,
          role: "administrator",
          verified: true,
          approved: true,
        },
      ],
      { session },
    );
    control.initialized = true;
    await control.save({ session });
    await Audit.create(
      [
        {
          actor: actor || user._id,
          action: actor
            ? "administrator.create"
            : "administrator.initial-setup",
          target: String(user._id),
        },
      ],
      { session },
    );
    return user;
  });
}
export async function changeAdministrator(actor, target, grant) {
  return mongoose.connection.transaction(async (session) => {
    await lock(session, actor);
    ensure(
      String(actor) !== target,
      400,
      "You cannot change your own administrator access",
    );
    const user = await User.findById(target)
      .select("+previousRole +previousApproval")
      .session(session);
    ensure(user, 404, "User not found");
    if (grant) {
      ensure(
        user.active && user.verified,
        400,
        "The account must be active and email verified",
      );
      ensure(
        user.role !== "administrator",
        409,
        "This account already has administrator access",
      );
      user.previousRole = user.role;
      user.previousApproval = user.approved;
      user.role = "administrator";
      user.approved = true;
    } else {
      ensure(
        user.role === "administrator",
        409,
        "This account is not an administrator",
      );
      ensure(
        (await User.countDocuments({
          role: "administrator",
          active: true,
          verified: true,
        }).session(session)) > 1,
        409,
        "The last active administrator cannot be removed",
      );
      user.role = ["consumer", "producer", "delivery"].includes(
        user.previousRole,
      )
        ? user.previousRole
        : "consumer";
      user.approved = user.previousApproval ?? user.role === "consumer";
      user.previousRole = undefined;
      user.previousApproval = undefined;
    }
    await user.save({ session });
    await Session.deleteMany({ user: user._id }).session(session);
    await AdminControl.updateOne(
      { _id: "administrators" },
      { $set: { initialized: true } },
      { session },
    );
    await Audit.create(
      [
        {
          actor,
          action: grant ? "administrator.grant" : "administrator.revoke",
          target,
        },
      ],
      { session },
    );
    return user;
  });
}
