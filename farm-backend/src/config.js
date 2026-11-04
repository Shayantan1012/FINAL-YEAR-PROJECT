export function configFromEnv(env = process.env) {
  const production = env.NODE_ENV === "production";
  const config = {
    production,
    port: Number(env.PORT || 4000),
    host: env.HOST || "0.0.0.0",
    mongoUri: env.MONGODB_URI,
    reverseGeocodeUrl:
      env.REVERSE_GEOCODE_URL ||
      "https://nominatim.openstreetmap.org/reverse",
    corsOrigins: (env.CORS_ORIGINS || "http://localhost:8081")
      .split(",")
      .map((s) => s.trim()),
    sessionDays: Number(env.SESSION_DAYS || 7),
    exposeOtp: env.EXPOSE_DEV_OTP === "true" && !production,
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: env.SMTP_PORT === "465",
          ...(env.SMTP_USER
            ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
            : {}),
        }
      : null,
    mailFrom: env.MAIL_FROM || "Harvest <no-reply@example.com>",
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("Invalid PORT");
  if (!config.reverseGeocodeUrl.startsWith("https://"))
    throw new Error("REVERSE_GEOCODE_URL must use HTTPS");
  if (
    !Number.isFinite(config.sessionDays) ||
    config.sessionDays < 1 ||
    config.sessionDays > 30
  )
    throw new Error("SESSION_DAYS must be 1–30");
  if (production && (!config.smtp || env.EXPOSE_DEV_OTP === "true"))
    throw new Error("Production requires SMTP and EXPOSE_DEV_OTP=false");
  return config;
}
