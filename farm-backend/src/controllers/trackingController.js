import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Order } from "../models/Order.js";
import { id, point } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { canAccess } from "../services/orderService.js";

const scope = (req) => ({
  _id: id.parse(req.params.id),
  driver: req.user._id,
  method: "delivery",
  status: "Out for Delivery",
});

export async function tracking(req, res) {
  const order = await Order.findById(id.parse(req.params.id)).select(
    "+trackingSession",
  );
  ensure(order && canAccess(order, req.user), 404, "Order not found");
  ensure(
    !["Delivered", "Cancelled"].includes(order.status),
    410,
    "Tracking is closed for this order",
  );
  const active = order.status === "Out for Delivery" && !!order.trackingSession;
  const fresh =
    active &&
    order.locationReceivedAt &&
    Date.now() - order.locationReceivedAt.getTime() < 60000;
  res.json({
    orderId: String(order._id),
    status: order.status,
    method: order.method,
    pickupAddress: order.pickupAddress || order.farm,
    destinationAddress: order.address,
    pickup: order.pickupLocation || null,
    destination: order.destinationLocation || null,
    driver: active ? order.driverLocation || null : null,
    recordedAt: active ? order.locationRecordedAt || null : null,
    accuracy: active ? (order.locationAccuracy ?? null) : null,
    sharing: active,
    fresh: !!fresh,
  });
}
export async function start(req, res) {
  const session = randomUUID();
  const order = await Order.findOneAndUpdate(scope(req), {
    $set: {
      trackingSession: session,
      trackingAuthSession: req.authSession._id,
    },
    $unset: {
      driverLocation: 1,
      locationRecordedAt: 1,
      locationReceivedAt: 1,
      locationAccuracy: 1,
    },
  });
  ensure(
    order,
    409,
    "Only the assigned partner can share an active delivery location",
  );
  res.json({ session });
}
export async function publish(req, res) {
  const data = z
    .object({
      session: z.uuid(),
      point,
      recordedAt: z.string().datetime(),
      accuracy: z.number().min(0).max(100000).nullable(),
    })
    .strict()
    .parse(req.body);
  const recordedAt = new Date(data.recordedAt),
    now = new Date();
  ensure(
    now - recordedAt < 60000 && recordedAt - now < 10000,
    400,
    "Location sample is too old or in the future",
  );
  const order = await Order.findOneAndUpdate(
    {
      ...scope(req),
      trackingSession: data.session,
      $or: [
        { locationRecordedAt: { $exists: false } },
        { locationRecordedAt: { $lt: recordedAt } },
      ],
    },
    {
      $set: {
        driverLocation: data.point,
        locationRecordedAt: recordedAt,
        locationReceivedAt: now,
        locationAccuracy: data.accuracy,
      },
    },
  );
  ensure(
    order,
    409,
    "Sharing stopped, delivery ended, or a newer location is already stored",
  );
  res.sendStatus(204);
}
export async function stop(req, res) {
  const { session } = z.object({ session: z.uuid() }).strict().parse(req.body);
  await Order.updateOne(
    {
      _id: id.parse(req.params.id),
      driver: req.user._id,
      trackingSession: session,
    },
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
  res.sendStatus(204);
}
