import mongoose from "mongoose";
export const Ticket = mongoose.model(
  "Ticket",
  new mongoose.Schema(
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
      category: {
        type: String,
        enum: [
          "quality",
          "quantity",
          "payment",
          "delivery",
          "account",
          "other",
        ],
        default: "other",
      },
      text: { type: String, required: true },
      status: { type: String, enum: ["Open", "Resolved"], default: "Open" },
      resolution: { type: String, default: "" },
    },
    { timestamps: true },
  ),
);
