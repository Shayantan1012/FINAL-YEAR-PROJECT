import mongoose from "mongoose";
import { pointSchema } from "./point.js";
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["consumer", "producer", "delivery", "administrator"],
      required: true,
    },
    verified: { type: Boolean, default: false },
    previousRole: { type: String, select: false },
    previousApproval: { type: Boolean, select: false },
    approved: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    farmName: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    phone: { type: String, default: "" },
    deliveryAvailable: { type: Boolean, default: false },
    deliveryLocation: { type: pointSchema },
    deliveryLocationUpdatedAt: Date,
    language: {
      type: String,
      enum: ["en", "bn", "hi", "as", "or", "ne", "ta", "te"],
      default: "en",
    },
    notifications: { type: Boolean, default: true },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    deletionRequestedAt: Date,
  },
  { timestamps: true },
);
export const User = mongoose.model("User", schema);
export function publicUser(u) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    verified: u.verified,
    approved: u.approved,
    active: u.active,
    farmName: u.farmName,
    address: u.address,
    city: u.city || "",
    state: u.state || "",
    postalCode: u.postalCode || "",
    phone: u.phone,
    ...(u.role === "delivery"
      ? {
          deliveryAvailable: Boolean(u.deliveryAvailable),
          deliveryLocation: u.deliveryLocation,
          deliveryLocationUpdatedAt: u.deliveryLocationUpdatedAt,
        }
      : {}),
    language: u.language,
    notifications: u.notifications,
    favorites: u.favorites,
    deletionRequestedAt: u.deletionRequestedAt,
  };
}
