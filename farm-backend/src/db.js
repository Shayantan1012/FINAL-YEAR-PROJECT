import mongoose from "mongoose";
import "./models/User.js";
import "./models/Session.js";
import "./models/Challenge.js";
import "./models/Product.js";
import "./models/ProductImage.js";
import "./models/Cart.js";
import "./models/Checkout.js";
import "./models/Order.js";
import "./models/Notification.js";
import "./models/Ticket.js";
import "./models/Review.js";
import "./models/Message.js";
import "./models/Audit.js";
import { AdminControl } from "./models/AdminControl.js";

export async function connectDatabase(uri) {
  if (!uri) throw new Error("Set MONGODB_URI in .env (see .env.example)");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    await mongoose.disconnect();
    throw new Error(
      "MongoDB must be a replica set or Atlas cluster for atomic order transactions.",
    );
  }
  for (const model of Object.values(mongoose.models)) await model.init();
  await AdminControl.updateOne(
    { _id: "administrators" },
    { $setOnInsert: { initialized: false, revision: 0 } },
    { upsert: true },
  );
  if (await mongoose.models.User.exists({ role: "administrator" }))
    await AdminControl.updateOne(
      { _id: "administrators" },
      { $set: { initialized: true } },
    );
}
