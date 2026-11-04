import mongoose from "mongoose";
import { ensure } from "../lib/errors.js";
import { Audit } from "../models/Audit.js";
import { Cart } from "../models/Cart.js";
import { Challenge } from "../models/Challenge.js";
import { Checkout } from "../models/Checkout.js";
import { Message } from "../models/Message.js";
import { Notification } from "../models/Notification.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { ProductImage } from "../models/ProductImage.js";
import { Review } from "../models/Review.js";
import { Session } from "../models/Session.js";
import { Ticket } from "../models/Ticket.js";
import { User } from "../models/User.js";

const nonAdmin = { role: { $ne: "administrator" } };
const activeOrder = { status: { $nin: ["Delivered", "Cancelled"] } };

export async function cleanupPreview() {
  const [orders, activeOrders, products, productImages, accounts, administrators,
    checkouts, carts, messages, reviews, notifications, tickets, sessions, audit] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments(activeOrder),
    Product.countDocuments(),
    ProductImage.countDocuments(),
    User.countDocuments(nonAdmin),
    User.countDocuments({ role: "administrator" }),
    Checkout.countDocuments(),
    Cart.countDocuments(),
    Message.countDocuments(),
    Review.countDocuments(),
    Notification.countDocuments(),
    Ticket.countDocuments(),
    Session.countDocuments(),
    Audit.countDocuments(),
  ]);
  return {
    counts: { orders, activeOrders, products, productImages, accounts,
      administrators, checkouts, carts, messages, reviews, notifications, tickets,
      sessions, audit },
    blocked: {
      products: orders > 0,
      accounts: orders > 0 || products > 0,
    },
  };
}

async function clearOrders(session, restoreStock) {
  if (restoreStock) {
    const reserved = await Order.aggregate([
      { $match: activeOrder },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", quantity: { $sum: "$items.quantity" } } },
    ]).session(session);
    for (const line of reserved)
      await Product.updateOne(
        { _id: line._id },
        { $inc: { stock: line.quantity } },
        { session },
      );
  }
  const busyDrivers = await Order.distinct("driver", {
    driver: { $ne: null },
    ...activeOrder,
  }).session(session);
  await User.updateMany(
    { _id: { $in: busyDrivers }, role: "delivery" },
    { $set: { deliveryAvailable: true } },
    { session },
  );
  await Message.deleteMany({}, { session });
  await Review.deleteMany({}, { session });
  await Notification.deleteMany({ order: { $exists: true } }, { session });
  await Ticket.deleteMany({ order: { $exists: true } }, { session });
  await Checkout.deleteMany({}, { session });
  await Order.deleteMany({}, { session });
}

async function clearProducts(session) {
  ensure(!(await Order.exists({}).session(session)), 409,
    "Delete orders before deleting products");
  await Cart.deleteMany({}, { session });
  await User.updateMany({}, { $set: { favorites: [] } }, { session });
  await Review.deleteMany({}, { session });
  await ProductImage.deleteMany({}, { session });
  await Product.deleteMany({}, { session });
}

async function clearAccounts(session) {
  ensure(!(await Order.exists({}).session(session)) &&
    !(await Product.exists({}).session(session)), 409,
  "Delete orders and products before deleting accounts");
  const users = await User.find(nonAdmin).select("_id").lean().session(session);
  const ids = users.map((user) => user._id);
  await Session.deleteMany({ user: { $in: ids } }, { session });
  await Challenge.deleteMany({ user: { $in: ids } }, { session });
  await Cart.deleteMany({ user: { $in: ids } }, { session });
  await Notification.deleteMany({ user: { $in: ids } }, { session });
  await Ticket.deleteMany({ user: { $in: ids } }, { session });
  await Checkout.deleteMany({ user: { $in: ids } }, { session });
  await Message.deleteMany({ sender: { $in: ids } }, { session });
  await Review.deleteMany({ consumer: { $in: ids } }, { session });
  await ProductImage.deleteMany({ owner: { $in: ids } }, { session });
  await User.deleteMany({ _id: { $in: ids }, ...nonAdmin }, { session });
}

export async function performCleanup(scope, actorId) {
  const before = await cleanupPreview();
  await mongoose.connection.transaction(async (session) => {
    if (scope === "sessions") {
      await Order.updateMany(
        { $or: [
          { trackingSession: { $exists: true } },
          { trackingAuthSession: { $exists: true } },
          { driverLocation: { $exists: true } },
        ] },
        { $unset: {
          trackingSession: 1,
          trackingAuthSession: 1,
          driverLocation: 1,
          locationRecordedAt: 1,
          locationReceivedAt: 1,
          locationAccuracy: 1,
        } },
        { session },
      );
      await User.updateMany(
        { role: "delivery" },
        { $set: { deliveryAvailable: false } },
        { session },
      );
      await Session.deleteMany({}, { session });
    }
    if (scope === "audit") await Audit.deleteMany({}, { session });
    if (scope === "orders" || scope === "all")
      await clearOrders(session, scope === "orders");
    if (scope === "products" || scope === "all")
      await clearProducts(session);
    if (scope === "accounts" || scope === "all")
      await clearAccounts(session);
    if (scope === "all") {
      const administratorIds = await User.find({ role: "administrator" })
        .distinct("_id")
        .session(session);
      await Session.deleteMany({ user: { $nin: administratorIds } }, { session });
      await Challenge.deleteMany({ user: { $nin: administratorIds } }, { session });
      await Notification.deleteMany({}, { session });
      await Ticket.deleteMany({}, { session });
      await Cart.deleteMany({}, { session });
    }
    if (scope !== "audit")
      await Audit.create([{
        actor: actorId,
        action: `data.cleanup.${scope}`,
        target: JSON.stringify(before.counts),
      }], { session });
  });
  return { scope, before, after: await cleanupPreview() };
}
