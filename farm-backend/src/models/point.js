import mongoose from "mongoose";
export const pointSchema = new mongoose.Schema(
  {
    latitude: { type: Number, min: -90, max: 90, required: true },
    longitude: { type: Number, min: -180, max: 180, required: true },
  },
  { _id: false },
);
