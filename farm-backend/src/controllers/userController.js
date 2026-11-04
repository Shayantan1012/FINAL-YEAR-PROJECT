import { z } from "zod";
import { User, publicUser } from "../models/User.js";
import { Product, publicProduct } from "../models/Product.js";
import { Notification } from "../models/Notification.js";
import { id, text, pagination, postalCode } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
export function me(req, res) {
  res.json({ user: publicUser(req.user) });
}
export async function updateMe(req, res) {
  const data = z
    .object({
      name: text(2, 100).optional(),
      address: text(0, 500).optional(),
      phone: text(0, 20).optional(),
      farmName: text(2, 100).optional(),
      city: text(0, 100).optional(),
      state: text(0, 100).optional(),
      postalCode: postalCode.optional(),
      language: z
        .enum(["en", "bn", "hi", "as", "or", "ne", "ta", "te"])
        .optional(),
      notifications: z.boolean().optional(),
    })
    .strict()
    .parse(req.body);
  Object.assign(req.user, data);
  await req.user.save();
  res.json({ user: publicUser(req.user) });
}
export async function deleteRequest(req, res) {
  req.user.deletionRequestedAt = new Date();
  await req.user.save();
  res
    .status(202)
    .json({ message: "Account deletion requested for administrator review." });
}
export async function favorites(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const products = await Product.find({
    _id: { $in: req.user.favorites },
    deleted: false,
  })
    .skip(skip)
    .limit(limit);
  res.json({
    products: products.map(publicProduct),
    page,
    limit,
    total: await Product.countDocuments({
      _id: { $in: req.user.favorites },
      deleted: false,
    }),
  });
}
export async function addFavorite(req, res) {
  const productId = id.parse(req.params.id);
  ensure(
    await Product.exists({ _id: productId, deleted: false }),
    404,
    "Product not found",
  );
  await User.updateOne(
    { _id: req.user._id },
    { $addToSet: { favorites: productId } },
  );
  res.status(204).end();
}
export async function removeFavorite(req, res) {
  await User.updateOne(
    { _id: req.user._id },
    { $pull: { favorites: id.parse(req.params.id) } },
  );
  res.status(204).end();
}
export async function notifications(req, res) {
  const { page, limit, skip } = pagination(req.query);
  res.json({
    notifications: await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    page,
    limit,
  });
}
export async function readNotification(req, res) {
  const n = await Notification.findOneAndUpdate(
    { _id: id.parse(req.params.id), user: req.user._id },
    { $set: { read: true } },
    { returnDocument: "after" },
  );
  ensure(n, 404, "Notification not found");
  res.json({ notification: n });
}
