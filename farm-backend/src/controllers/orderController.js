import mongoose from "mongoose";
import { z } from "zod";
import { Order, publicOrder } from "../models/Order.js";
import { id, quantity, text, pagination, point } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { checkout, canAccess, cancelOrder } from "../services/orderService.js";
import { notify } from "../services/notificationService.js";
import { User } from "../models/User.js";
import {
  assignNearestDriver,
  assignWaitingDeliveries,
  releaseDriver,
} from "../services/deliveryAssignmentService.js";
import { quoteOrderSlot } from "../services/orderScheduleService.js";
const slotRequest = z
  .object({
    items: z.array(z.object({ productId: id, quantity }).strict()).min(1).max(50),
    method: z.enum(["delivery", "pickup"]),
    destinationLocation: point.optional(),
  })
  .strict();
export async function quoteSlot(req, res) {
  const input = slotRequest.parse(req.body);
  ensure(new Set(input.items.map((line) => line.productId)).size === input.items.length, 400, "Duplicate products are not allowed");
  res.json(await quoteOrderSlot(input));
}
export async function createOrder(req, res) {
  const input = z
    .object({
      items: z
        .array(z.object({ productId: id, quantity }).strict())
        .min(1)
        .max(50),
      method: z.enum(["delivery", "pickup"]),
      address: text(10, 500).optional(),
      destinationLocation: point.optional(),
      recipientName: text(2, 80),
      recipientPhone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, "Enter a valid recipient phone number"),
      deliveryInstructions: text(0, 300).default(""),
      slot: z.string().datetime({ offset: true }).optional(),
      coupon: z.enum(["", "FRESH10"]).default(""),
    })
    .strict()
    .parse(req.body);
  ensure(
    input.method !== "delivery" || (input.address && input.destinationLocation),
    400,
    "Delivery address and map pin required",
  );
  ensure(
    input.method === "delivery" ? input.slot === undefined : !!input.slot,
    400,
    input.method === "delivery"
      ? "Home delivery time is calculated automatically"
      : "Choose a farm pickup time",
  );
  ensure(
    new Set(input.items.map((i) => i.productId)).size === input.items.length,
    400,
    "Duplicate products are not allowed",
  );
  input.items.sort((a, b) => a.productId.localeCompare(b.productId));
  const key = z
    .string()
    .min(8)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(req.get("Idempotency-Key"));
  const result = await checkout(req.user, input, key);
  res.status(result.replayed ? 200 : 201).json(result);
}
export function orderScope(user) {
  return user.role === "administrator"
    ? {}
    : {
        [user.role === "consumer"
          ? "consumer"
          : user.role === "producer"
            ? "producer"
            : "driver"]: user._id,
      };
}
export async function listOrders(req, res) {
  const { page, limit, skip } = pagination(req.query),
    filter = orderScope(req.user);
  if (req.query.method !== undefined)
    filter.method = z.enum(["delivery", "pickup"]).parse(req.query.method);
  const orders = await Order.find(filter)
    .select("+handoverCode")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  res.json({
    orders: orders.map((o) => publicOrder(o, req.user)),
    page,
    limit,
    total: await Order.countDocuments(filter),
  });
}
export async function getOrder(req, res) {
  const order = await Order.findById(id.parse(req.params.id)).select(
    "+handoverCode",
  );
  ensure(order && canAccess(order, req.user), 404, "Order not found");
  res.json({ order: publicOrder(order, req.user) });
}
export async function cancel(req, res) {
  const { reason } = z
    .object({ reason: text(5, 500) })
    .strict()
    .parse(req.body);
  const order = await cancelOrder(id.parse(req.params.id), req.user, reason);
  res.json({ order: publicOrder(order, req.user) });
}
export async function progress(req, res) {
  const { status } = z
    .object({ status: z.enum(["Accepted", "Preparing", "Ready for Pickup"]) })
    .strict()
    .parse(req.body);
  const orderId = id.parse(req.params.id);
  const order = await mongoose.connection.transaction(async (session) => {
    const order = await Order.findOne({
      _id: orderId,
      producer: req.user._id,
    }).session(session);
    ensure(order, 404, "Order not found");
    const next = {
      Pending: "Accepted",
      Accepted: "Preparing",
      Preparing: "Ready for Pickup",
    };
    ensure(
      next[order.status] === status,
      409,
      "Invalid order status transition",
    );
    order.status = status;
    order.history.push({ status, at: new Date(), by: req.user._id });
    await order.save({ session });
    if (status === "Ready for Pickup")
      await assignNearestDriver(order, session);
    await notify(
      [order.consumer],
      "Order is " + status.toLowerCase(),
      order._id,
      session,
    );
    return order;
  });
  res.json({ order: publicOrder(order, req.user) });
}
export async function availableDeliveries(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const orders = await Order.find({
    method: "delivery",
    status: "Ready for Pickup",
    driver: null,
  })
    .select("_id farm slot createdAt")
    .skip(skip)
    .limit(limit);
  // Consumer addresses are disclosed only after a driver claims an order.
  res.json({ deliveries: orders, page, limit });
}
export async function claimDelivery(req, res) {
  const order = await mongoose.connection.transaction(async (session) => {
    const active = await Order.exists({
      driver: req.user._id,
      status: { $in: ["Driver Assigned", "Out for Delivery"] },
    }).session(session);
    ensure(!active, 409, "Complete your current delivery first");
    const order = await Order.findOneAndUpdate(
      {
        _id: id.parse(req.params.id),
        method: "delivery",
        status: "Ready for Pickup",
        driver: null,
      },
      {
        $set: { driver: req.user._id, status: "Out for Delivery" },
        $push: {
          history: {
            status: "Out for Delivery",
            at: new Date(),
            by: req.user._id,
          },
        },
      },
      { session, returnDocument: "after" },
    );
    ensure(order, 409, "Delivery is not available");
    await User.updateOne(
      { _id: req.user._id },
      { $set: { deliveryAvailable: false } },
      { session },
    );
    await notify(
      [order.consumer, order.producer],
      "Order is out for delivery",
      order._id,
      session,
    );
    return order;
  });
  res.json({ order: publicOrder(order, req.user) });
}
export async function updateDeliveryLocation(req, res) {
  const input = z
    .object({ location: point, available: z.boolean().default(true) })
    .strict()
    .parse(req.body);
  const hasActiveDelivery = await Order.exists({
    driver: req.user._id,
    status: { $in: ["Driver Assigned", "Out for Delivery"] },
  });
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        deliveryLocation: input.location,
        deliveryLocationUpdatedAt: new Date(),
        deliveryAvailable: hasActiveDelivery ? false : input.available,
      },
    },
    { returnDocument: "after" },
  );
  if (user.deliveryAvailable) await assignWaitingDeliveries();
  res.json({
    available: user.deliveryAvailable,
    location: user.deliveryLocation,
    locationUpdatedAt: user.deliveryLocationUpdatedAt,
  });
}
export async function setDeliveryAvailability(req, res) {
  const { available } = z
    .object({ available: z.boolean() })
    .strict()
    .parse(req.body);
  const hasActiveDelivery = await Order.exists({
    driver: req.user._id,
    status: { $in: ["Driver Assigned", "Out for Delivery"] },
  });
  ensure(!available || !hasActiveDelivery, 409, "Complete your current delivery first");
  ensure(
    !available || req.user.deliveryLocation,
    400,
    "Share your current location before going available",
  );
  req.user.deliveryAvailable = available;
  await req.user.save();
  if (available) await assignWaitingDeliveries();
  res.json({ available: req.user.deliveryAvailable });
}
export async function deliveryDashboard(req, res) {
  const activeStatuses = ["Driver Assigned", "Out for Delivery"];
  const [current, recent, waiting] = await Promise.all([
    Order.findOne({ driver: req.user._id, status: { $in: activeStatuses } })
      .select("+handoverCode")
      .sort({ assignedAt: 1 }),
    Order.find({ driver: req.user._id, status: { $in: ["Delivered", "Cancelled"] } })
      .sort({ updatedAt: -1 })
      .limit(5),
    Order.countDocuments({
      method: "delivery",
      status: "Ready for Pickup",
      driver: null,
    }),
  ]);
  res.json({
    current: current ? publicOrder(current, req.user) : null,
    recent: recent.map((order) => publicOrder(order, req.user)),
    waiting,
    available: Boolean(req.user.deliveryAvailable),
    location: req.user.deliveryLocation || null,
    locationUpdatedAt: req.user.deliveryLocationUpdatedAt || null,
  });
}
export async function startDelivery(req, res) {
  const order = await mongoose.connection.transaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      {
        _id: id.parse(req.params.id),
        driver: req.user._id,
        method: "delivery",
        status: "Driver Assigned",
      },
      {
        $set: { status: "Out for Delivery" },
        $push: {
          history: {
            status: "Out for Delivery",
            at: new Date(),
            by: req.user._id,
          },
        },
      },
      { session, returnDocument: "after" },
    );
    ensure(order, 409, "Assigned delivery is no longer available");
    await notify(
      [order.consumer, order.producer],
      "Order is out for delivery",
      order._id,
      session,
    );
    return order;
  });
  res.json({ order: publicOrder(order, req.user) });
}
export async function complete(req, res) {
  const { code } = z
    .object({ code: z.string().regex(/^\d{6}$/) })
    .strict()
    .parse(req.body);
  const orderId = id.parse(req.params.id);
  const scope =
    req.user.role === "producer"
      ? { producer: req.user._id, method: "pickup", status: "Ready for Pickup" }
      : {
          driver: req.user._id,
          method: "delivery",
          status: "Out for Delivery",
        };
  const attempted = await Order.findOneAndUpdate(
    { _id: orderId, ...scope, handoverAttempts: { $lt: 5 } },
    { $inc: { handoverAttempts: 1 } },
    { returnDocument: "after" },
  ).select("+handoverCode");
  ensure(
    attempted,
    409,
    "Order unavailable or handover attempt limit reached; contact support",
  );
  ensure(attempted.handoverCode === code, 400, "Incorrect handover code");
  const order = await mongoose.connection.transaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, ...scope },
      {
        $set: { status: "Delivered", paymentStatus: "collected" },
        $unset: {
          handoverCode: 1,
          trackingSession: 1,
          trackingAuthSession: 1,
          driverLocation: 1,
          locationRecordedAt: 1,
          locationReceivedAt: 1,
          locationAccuracy: 1,
        },
        $push: {
          history: { status: "Delivered", at: new Date(), by: req.user._id },
        },
      },
      { session, returnDocument: "after" },
    );
    ensure(order, 409, "Order already completed or unavailable");
    await notify(
      [order.consumer, order.producer, order.driver],
      "Order delivered",
      order._id,
      session,
    );
    await releaseDriver(order.driver, session);
    return order;
  });
  res.json({ order: publicOrder(order, req.user) });
}
export async function receipt(req, res) {
  const order = await Order.findById(id.parse(req.params.id));
  ensure(order && canAccess(order, req.user), 404, "Order not found");
  res.json({
    receipt: {
      number: "HV-" + String(order._id),
      currency: "INR",
      issuedAt: order.createdAt,
      items: order.items,
      subtotalPaise: order.subtotalPaise,
      deliveryPaise: order.deliveryPaise,
      discountPaise: order.discountPaise,
      totalPaise: order.totalPaise,
      paymentStatus: order.paymentStatus,
      status: order.status,
      note: "Order receipt; not a GST tax invoice.",
    },
  });
}
