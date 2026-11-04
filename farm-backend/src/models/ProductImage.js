import mongoose from "mongoose";
export const ProductImage = mongoose.model(
  "ProductImage",
  new mongoose.Schema(
    {
      owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      data: { type: Buffer, required: true, select: false },
      contentType: { type: String, default: "image/jpeg" },
    },
    { timestamps: true },
  ),
);
