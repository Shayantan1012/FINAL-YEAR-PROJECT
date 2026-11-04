import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connectDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { User } from "../src/models/User.js";
import { Audit } from "../src/models/Audit.js";
import { Product } from "../src/models/Product.js";
import { ProductImage } from "../src/models/ProductImage.js";
import { Order } from "../src/models/Order.js";
import { Checkout } from "../src/models/Checkout.js";
import { Cart } from "../src/models/Cart.js";
import { Message } from "../src/models/Message.js";
import { Review } from "../src/models/Review.js";
import { Notification } from "../src/models/Notification.js";
import { Ticket } from "../src/models/Ticket.js";
import { Session } from "../src/models/Session.js";
import { hashPassword } from "../src/lib/security.js";
let replica, app;
const password = "Admin-test-password-2026!";
const authorize = (call, token) => call.set("Authorization", "Bearer " + token);
async function login(email) {
  return (
    await request(app)
      .post("/api/auth/login")
      .send({ email, password })
      .expect(200)
  ).body.accessToken;
}
before(
  async () => {
    replica = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await connectDatabase(replica.getUri("admin_test"));
    app = createApp(
      configFromEnv({ NODE_ENV: "test", EXPOSE_DEV_OTP: "true" }),
    );
  },
  { timeout: 240000 },
);
after(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
test("one-time setup, controlled delegation, revocation, audit and full business visibility", async () => {
  assert.equal(
    (await request(app).get("/api/auth/admin-setup").expect(200)).body
      .available,
    true,
  );
  const attempts = await Promise.all(
    ["first", "racing"].map((name) =>
      request(app)
        .post("/api/auth/admin-setup")
        .send({ name, email: name + "@test.example", password }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await User.countDocuments({ role: "administrator" }), 1);
  const first = attempts.find((r) => r.status === 201).body.user;
  assert.equal(first.passwordHash, undefined);
  assert.equal(
    (await request(app).get("/api/auth/admin-setup").expect(200)).body
      .available,
    false,
  );
  await request(app)
    .post("/api/auth/admin-setup")
    .send({ name: "later", email: "later@test.example", password })
    .expect(409);
  const firstToken = await login(first.email);
  await request(app).get("/api/admin/dashboard").expect(401);
  const farmer = await User.create({
    name: "Farmer",
    email: "farmer-admin@test.example",
    passwordHash: await hashPassword(password),
    role: "producer",
    verified: true,
    approved: false,
  });
  const farmerToken = await login(farmer.email);
  await authorize(request(app).get("/api/admin/users"), farmerToken).expect(
    403,
  );
  await authorize(request(app).post("/api/admin/administrators"), farmerToken)
    .send({ name: "No", email: "no@test.example", password })
    .expect(403);
  const second = (
    await authorize(request(app).post("/api/admin/administrators"), firstToken)
      .send({ name: "Second Admin", email: "second@test.example", password })
      .expect(201)
  ).body.user;
  const secondToken = await login(second.email);
  await authorize(
    request(app).patch("/api/admin/users/" + first.id + "/admin-access"),
    firstToken,
  )
    .send({ grant: false })
    .expect(400);
  await authorize(
    request(app).patch("/api/admin/users/" + farmer.id + "/admin-access"),
    firstToken,
  )
    .send({ grant: true })
    .expect(200);
  await authorize(request(app).get("/api/admin/users"), farmerToken).expect(
    401,
  );
  const promotedToken = await login(farmer.email);
  await authorize(
    request(app).get("/api/admin/dashboard"),
    promotedToken,
  ).expect(200);
  await authorize(
    request(app).patch("/api/admin/users/" + farmer.id + "/admin-access"),
    firstToken,
  )
    .send({ grant: false })
    .expect(200);
  assert.equal((await User.findById(farmer.id)).role, "producer");
  assert.equal((await User.findById(farmer.id)).approved, false);
  await authorize(request(app).get("/api/admin/users"), promotedToken).expect(
    401,
  );
  const inactive = await User.create({
    name: "Unverified",
    email: "unverified@test.example",
    role: "consumer",
    passwordHash: await hashPassword(password),
  });
  await authorize(
    request(app).patch("/api/admin/users/" + inactive.id + "/admin-access"),
    firstToken,
  )
    .send({ grant: true })
    .expect(400);
  await Product.create({
    producer: farmer._id,
    name: "Hidden produce",
    farm: "Test farm",
    category: "Vegetables",
    method: "Organic",
    pricePaise: 100,
    stock: 0,
    location: "Test location",
    harvest: "2026-01-01",
    active: false,
    deleted: true,
  });
  const products = (
    await authorize(request(app).get("/api/admin/products"), firstToken).expect(
      200,
    )
  ).body;
  assert.equal(products.products.length, 1);
  assert.equal(products.products[0].deleted, true);
  const users = (
    await authorize(
      request(app).get("/api/admin/users?role=producer"),
      firstToken,
    ).expect(200)
  ).body;
  assert.equal(users.total, 1);
  assert.equal(users.users[0].previousRole, undefined);
  await authorize(request(app).get("/api/admin/reviews"), firstToken).expect(
    200,
  );
  await authorize(
    request(app).get("/api/orders?method=delivery"),
    firstToken,
  ).expect(200);
  assert.ok(
    (
      await authorize(request(app).get("/api/admin/audit"), firstToken).expect(
        200,
      )
    ).body.total >= 4,
  );
  assert.equal(
    await Audit.countDocuments({ action: "administrator.initial-setup" }),
    1,
  );
  // Concurrent cross-revocations must leave one active administrator.
  const changes = await Promise.all([
    authorize(
      request(app).patch("/api/admin/users/" + second.id + "/admin-access"),
      firstToken,
    ).send({ grant: false }),
    authorize(
      request(app).patch("/api/admin/users/" + first.id + "/admin-access"),
      secondToken,
    ).send({ grant: false }),
  ]);
  assert.equal(changes.filter((r) => r.status === 200).length, 1);
  assert.equal(
    await User.countDocuments({ role: "administrator", active: true }),
    1,
  );
  // Setup remains permanently closed even if database operators remove all admins.
  await User.deleteMany({ role: "administrator" });
  assert.equal(
    (await request(app).get("/api/auth/admin-setup").expect(200)).body
      .available,
    false,
  );
  await request(app)
    .post("/api/auth/admin-setup")
    .send({ name: "reopen", email: "reopen@test.example", password })
    .expect(409);
});

test("administrator cleanup previews, confirms, removes related data, and keeps administrators", async () => {
  const administrator = await User.create({
    name: "Cleanup Admin",
    email: "cleanup-admin@test.example",
    role: "administrator",
    passwordHash: await hashPassword(password),
    verified: true,
    approved: true,
  });
  const token = await login(administrator.email);
  const farmer = await User.findOne({ email: "farmer-admin@test.example" });
  const product = await Product.create({
    producer: farmer._id,
    name: "Cleanup carrots",
    farm: "Test farm",
    category: "Vegetables",
    method: "Organic",
    pricePaise: 1000,
    stock: 8,
    location: "Test location",
    harvest: "2026-01-01",
  });
  await ProductImage.create({ owner: farmer._id, data: Buffer.from("photo") });
  await Cart.create({ user: farmer._id, items: [{ product: product._id, quantity: 1 }] });
  await User.updateOne({ _id: farmer._id }, { $set: { favorites: [product._id] } });
  const order = await Order.create({
    consumer: farmer._id,
    producer: farmer._id,
    farm: "Test farm",
    method: "delivery",
    payment: "cod",
    status: "Pending",
    items: [{ product: product._id, name: product.name, quantity: 2, pricePaise: 1000 }],
  });
  await Checkout.create({ user: farmer._id, key: "cleanup-test", fingerprint: "abc", orders: [order._id], totalPaise: 2000 });
  await Message.create({ order: order._id, sender: farmer._id, text: "Test message" });
  await Review.create({ order: order._id, consumer: farmer._id, product: product._id, rating: 4, text: "Test review" });
  await Notification.create({ user: farmer._id, order: order._id, text: "Test order notification" });
  await Ticket.create({ user: farmer._id, order: order._id, text: "Test order ticket" });

  await request(app).get("/api/admin/cleanup").expect(401);
  const farmerToken = await login(farmer.email);
  await authorize(request(app).get("/api/admin/cleanup"), farmerToken).expect(403);
  const preview = await authorize(request(app).get("/api/admin/cleanup"), token).expect(200);
  assert.equal(preview.body.counts.orders, 1);
  assert.equal(preview.body.counts.activeOrders, 1);
  assert.equal(preview.body.blocked.products, true);
  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "orders", confirmation: "wrong", password }).expect(400);
  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "orders", confirmation: "DELETE ORDERS", password: "wrong" }).expect(403);
  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "products", confirmation: "DELETE PRODUCTS", password }).expect(409);
  assert.equal(await Order.countDocuments(), 1);

  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "orders", confirmation: "DELETE ORDERS", password }).expect(200);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal(await Checkout.countDocuments(), 0);
  assert.equal(await Message.countDocuments(), 0);
  assert.equal(await Review.countDocuments(), 0);
  assert.equal(await Notification.countDocuments({ order: order._id }), 0);
  assert.equal(await Ticket.countDocuments({ order: order._id }), 0);
  assert.equal((await Product.findById(product._id)).stock, 10);

  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "products", confirmation: "DELETE PRODUCTS", password }).expect(200);
  assert.equal(await Product.countDocuments(), 0);
  assert.equal(await ProductImage.countDocuments(), 0);
  assert.equal(await Cart.countDocuments(), 0);
  assert.deepEqual((await User.findById(farmer._id)).favorites, []);

  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "accounts", confirmation: "DELETE ACCOUNTS", password }).expect(200);
  assert.equal(await User.countDocuments({ role: { $ne: "administrator" } }), 0);
  assert.equal(await User.countDocuments({ role: "administrator" }), 1);
  await authorize(request(app).get("/api/admin/dashboard"), token).expect(200);
  assert.equal(await Audit.countDocuments({ action: /^data\.cleanup\./ }), 3);

  const another = await User.create({ name: "Test Buyer", email: "cleanup-buyer@test.example", role: "consumer", passwordHash: await hashPassword(password) });
  await Notification.create({ user: administrator._id, text: "Old marketplace notice" });
  await Product.create({ producer: another._id, name: "Reset sample", farm: "Test farm", category: "Vegetables", method: "Organic", pricePaise: 100, stock: 1, location: "Test", harvest: "2026-01-01" });
  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "all", confirmation: "DELETE ALL", password }).expect(200);
  assert.equal(await Product.countDocuments(), 0);
  assert.equal(await Notification.countDocuments(), 0);
  assert.equal(await User.countDocuments({ role: "administrator" }), 1);
  assert.equal(await User.countDocuments({ role: { $ne: "administrator" } }), 0);
  assert.equal(await Audit.countDocuments({ action: /^data\.cleanup\./ }), 4);

  const secondToken = await login(administrator.email);
  const onlineDriver = await User.create({
    name: "Online Driver",
    email: "cleanup-driver@test.example",
    role: "delivery",
    passwordHash: await hashPassword(password),
    verified: true,
    approved: true,
    deliveryAvailable: true,
    deliveryLocation: { latitude: 22.57, longitude: 88.36 },
    deliveryLocationUpdatedAt: new Date(),
  });
  const tracked = await Order.create({
    consumer: administrator._id,
    producer: administrator._id,
    driver: administrator._id,
    farm: "Test farm",
    method: "delivery",
    payment: "cod",
    status: "Out for Delivery",
    trackingSession: "active-test-tracking",
    driverLocation: { latitude: 22.57, longitude: 88.36 },
    locationReceivedAt: new Date(),
  });
  const sessionPreview = await authorize(request(app).get("/api/admin/cleanup"), token).expect(200);
  assert.ok(sessionPreview.body.counts.sessions >= 2);
  assert.ok(sessionPreview.body.counts.audit >= 4);
  await authorize(request(app).post("/api/admin/cleanup"), token)
    .send({ scope: "sessions", confirmation: "DELETE SESSIONS", password }).expect(200);
  assert.equal(await Session.countDocuments(), 0);
  assert.equal((await Order.findById(tracked._id).select("+trackingSession")).trackingSession, undefined);
  assert.equal((await User.findById(onlineDriver._id)).deliveryAvailable, false);
  await authorize(request(app).get("/api/admin/dashboard"), token).expect(401);
  await authorize(request(app).get("/api/admin/dashboard"), secondToken).expect(401);

  const newToken = await login(administrator.email);
  const cleared = await authorize(request(app).post("/api/admin/cleanup"), newToken)
    .send({ scope: "audit", confirmation: "DELETE AUDIT", password }).expect(200);
  assert.equal(cleared.body.after.counts.audit, 0);
  assert.equal(await Audit.countDocuments(), 0);
  await authorize(request(app).get("/api/admin/dashboard"), newToken).expect(200);
});
