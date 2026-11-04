import mongoose from "mongoose";
import { pointSchema } from "./point.js";
export const Order = mongoose.model(
  "Order",
  new mongoose.Schema(
    {
      consumer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      producer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      farm: String,
      items: [
        {
          _id: false,
          product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
          name: String,
          quantity: Number,
          pricePaise: Number,
        },
      ],
      subtotalPaise: Number,
      deliveryPaise: Number,
      discountPaise: Number,
      totalPaise: Number,
      method: { type: String, enum: ["delivery", "pickup"], required: true },
      address: String,
      recipientName: String,
      recipientPhone: String,
      deliveryInstructions: String,
      pickupAddress: String,
      pickupLocation: { type: pointSchema },
      destinationLocation: { type: pointSchema },
      trackingSession: { type: String, select: false },
      trackingAuthSession: {
        type: mongoose.Schema.Types.ObjectId,
        select: false,
      },
      driverLocation: { type: pointSchema },
      assignedAt: Date,
      assignmentDistanceKm: Number,
      locationRecordedAt: Date,
      locationReceivedAt: Date,
      locationAccuracy: Number,
      slot: String,
      payment: { type: String, enum: ["cod", "pickup"], required: true },
      paymentStatus: {
        type: String,
        enum: ["due", "collected", "void"],
        default: "due",
      },
      status: {
        type: String,
        enum: [
          "Pending",
          "Accepted",
          "Preparing",
          "Ready for Pickup",
          "Driver Assigned",
          "Out for Delivery",
          "Delivered",
          "Cancelled",
        ],
        default: "Pending",
      },
      cancellationReason: String,
      handoverCode: { type: String, select: false },
      handoverAttempts: { type: Number, default: 0 },
      history: [
        {
          _id: false,
          status: String,
          at: Date,
          by: mongoose.Schema.Types.ObjectId,
        },
      ],
    },
    { timestamps: true },
  ),
);
export function publicOrder(o, user) {
  const raw = o.toObject ? o.toObject() : { ...o };
  const {
    _id,
    __v,
    handoverCode,
    handoverAttempts,
    trackingSession,
    trackingAuthSession,
    driverLocation,
    locationRecordedAt,
    locationReceivedAt,
    locationAccuracy,
    ...rest
  } = raw;
  return {
    id: String(_id),
    ...rest,
    ...(user &&
    String(raw.consumer) === String(user._id) &&
    !["Cancelled", "Delivered"].includes(raw.status)
      ? { handoverCode }
      : {}),
  };
}
