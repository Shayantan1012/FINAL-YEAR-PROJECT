import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    fingerprint: { type: String, required: true },
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
    totalPaise: { type: Number, required: true },
  },
  { timestamps: true },
);
schema.index({ user: 1, key: 1 }, { unique: true });
export const Checkout = mongoose.model("Checkout", schema);
