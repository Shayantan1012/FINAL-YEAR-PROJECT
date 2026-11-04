import mongoose from "mongoose";
import { z } from "zod";
import { User, publicUser } from "../models/User.js";
import { Session } from "../models/Session.js";
import { Product, publicProduct } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { Audit } from "../models/Audit.js";
import { id, pagination } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { Review } from "../models/Review.js";
import { Ticket } from "../models/Ticket.js";
import { changeAdministrator } from "../services/adminAccessService.js";
export async function users(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const role = z
    .enum(["consumer", "producer", "delivery", "administrator"])
    .optional()
    .parse(req.query.role);
  const filter = role ? { role } : {};
  res.json({
    users: (
      await User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
    ).map(publicUser),
    page,
    limit,
    total: await User.countDocuments(filter),
  });
}
export async function moderateUser(req, res) {
  const userId = id.parse(req.params.id),
    input = z
      .object({
        active: z.boolean().optional(),
        approved: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
  const user = await mongoose.connection.transaction(async (session) => {
    const u = await User.findById(userId).session(session);
    ensure(u, 404, "User not found");
    ensure(
      u.role !== "administrator",
      403,
      "Administrator accounts cannot be changed here",
    );
    if (input.approved !== undefined)
      ensure(
        ["producer", "delivery"].includes(u.role),
        400,
        "Approval applies to producers and delivery partners",
      );
    if (input.approved === true)
      ensure(u.verified, 400, "Verify the account email before approval");
    Object.assign(u, input);
    await u.save({ session });
    if (input.active === false)
      await Session.deleteMany({ user: u._id }).session(session);
    await Audit.create(
      [{ actor: req.user._id, action: "user.moderate", target: userId }],
      { session },
    );
    return u;
  });
  res.json({ user: publicUser(user) });
}
export async function dashboard(req, res) {
  const own = req.user.role === "producer",
    filter = own ? { producer: req.user._id } : {};
  const revenue = await Order.aggregate([
    { $match: { ...filter, status: "Delivered" } },
    {
      $group: {
        _id: null,
        totalPaise: { $sum: "$totalPaise" },
        produceSalesPaise: {
          $sum: { $subtract: ["$subtotalPaise", "$discountPaise"] },
        },
      },
    },
  ]);
  res.json({
    ...(!own
      ? {
          users: await User.countDocuments(),
          farmers: await User.countDocuments({ role: "producer" }),
          administrators: await User.countDocuments({ role: "administrator" }),
          pendingApprovals: await User.countDocuments({
            role: { $in: ["producer", "delivery"] },
            approved: false,
            active: true,
          }),
          openTickets: await Ticket.countDocuments({
            status: { $ne: "Resolved" },
          }),
          activeDeliveries: await Order.countDocuments({
            status: "Out for Delivery",
          }),
        }
      : {}),
    activeListings: await Product.countDocuments({
      ...filter,
      active: true,
      deleted: false,
    }),
    orders: await Order.countDocuments(filter),
    completedOrders: await Order.countDocuments({
      ...filter,
      status: "Delivered",
    }),
    lowStock: await Product.find({
      ...filter,
      deleted: false,
      stock: { $lt: 15 },
    })
      .select("name stock")
      .limit(50),
    collectedPaise: revenue[0]?.totalPaise || 0,
    produceSalesPaise: revenue[0]?.produceSalesPaise || 0,
    note: "Cash collection records only; bank settlements are not implemented.",
  });
}
export async function auditLog(req, res) {
  const { page, limit, skip } = pagination(req.query);
  res.json({
    events: await Audit.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    total: await Audit.countDocuments(),
    page,
    limit,
  });
}
export async function adminAccess(req, res) {
  const { grant } = z.object({ grant: z.boolean() }).strict().parse(req.body);
  const user = await changeAdministrator(
    req.user._id,
    id.parse(req.params.id),
    grant,
  );
  res.json({ user: publicUser(user) });
}
export async function products(req, res) {
  const { page, limit, skip } = pagination(req.query);
  res.json({
    products: (
      await Product.find().sort({ createdAt: -1 }).skip(skip).limit(limit)
    ).map(publicProduct),
    total: await Product.countDocuments(),
    page,
    limit,
  });
}
export async function reviews(req, res) {
  const { page, limit, skip } = pagination(req.query);
  res.json({
    reviews: await Review.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    total: await Review.countDocuments(),
    page,
    limit,
  });
}
