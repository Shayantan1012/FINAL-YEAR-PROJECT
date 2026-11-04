export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensure(condition, status, message) {
  if (!condition) throw new ApiError(status, message);
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500,
    message = error.message;
  if (error.name === "ZodError") {
    status = 400;
    message = "Invalid input";
  }
  if (error.name === "CastError") {
    status = 400;
    message = "Invalid identifier";
  }
  if (error.name === "ValidationError") {
    status = 400;
    message = "Invalid data";
  }
  if (error.code === 11000) {
    status = 409;
    message = "This record already exists";
  }
  if (status >= 500) {
    message = "An internal error occurred";
    console.error(
      error.name,
      error.code || "",
      error.message?.replace(/mongodb(\+srv)?:\/\/[^\s]+/g, "[database URI]"),
    );
  }
  res.status(status).json({
    error: {
      message,
      ...(error.name === "ZodError"
        ? {
            fields: error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          }
        : {}),
    },
  });
}
