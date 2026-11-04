import mongoose from "mongoose";
export const Session = mongoose.model(
  "Session",
  new mongoose.Schema(
    {
      tokenHash: { type: String, required: true, unique: true },
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      expiresAt: { type: Date, required: true, expires: 0 },
    },
    { timestamps: true },
  ),
);
