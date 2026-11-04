import { z } from "zod";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { Review } from "../models/Review.js";
import { Message } from "../models/Message.js";
import { Ticket } from "../models/Ticket.js";
import { Audit } from "../models/Audit.js";
import { id, text, pagination } from "../lib/validation.js";
import { ensure } from "../lib/errors.js";
import { canAccess } from "../services/orderService.js";
export async function reviews(req, res) {
  const { page, limit, skip } = pagination(req.query);
  res.json({
    reviews: await Review.find({ product: id.parse(req.params.id) })
      .select("rating text reply createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    page,
    limit,
  });
}
export async function createReview(req, res) {
  const input = z
    .object({
      orderId: id,
      productId: id,
      rating: z.number().int().min(1).max(5),
      text: text(3, 2000),
    })
    .strict()
    .parse(req.body);
  const order = await Order.findOne({
    _id: input.orderId,
    consumer: req.user._id,
    status: "Delivered",
    "items.product": input.productId,
  });
  ensure(order, 403, "Only a purchaser of a delivered order may review");
  const review = await Review.findOneAndUpdate(
    { consumer: req.user._id, order: input.orderId, product: input.productId },
    { $set: { rating: input.rating, text: input.text } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  res.status(201).json({ review });
}
export async function replyReview(req, res) {
  const { reply } = z
    .object({ reply: text(3, 2000) })
    .strict()
    .parse(req.body);
  const review = await Review.findById(id.parse(req.params.id));
  ensure(review, 404, "Review not found");
  ensure(
    await Product.exists({ _id: review.product, producer: req.user._id }),
    403,
    "This review is for another producer",
  );
  review.reply = reply;
  await review.save();
  res.json({ review });
}
async function conversationOrder(req) {
  const order = await Order.findById(id.parse(req.params.id));
  ensure(order && canAccess(order, req.user), 404, "Order not found");
  return order;
}
export async function messages(req, res) {
  const order = await conversationOrder(req),
    { page, limit, skip } = pagination(req.query);
  res.json({
    messages: await Message.find({ order: order._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    page,
    limit,
  });
}
export async function sendMessage(req, res) {
  const order = await conversationOrder(req),
    { text: body } = z
      .object({ text: text(1, 2000) })
      .strict()
      .parse(req.body);
  res.status(201).json({
    message: await Message.create({
      order: order._id,
      sender: req.user._id,
      text: body,
    }),
  });
}
export async function tickets(req, res) {
  const { page, limit, skip } = pagination(req.query),
    filter = req.user.role === "administrator" ? {} : { user: req.user._id };
  res.json({
    total: await Ticket.countDocuments(filter),
    tickets: await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    page,
    limit,
  });
}
export async function createTicket(req, res) {
  const input = z
    .object({
      orderId: id.optional(),
      category: z
        .enum([
          "quality",
          "quantity",
          "payment",
          "delivery",
          "account",
          "other",
        ])
        .default("other"),
      text: text(10, 3000),
    })
    .strict()
    .parse(req.body);
  if (input.orderId) {
    const order = await Order.findById(input.orderId);
    ensure(order && canAccess(order, req.user), 404, "Order not found");
  }
  res.status(201).json({
    ticket: await Ticket.create({
      user: req.user._id,
      order: input.orderId,
      category: input.category,
      text: input.text,
    }),
  });
}
export async function resolveTicket(req, res) {
  const { resolution } = z
    .object({ resolution: text(5, 3000) })
    .strict()
    .parse(req.body);
  const ticket = await Ticket.findOneAndUpdate(
    { _id: id.parse(req.params.id) },
    { $set: { status: "Resolved", resolution } },
    { returnDocument: "after" },
  );
  ensure(ticket, 404, "Ticket not found");
  await Audit.create({
    actor: req.user._id,
    action: "ticket.resolve",
    target: String(ticket._id),
  });
  res.json({ ticket });
}
