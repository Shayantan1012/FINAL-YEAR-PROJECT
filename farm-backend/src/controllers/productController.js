import mongoose from "mongoose";
import { z } from "zod";
import { Product, publicProduct } from "../models/Product.js";
import { User } from "../models/User.js";
import { Review } from "../models/Review.js";
import { Audit } from "../models/Audit.js";
import { id, productInput, text, pagination } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { validateImageOwner } from "./imageController.js";
const today = () => new Date().toISOString().slice(0, 10);
export function availableFilter() {
  return {
    active: true,
    deleted: false,
    stock: { $gt: 0 },
    $or: [{ expiry: { $exists: false } }, { expiry: { $gte: today() } }],
  };
}
export async function listProducts(req, res) {
  const input = z
    .object({
      q: text(0, 100).optional(),
      category: text(0, 50).optional(),
      method: text(0, 50).optional(),
      location: text(0, 100).optional(),
      minPrice: z.coerce.number().min(0).optional(),
      maxPrice: z.coerce.number().min(0).optional(),
      sort: z
        .enum(["newest", "priceAsc", "priceDesc", "freshest"])
        .default("newest"),
      producer: id.optional(),
    })
    .parse(req.query);
  const filter = availableFilter();
  const growers = await User.find({
    role: "producer",
    active: true,
    verified: true,
    approved: true,
  }).select("_id");
  filter.producer = { $in: growers.map((u) => u._id) };
  if (input.producer)
    filter.producer = {
      $in: growers
        .filter((u) => String(u._id) === input.producer)
        .map((u) => u._id),
    };
  const escape = (v) => v.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
  if (input.q)
    filter.$and = [
      {
        $or: ["name", "farm", "location"].map((k) => ({
          [k]: { $regex: escape(input.q), $options: "i" },
        })),
      },
    ];
  for (const key of ["category", "method"])
    if (input[key]) filter[key] = input[key];
  if (input.location)
    filter.location = { $regex: escape(input.location), $options: "i" };
  if (input.minPrice !== undefined || input.maxPrice !== undefined)
    filter.pricePaise = {
      ...(input.minPrice !== undefined
        ? { $gte: Math.round(input.minPrice * 100) }
        : {}),
      ...(input.maxPrice !== undefined
        ? { $lte: Math.round(input.maxPrice * 100) }
        : {}),
    };
  const { page, limit, skip } = pagination(req.query);
  const sort = {
    newest: { createdAt: -1 },
    priceAsc: { pricePaise: 1 },
    priceDesc: { pricePaise: -1 },
    freshest: { harvest: -1 },
  }[input.sort];
  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ ...sort, _id: 1 })
      .skip(skip)
      .limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ products: products.map(publicProduct), page, limit, total });
}
export async function getProduct(req, res) {
  const product = await Product.findOne({
    _id: id.parse(req.params.id),
    deleted: false,
  });
  ensure(product, 404, "Product not found");
  const producer = await User.findOne({
    _id: product.producer,
    active: true,
    approved: true,
    verified: true,
  });
  ensure(producer, 404, "Product not found");
  const stats = await Review.aggregate([
    { $match: { product: product._id } },
    { $group: { _id: null, rating: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  res.json({
    product: {
      ...publicProduct(product),
      rating: stats[0]?.rating || 0,
      reviewCount: stats[0]?.count || 0,
    },
  });
}
export async function ownProducts(req, res) {
  const { page, limit, skip } = pagination(req.query),
    filter = { producer: req.user._id, deleted: false };
  res.json({
    products: (
      await Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
    ).map(publicProduct),
    page,
    limit,
    total: await Product.countDocuments(filter),
  });
}
export async function createProduct(req, res) {
  const data = productInput.parse(req.body);
  await validateImageOwner(data.image, req.user._id);
  ensure(
    !data.expiry || data.expiry >= data.harvest,
    400,
    "Expiry must be on or after harvest",
  );
  ensure(
    !data.expiry || data.expiry >= today(),
    400,
    "Expiry cannot be in the past",
  );
  ensure(data.harvest <= today(), 400, "Harvest date cannot be in the future");
  const { price, ...fields } = data;
  const product = await Product.create({
    ...fields,
    expiry: fields.expiry || undefined,
    pricePaise: Math.round(price * 100),
    producer: req.user._id,
    farm: req.user.farmName,
  });
  res.status(201).json({ product: publicProduct(product) });
}
export async function updateProduct(req, res) {
  const parsed = productInput.partial().parse(req.body);
  // Zod defaults belong to creation. A PATCH must change only submitted keys.
  const data = Object.fromEntries(
    Object.keys(req.body).map((key) => [key, parsed[key]]),
  );
  const productId = id.parse(req.params.id);
  const product = await mongoose.connection.transaction(async (session) => {
    const p = await Product.findOne({ _id: productId, deleted: false }).session(
      session,
    );
    ensure(p, 404, "Product not found");
    ensure(
      req.user.role === "administrator" ||
        String(p.producer) === String(req.user._id),
      403,
      "This listing belongs to another producer",
    );
    const { price, ...fields } = data;
    if (data.image !== undefined)
      await validateImageOwner(data.image, p.producer);
    Object.assign(p, fields);
    if (data.expiry === "") p.expiry = undefined;
    if (price !== undefined) p.pricePaise = Math.round(price * 100);
    ensure(
      !p.expiry || p.expiry >= p.harvest,
      400,
      "Expiry must be on or after harvest",
    );
    if (data.expiry !== undefined)
      ensure(
        !p.expiry || p.expiry >= today(),
        400,
        "Expiry cannot be in the past",
      );
    ensure(p.harvest <= today(), 400, "Harvest date cannot be in the future");
    await p.save({ session });
    if (req.user.role === "administrator")
      await Audit.create(
        [{ actor: req.user._id, action: "product.update", target: productId }],
        { session },
      );
    return p;
  });
  res.json({ product: publicProduct(product) });
}
export async function deleteProduct(req, res) {
  const product = await Product.findOne({
    _id: id.parse(req.params.id),
    deleted: false,
  });
  ensure(product, 404, "Product not found");
  ensure(
    req.user.role === "administrator" ||
      String(product.producer) === String(req.user._id),
    403,
    "This listing belongs to another producer",
  );
  await Product.updateOne(
    { _id: product._id },
    { $set: { deleted: true, active: false } },
  );
  if (req.user.role === "administrator")
    await Audit.create({
      actor: req.user._id,
      action: "product.delete",
      target: String(product._id),
    });
  res.status(204).end();
}
