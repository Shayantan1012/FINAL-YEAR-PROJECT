import mongoose from "mongoose";
import { connectDatabase } from "../src/db.js";
import { createAdministrator } from "../src/services/adminAccessService.js";
import { email, password, text } from "../src/lib/validation.js";
const input = {
  email: email.parse(process.env.ADMIN_EMAIL),
  password: password.parse(process.env.ADMIN_PASSWORD),
  name: text(2, 100).parse(process.env.ADMIN_NAME || "Harvest Administrator"),
};
try {
  await connectDatabase(process.env.MONGODB_URI);
  await createAdministrator(input);
  console.log("Administrator account created.");
} finally {
  await mongoose.disconnect();
}
