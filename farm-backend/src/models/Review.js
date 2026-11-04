import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    consumer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, required: true },
    reply: String,
  },
  { timestamps: true },
);
schema.index({ consumer: 1, order: 1, product: 1 }, { unique: true });
export const Review = mongoose.model("Review", schema);
