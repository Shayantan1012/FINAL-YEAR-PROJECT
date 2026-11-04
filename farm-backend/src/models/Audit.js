import mongoose from "mongoose";
export const Audit = mongoose.model(
  "Audit",
  new mongoose.Schema(
    {
      actor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      action: { type: String, required: true },
      target: { type: String, required: true },
    },
    { timestamps: true },
  ),
);
