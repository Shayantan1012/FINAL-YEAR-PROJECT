import mongoose from "mongoose";
import { pointSchema } from "./point.js";
const schema = new mongoose.Schema(
  {
    producer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    farm: { type: String, required: true },
    category: { type: String, required: true },
    method: { type: String, required: true },
    pricePaise: { type: Number, min: 1, required: true },
    stock: { type: Number, min: 0, required: true },
    minOrder: { type: Number, min: 1, default: 1 },
    unit: { type: String, enum: ["kg"], default: "kg" },
    location: { type: String, required: true },
    pickupLocation: { type: pointSchema },
    harvest: { type: String, required: true },
    expiry: String,
    image: { type: String, default: "" },
    active: { type: Boolean, default: true },
    deleted: { type: Boolean, default: false },
    deliveryOptions: { type: [String], default: ["delivery", "pickup"] },
  },
  { timestamps: true },
);
schema.index({ active: 1, deleted: 1, category: 1 });
export const Product = mongoose.model("Product", schema);
export function publicProduct(p) {
  const { __v, pricePaise, ...rest } = p.toObject ? p.toObject() : p;
  return { ...rest, id: String(p._id), price: pricePaise / 100 };
}
