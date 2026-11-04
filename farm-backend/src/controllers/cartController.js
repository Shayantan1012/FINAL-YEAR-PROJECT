import { z } from "zod";
import { Cart } from "../models/Cart.js";
import { Product, publicProduct } from "../models/Product.js";
import { id, quantity } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { availableFilter } from "./productController.js";
export async function getCart(req, res) {
  const cart = await Cart.findOne({ user: req.user._id }).populate(
    "items.product",
  );
  const items = (cart?.items || []).map((l) => ({
    product: l.product ? publicProduct(l.product) : null,
    quantity: l.quantity,
  }));
  res.json({
    items,
    subtotalPaise: items.reduce(
      (sum, l) => sum + Math.round((l.product?.price || 0) * 100) * l.quantity,
      0,
    ),
  });
}
export async function putCart(req, res) {
  const { items } = z
    .object({
      items: z.array(z.object({ productId: id, quantity }).strict()).max(50),
    })
    .strict()
    .parse(req.body);
  ensure(
    new Set(items.map((i) => i.productId)).size === items.length,
    400,
    "Duplicate products are not allowed",
  );
  for (const line of items) {
    const product = await Product.findOne({
      _id: line.productId,
      ...availableFilter(),
    });
    ensure(
      product &&
        product.stock >= line.quantity &&
        line.quantity >= product.minOrder,
      409,
      "An item is unavailable or has an invalid quantity",
    );
  }
  await Cart.findOneAndUpdate(
    { user: req.user._id },
    {
      $set: {
        items: items.map((l) => ({
          product: l.productId,
          quantity: l.quantity,
        })),
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  return getCart(req, res);
}
