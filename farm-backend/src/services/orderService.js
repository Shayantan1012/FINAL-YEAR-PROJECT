import mongoose from "mongoose";
import { randomInt } from "node:crypto";
import { Product } from "../models/Product.js";
import { User } from "../models/User.js";
import { Order, publicOrder } from "../models/Order.js";
import { Checkout } from "../models/Checkout.js";
import { ensure } from "../lib/errors.js";
import { digest } from "../lib/security.js";
import { notify } from "./notificationService.js";
import { releaseDriver } from "./deliveryAssignmentService.js";
import { inServiceHours, quoteOrderSlot } from "./orderScheduleService.js";
export async function checkout(user, input, key) {
  const fingerprint = digest(JSON.stringify(input));
  const replay = async (record) => {
    ensure(
      record.fingerprint === fingerprint,
      409,
      "Idempotency key was used for a different checkout",
    );
    const orders = await Order.find({ _id: { $in: record.orders } }).select(
      "+handoverCode",
    );
    return {
      orders: orders.map((o) => publicOrder(o, user)),
      totalPaise: record.totalPaise,
      replayed: true,
    };
  };
  const prior = await Checkout.findOne({ user: user._id, key });
  if (prior) return replay(prior);
  try {
    return await mongoose.connection.transaction(async (session) => {
      const previous = await Checkout.findOne({ user: user._id, key }).session(
        session,
      );
      if (previous) {
        ensure(
          previous.fingerprint === fingerprint,
          409,
          "Idempotency key was used for a different checkout",
        );
        const orders = await Order.find({ _id: { $in: previous.orders } })
          .select("+handoverCode")
          .session(session);
        return {
          orders: orders.map((o) => publicOrder(o, user)),
          totalPaise: previous.totalPaise,
          replayed: true,
        };
      }
      const schedule = await quoteOrderSlot(input, { session });
      ensure(schedule.available && schedule.minimumSlot, 409,
        "Home delivery is unavailable until enough nearby delivery partners are online");
      if (input.method === "pickup") {
        ensure(
          new Date(input.slot) > new Date() &&
            new Date(input.slot) < new Date(Date.now() + 7 * 86400000),
          400,
          "Choose a pickup time within the next seven days",
        );
        ensure(
          new Date(input.slot) >= new Date(schedule.minimumSlot) &&
            inServiceHours(new Date(input.slot)),
          409,
          `Choose a pickup time on or after ${new Date(schedule.minimumSlot).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} during 09:00–19:00 IST`,
        );
      }
      const orderTime = input.method === "delivery"
        ? schedule.minimumSlot
        : input.slot;
      const groups = new Map();
      let subtotal = 0;
      for (const line of input.items) {
        const p = await Product.findById(line.productId).session(session);
        ensure(
          p && p.active && !p.deleted && p.stock >= line.quantity,
          409,
          "Insufficient stock or unavailable product",
        );
        ensure(
          line.quantity >= p.minOrder,
          400,
          "Minimum order quantity not met",
        );
        ensure(
          !p.expiry || p.expiry >= new Date().toISOString().slice(0, 10),
          409,
          "A product has expired",
        );
        ensure(
          p.deliveryOptions.includes(input.method),
          400,
          "Delivery option is unavailable for an item",
        );
        const grower = await User.findOne({
          _id: p.producer,
          active: true,
          verified: true,
          approved: true,
        }).session(session);
        ensure(grower, 409, "Producer is currently unavailable");
        const reserved = await Product.updateOne(
          {
            _id: p._id,
            stock: { $gte: line.quantity },
            active: true,
            deleted: false,
          },
          { $inc: { stock: -line.quantity } },
          { session },
        );
        ensure(
          reserved.modifiedCount === 1,
          409,
          "Stock changed; please retry",
        );
        ensure(
          p.pickupLocation,
          409,
          "The farmer must add a pickup map pin before this product can be ordered",
        );
        const groupKey = [
          p.producer,
          p.pickupLocation.latitude,
          p.pickupLocation.longitude,
        ].join(":");
        if (!groups.has(groupKey))
          groups.set(groupKey, {
            producer: p.producer,
            farm: p.farm,
            pickupAddress: p.location,
            pickupLocation: p.pickupLocation.toObject(),
            items: [],
            subtotalPaise: 0,
          });
        const group = groups.get(groupKey);
        group.items.push({
          product: p._id,
          name: p.name,
          quantity: line.quantity,
          pricePaise: p.pricePaise,
        });
        group.subtotalPaise += p.pricePaise * line.quantity;
        subtotal += p.pricePaise * line.quantity;
      }
      const discount =
        input.coupon === "FRESH10" ? Math.round(subtotal * 0.1) : 0;
      const deliveryFee =
        input.method === "pickup" || subtotal >= 49900 ? 0 : 3500;
      const result = [];
      let allocated = 0,
        index = 0;
      for (const group of groups.values()) {
        const share =
          index === groups.size - 1
            ? discount - allocated
            : Math.floor((discount * group.subtotalPaise) / subtotal);
        allocated += share;
        const fee = index === 0 ? deliveryFee : 0;
        index++;
        const [order] = await Order.create(
          [
            {
              ...group,
              consumer: user._id,
              discountPaise: share,
              deliveryPaise: fee,
              totalPaise: group.subtotalPaise + fee - share,
              method: input.method,
              address: input.method === "delivery" ? input.address : group.farm,
              recipientName: input.recipientName,
              recipientPhone: input.recipientPhone,
              deliveryInstructions: input.deliveryInstructions,
              destinationLocation:
                input.method === "delivery"
                  ? input.destinationLocation
                  : undefined,
              slot: orderTime,
              payment: input.method === "pickup" ? "pickup" : "cod",
              handoverCode: String(randomInt(100000, 1000000)),
              history: [{ status: "Pending", at: new Date(), by: user._id }],
            },
          ],
          { session },
        );
        result.push(order);
        await notify(
          [user._id, group.producer],
          "New order placed",
          order._id,
          session,
        );
      }
      const totalPaise = subtotal + deliveryFee - discount;
      await Checkout.create(
        [
          {
            user: user._id,
            key,
            fingerprint,
            orders: result.map((o) => o._id),
            totalPaise,
          },
        ],
        { session },
      );
      return {
        orders: result.map((o) => publicOrder(o, user)),
        totalPaise,
        replayed: false,
      };
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Checkout.findOne({ user: user._id, key });
      if (existing) return replay(existing);
    }
    throw error;
  }
}
export function canAccess(order, user) {
  return (
    user.role === "administrator" ||
    [order.consumer, order.producer, order.driver].some(
      (id) => id && String(id) === String(user._id),
    )
  );
}
export async function cancelOrder(orderId, user, reason) {
  return mongoose.connection.transaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    ensure(order && canAccess(order, user), 404, "Order not found");
    const consumer = String(order.consumer) === String(user._id),
      producer = String(order.producer) === String(user._id);
    ensure(
      consumer || producer || user.role === "administrator",
      403,
      "Cannot cancel this order",
    );
    if (order.status === "Cancelled") return order;
    const allowed = consumer
      ? ["Pending", "Accepted"]
      : [
          "Pending",
          "Accepted",
          "Preparing",
          "Ready for Pickup",
          "Driver Assigned",
        ];
    ensure(
      allowed.includes(order.status),
      409,
      "Order cannot be cancelled at this stage",
    );
    for (const line of order.items)
      await Product.updateOne(
        { _id: line.product },
        { $inc: { stock: line.quantity } },
        { session },
      );
    order.status = "Cancelled";
    order.cancellationReason = reason;
    order.paymentStatus = "void";
    order.trackingSession = undefined;
    order.trackingAuthSession = undefined;
    order.driverLocation = undefined;
    order.locationRecordedAt = undefined;
    order.locationReceivedAt = undefined;
    order.locationAccuracy = undefined;
    order.history.push({ status: "Cancelled", at: new Date(), by: user._id });
    await order.save({ session });
    await notify(
      [order.consumer, order.producer, order.driver],
      "Order cancelled",
      order._id,
      session,
    );
    await releaseDriver(order.driver, session);
    return order;
  });
}
