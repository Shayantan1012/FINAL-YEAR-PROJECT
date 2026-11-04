import { z } from "zod";
export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
export const text = (min = 1, max = 200) => z.string().trim().min(min).max(max);
export const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const password = z.string().min(12).max(128);
export const postalCode = z.string().trim().refine(v => v === "" || /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(v), "Enter a valid postal code (2?12 letters or digits)");
export const quantity = z.number().int().min(1).max(10000);
export const point = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export function pagination(query) {
  const { page, limit } = pageQuery.parse(query);
  return { page, limit, skip: (page - 1) * limit };
}
export const productInput = z
  .object({
    name: text(2, 100),
    category: z.enum(["Vegetables", "Leafy greens", "Roots & tubers"]),
    method: z.enum(["Organic", "Naturally grown", "Conventionally grown"]),
    price: z
      .number()
      .positive()
      .max(100000)
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
        "At most two decimal places",
      ),
    stock: z.number().int().min(0).max(100000),
    minOrder: quantity.default(1),
    location: text(2, 200),
    pickupLocation: point,
    harvest: date,
    expiry: z.union([date, z.literal("")]).optional(),
    image: z
      .union([
        z.literal(""),
        z.string().regex(/^\/api\/images\/[a-f0-9]{24}$/),
        z
          .url()
          .max(2000)
          .refine((v) => v.startsWith("https://"), "Use an HTTPS image URL"),
      ])
      .default(""),
    deliveryOptions: z
      .array(z.enum(["delivery", "pickup"]))
      .min(1)
      .max(2)
      .default(["delivery", "pickup"]),
    active: z.boolean().default(true),
  })
  .strict();
