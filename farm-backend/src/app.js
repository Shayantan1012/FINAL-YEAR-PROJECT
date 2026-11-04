import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { configFromEnv } from "./config.js";
import { ApiError, errorHandler } from "./lib/errors.js";
import { authRoutes } from "./routes/authRoutes.js";
import { userRoutes } from "./routes/userRoutes.js";
import { productRoutes } from "./routes/productRoutes.js";
import { orderRoutes, deliveryRoutes } from "./routes/orderRoutes.js";
import { communityRoutes } from "./routes/communityRoutes.js";
import { adminRoutes, producerRoutes } from "./routes/adminRoutes.js";
import { imageRoutes } from "./routes/imageRoutes.js";
import { mapRoutes } from "./routes/mapRoutes.js";
import { locationRoutes } from "./routes/locationRoutes.js";
export function createApp(config = configFromEnv()) {
  const app = express();
  app.locals.config = config;
  app.disable("x-powered-by");
  app.use(helmet());
  app.use("/map", mapRoutes);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin))
          return callback(null, true);
        callback(new ApiError(403, "Origin is not allowed"));
      },
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use("/api/images", imageRoutes);
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { message: "Too many requests" } },
    }),
  );
  app.get("/health", (_req, res) =>
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
      status: mongoose.connection.readyState === 1 ? "ok" : "unavailable",
      service: "harvest-api",
    }),
  );
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/location", locationRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/deliveries", deliveryRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/producer", producerRoutes);
  app.use("/api", communityRoutes);
  app.use((_req, _res, next) => next(new ApiError(404, "Route not found")));
  app.use(errorHandler);
  return app;
}
