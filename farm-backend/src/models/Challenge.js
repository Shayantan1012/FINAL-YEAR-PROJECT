import mongoose from "mongoose";
export const Challenge = mongoose.model(
  "Challenge",
  new mongoose.Schema(
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      purpose: { type: String, enum: ["verify", "reset"], required: true },
      codeHash: { type: String, required: true },
      attempts: { type: Number, default: 0 },
      consumed: { type: Boolean, default: false },
      expiresAt: { type: Date, required: true, expires: 0 },
    },
    { timestamps: true },
  ),
);
