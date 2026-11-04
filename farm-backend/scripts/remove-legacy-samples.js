// One-time migration; exact legacy owner/name/photo matches only. No seeding.
import mongoose from "mongoose";
import { connectDatabase } from "../src/db.js";
import { User } from "../src/models/User.js";
import { Product } from "../src/models/Product.js";
const samples = [
  ["producer@harvest.test", "Fresh vine tomatoes", "1546094096-0df4bcaaa337"],
  ["sunrise@harvest.test", "Tender baby spinach", "1576045057995-568f588f82fb"],
  ["producer@harvest.test", "Farm fresh carrots", "1447175008436-054170c2e979"],
  ["meadow@harvest.test", "Green broccoli", "1459411621453-7b03977f4bfc"],
  ["sunrise@harvest.test", "Golden potatoes", "1518977676601-b53f82aba655"],
  ["meadow@harvest.test", "Garden bell peppers", "1563565375-f3fdfdbefa83"],
];
try {
  await connectDatabase(process.env.MONGODB_URI);
  let count = 0;
  for (const [email, name, photo] of samples) {
    const owner = await User.findOne({ email, role: "producer" });
    if (!owner) continue;
    const filter = {
      producer: owner._id,
      name,
      image:
        "https://images.unsplash.com/photo-" +
        photo +
        "?w=700&auto=format&fit=crop",
      deleted: false,
    };
    if (process.argv.includes("--apply"))
      count += (
        await Product.updateMany(filter, {
          $set: { deleted: true, active: false },
        })
      ).modifiedCount;
    else count += await Product.countDocuments(filter);
  }
  console.log(
    process.argv.includes("--apply")
      ? count + " legacy sample listings removed from the marketplace."
      : count +
          " legacy sample listings matched. Run with --apply to remove them.",
  );
} catch (error) {
  console.error(
    "Cannot connect or complete cleanup (" +
      error.name +
      "). No database credentials were printed.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
