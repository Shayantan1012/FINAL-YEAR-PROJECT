import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { notify } from "./notificationService.js";

const ACTIVE_STATUSES = ["Driver Assigned", "Out for Delivery"];
const LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

export function distanceKm(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLatitude = radians(b.latitude - a.latitude);
  const dLongitude = radians(b.longitude - a.longitude);
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const value =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(dLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function assignNearestDriver(order, session) {
  if (
    order.method !== "delivery" ||
    order.status !== "Ready for Pickup" ||
    order.driver ||
    !order.pickupLocation
  )
    return null;

  const activeDriverIds = await Order.distinct("driver", {
    driver: { $ne: null },
    status: { $in: ACTIVE_STATUSES },
  }).session(session);
  const candidates = await User.find({
    role: "delivery",
    active: true,
    verified: true,
    approved: true,
    deliveryAvailable: true,
    deliveryLocation: { $exists: true },
    deliveryLocationUpdatedAt: {
      $gte: new Date(Date.now() - LOCATION_MAX_AGE_MS),
    },
    _id: { $nin: activeDriverIds },
  }).session(session);
  const ranked = candidates
    .map((driver) => ({
      driver,
      distance: distanceKm(driver.deliveryLocation, order.pickupLocation),
    }))
    .sort((a, b) => a.distance - b.distance);

  for (const candidate of ranked) {
    const reserved = await User.findOneAndUpdate(
      { _id: candidate.driver._id, deliveryAvailable: true },
      { $set: { deliveryAvailable: false } },
      { session, returnDocument: "after" },
    );
    if (!reserved) continue;
    order.driver = reserved._id;
    order.status = "Driver Assigned";
    order.assignedAt = new Date();
    order.assignmentDistanceKm = Math.round(candidate.distance * 10) / 10;
    order.history.push({
      status: "Driver Assigned",
      at: order.assignedAt,
      by: reserved._id,
    });
    await order.save({ session });
    await notify(
      [order.consumer, order.producer, reserved._id],
      "Nearest delivery partner assigned",
      order._id,
      session,
    );
    return reserved;
  }
  return null;
}

export async function assignWaitingDeliveries() {
  const ids = await Order.find({
    method: "delivery",
    status: "Ready for Pickup",
    driver: null,
  })
    .sort({ createdAt: 1 })
    .limit(20)
    .distinct("_id");
  for (const orderId of ids)
    await mongoose.connection.transaction(async (session) => {
      const order = await Order.findOne({
        _id: orderId,
        status: "Ready for Pickup",
        driver: null,
      }).session(session);
      if (order) await assignNearestDriver(order, session);
    });
}

export async function releaseDriver(driverId, session) {
  if (!driverId) return;
  await User.updateOne(
    { _id: driverId, role: "delivery" },
    { $set: { deliveryAvailable: true } },
    { session },
  );
}
