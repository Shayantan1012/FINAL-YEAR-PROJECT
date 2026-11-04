import mongoose from "mongoose";
import { configFromEnv } from "./config.js";
import { connectDatabase } from "./db.js";
import { createApp } from "./app.js";
const config = configFromEnv();
try {
  await connectDatabase(config.mongoUri);
  const server = createApp(config).listen(config.port, config.host, () =>
    console.log("Harvest API listening on port " + config.port),
  );
  server.requestTimeout = 30000;
  server.on("error", async (error) => {
    console.error("Server error:", error.code);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.close(async () => {
      await mongoose.disconnect();
      process.exitCode = 0;
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  console.error(
    "Startup failed:",
    error.message.replace(/mongodb(\+srv)?:\/\/[^\s]+/g, "[database URI]"),
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}
