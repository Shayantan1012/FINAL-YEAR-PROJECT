import mongoose from "mongoose";
export const AdminControl = mongoose.model(
  "AdminControl",
  new mongoose.Schema({
    _id: String,
    initialized: { type: Boolean, default: false },
    revision: { type: Number, default: 0 },
  }),
);
