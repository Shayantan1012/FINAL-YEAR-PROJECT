import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { connectDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { User } from "../src/models/User.js";
import { Product } from "../src/models/Product.js";
import { Order } from "../src/models/Order.js";
import { Challenge } from "../src/models/Challenge.js";
import { hashPassword } from "../src/lib/security.js";
import sharp from "sharp";
let replica,
  app,
  consumer,
  other,
  producer,
  producer2,
  driver,
  admin,
  unapproved,
  p1,
  p2;
const password = "Test-password-only-2026!";
async function account(role, email, approved = true) {
  const user = await User.create({
    name: role,
    email,
    role,
    passwordHash: await hashPassword(password),
    verified: true,
    approved,
    farmName: role === "producer" ? "Test Farm" : "",
  });
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password })
    .expect(200);
  return { user, token: response.body.accessToken };
}
const auth = (r, account) => r.set("Authorization", "Bearer " + account.token);
const productData = () => ({
  name: "Fresh tomatoes",
  category: "Vegetables",
  method: "Organic",
  price: 40,
  stock: 20,
  location: "Kolkata",
  pickupLocation: { latitude: 22.57, longitude: 88.36 },
  harvest: new Date().toISOString().slice(0, 10),
});
const orderData = (items, method = "delivery") => ({
  items,
  method,
  address: "24 Lake Road, Kolkata 700029",
  destinationLocation: { latitude: 22.51, longitude: 88.35 },
  recipientName: "Test recipient",
  recipientPhone: "+919876543210",
  deliveryInstructions: "Call at the gate",
  ...(method === "pickup" ? { slot: (() => { const date = new Date(Date.now() + 3 * 86400000); date.setUTCHours(6, 30, 0, 0); return date.toISOString(); })() } : {}),
  coupon: "FRESH10",
});
const place = (who, data, key) =>
  auth(request(app).post("/api/orders"), who)
    .set("Idempotency-Key", key)
    .send(data);
before(
  async () => {
    replica = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await connectDatabase(replica.getUri("harvest_test"));
    app = createApp({
      ...configFromEnv({ NODE_ENV: "test", EXPOSE_DEV_OTP: "true" }),
      sessionDays: 1,
    });
    consumer = await account("consumer", "consumer@test.example");
    other = await account("consumer", "other@test.example");
    producer = await account("producer", "producer@test.example");
    producer2 = await account("producer", "producer2@test.example");
    driver = await account("delivery", "delivery@test.example");
    admin = await account("administrator", "admin@test.example");
    unapproved = await account("producer", "pending@test.example", false);
    p1 = (
      await auth(request(app).post("/api/products"), producer)
        .send(productData())
        .expect(201)
    ).body.product;
    p2 = (
      await auth(request(app).post("/api/products"), producer2)
        .send({ ...productData(), name: "Spinach", price: 35 })
        .expect(201)
    ).body.product;
  },
  { timeout: 240000 },
);
after(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});

test("selected pin reverse lookup fills an address through the authenticated API", async () => {
  const realFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async (url, options) => {
    providerCalls++;
    assert.equal(new URL(url).searchParams.get("lat"), "23.547248");
    assert.equal(new URL(url).searchParams.get("lon"), "87.289631");
    assert.match(options.headers["User-Agent"], /HarvestMarketplace/);
    return { ok: true, json: async () => ({ display_name: "NIT Durgapur, Durgapur, West Bengal, India" }) };
  };
  const path = "/api/location/reverse?latitude=23.547248&longitude=87.289631";
  try {
    await request(app).get(path).expect(401);
    await auth(request(app).get(path), driver).expect(403);
    await auth(request(app).get("/api/location/reverse?latitude=abc&longitude=87"), consumer).expect(400);
    const first = await auth(request(app).get(path), consumer).expect(200);
    assert.equal(first.body.address, "NIT Durgapur, Durgapur, West Bengal, India");
    assert.match(first.body.attribution, /OpenStreetMap contributors/);
    const second = await auth(request(app).get(path), producer).expect(200);
    assert.equal(second.body.address, first.body.address);
    assert.equal(providerCalls, 1, "repeat pin uses the cached provider result");
  } finally {
    global.fetch = realFetch;
  }
});

test("registration, OTP, account recovery, logout and privilege checks", async () => {
  await request(app)
    .post("/api/auth/register")
    .send({
      name: "Hacker",
      email: "hacker@test.example",
      password,
      role: "administrator",
    })
    .expect(400);
  const registration = await request(app)
    .post("/api/auth/register")
    .send({
      name: "New Buyer",
      address: "12 Test Road", city: "Kolkata", state: "West Bengal", postalCode: "700029",
      phone: "+91 98765 43210",
      email: "new@test.example",
      password,
      role: "consumer",
      language: "bn",
    })
    .expect(201);
  assert.equal(registration.body.user.passwordHash, undefined);
  assert.equal(registration.body.user.language, "bn");
  assert.equal(registration.body.user.city, "Kolkata");
  assert.equal((await User.findOne({ email: "new@test.example" })).postalCode, "700029");
  assert.equal(registration.body.user.phone, "+919876543210");
  assert.equal((await User.findOne({ email: "new@test.example" })).phone, "+919876543210");
  await request(app)
    .post("/api/auth/login")
    .send({ email: "new@test.example", password })
    .expect(403);
  const verified = await request(app)
    .post("/api/auth/verify")
    .send({
      challengeId: registration.body.challengeId,
      code: registration.body.developmentCode,
    })
    .expect(200);
  await request(app)
    .post("/api/auth/verify")
    .send({
      challengeId: registration.body.challengeId,
      code: registration.body.developmentCode,
    })
    .expect(400);
  const session = { token: verified.body.accessToken };
  const language = await auth(request(app).patch("/api/users/me"), session)
    .send({ language: "ta" })
    .expect(200);
  assert.equal(language.body.user.language, "ta");
  await auth(request(app).patch("/api/users/me"), session)
    .send({ role: "administrator" })
    .expect(400);
  const reset = await request(app)
    .post("/api/auth/request-code")
    .send({ email: "new@test.example", purpose: "reset" })
    .expect(202);
  await request(app)
    .post("/api/auth/reset-password")
    .send({
      challengeId: reset.body.challengeId,
      code: reset.body.developmentCode,
      password: "Changed-password-2026!",
    })
    .expect(200);
  await auth(request(app).get("/api/users/me"), session).expect(401);
  const logged = await request(app)
    .post("/api/auth/login")
    .send({ email: "new@test.example", password: "Changed-password-2026!" })
    .expect(200);
  await auth(request(app).post("/api/auth/logout"), {
    token: logged.body.accessToken,
  }).expect(204);
  await auth(request(app).get("/api/users/me"), {
    token: logged.body.accessToken,
  }).expect(401);
});
test("catalog validation, role ownership and administrator approval", async () => {
  await request(app).post("/api/products").send(productData()).expect(401);
  await auth(request(app).post("/api/products"), consumer)
    .send(productData())
    .expect(403);
  await auth(request(app).post("/api/products"), unapproved)
    .send(productData())
    .expect(403);
  await auth(request(app).patch("/api/products/" + p1.id), producer2)
    .send({ price: 1 })
    .expect(403);
  await auth(request(app).post("/api/products"), producer)
    .send({ ...productData(), stock: -1 })
    .expect(400);
  await auth(request(app).post("/api/products"), producer)
    .send({ ...productData(), harvest: "2026-02-30" })
    .expect(400);
  await auth(request(app).post("/api/products"), producer)
    .send({
      ...productData(),
      harvest: "2026-01-01",
      expiry: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    })
    .expect(400);
  const result = await request(app)
    .get("/api/products?q=spinach&maxPrice=36")
    .expect(200);
  assert.equal(result.body.products.length, 1);
  await request(app).get("/api/products/not-an-id").expect(400);
  await auth(
    request(app).patch("/api/admin/users/" + unapproved.user.id),
    admin,
  )
    .send({ approved: true })
    .expect(200);
  await auth(request(app).post("/api/products"), unapproved)
    .send({ ...productData(), name: "Approved greens" })
    .expect(201);
  await auth(request(app).get("/api/admin/users"), consumer).expect(403);
});
test("slot quotes reflect distance and pickup preparation, and checkout validates timing and contact", async () => {
  const items = [{ productId: p1.id, quantity: 1 }];
  const pickup = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({ items, method: "pickup" })
      .expect(200)
  ).body;
  const near = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({
        items,
        method: "delivery",
        destinationLocation: { latitude: 22.58, longitude: 88.37 },
      })
      .expect(200)
  ).body;
  const far = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({
        items,
        method: "delivery",
        destinationLocation: { latitude: 23.3, longitude: 88.8 },
      })
      .expect(200)
  ).body;
  assert.equal(pickup.serviceHours, "09:00–19:00 IST");
  assert.ok(new Date(pickup.minimumSlot) >= new Date(Date.now() + 3 * 3600000));
  assert.equal(near.available, false);
  assert.equal(near.minimumSlot, null);
  assert.ok(far.distanceKm > near.distanceKm);
  assert.equal(far.minimumSlot, null);
  const availablePartner = await account("delivery", "quote-partner@test.example");
  await auth(request(app).put("/api/deliveries/me/location"), availablePartner)
    .send({
      location: { latitude: 22.571, longitude: 88.361 },
      available: true,
    })
    .expect(200);
  const withPartner = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({
        items,
        method: "delivery",
        destinationLocation: { latitude: 22.58, longitude: 88.37 },
      })
      .expect(200)
  ).body;
  assert.equal(withPartner.availablePartners, 1);
  assert.equal(withPartner.available, true);
  assert.ok(new Date(withPartner.minimumSlot) > new Date());
  const farWithPartner = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({
        items,
        method: "delivery",
        destinationLocation: { latitude: 23.3, longitude: 88.8 },
      })
      .expect(200)
  ).body;
  assert.ok(new Date(farWithPartner.minimumSlot) >= new Date(withPartner.minimumSlot));
  await auth(
    request(app).patch("/api/deliveries/me/availability"),
    availablePartner,
  )
    .send({ available: false })
    .expect(200);
  await place(consumer, orderData(items), "offline-delivery").expect(409);
  await place(consumer,
    { ...orderData(items), slot: new Date(Date.now() + 3600000).toISOString() },
    "manual-delivery-slot",
  ).expect(400);
  await place(
    consumer,
    { ...orderData(items), recipientPhone: "123" },
    "invalid-recipient-phone",
  ).expect(400);
  await place(
    consumer,
    { ...orderData(items), recipientName: "" },
    "missing-recipient-name",
  ).expect(400);
  await auth(request(app).put("/api/deliveries/me/location"), driver)
    .send({ location: { latitude: 22.572, longitude: 88.363 }, available: true })
    .expect(200);
  await auth(request(app).patch("/api/deliveries/me/availability"), availablePartner)
    .send({ available: true })
    .expect(200);
  const remoteProduct = (
    await auth(request(app).post("/api/products"), producer2)
      .send({
        ...productData(),
        name: "Remote matching sample",
        pickupLocation: { latitude: 23.3, longitude: 88.8 },
      })
      .expect(201)
  ).body.product;
  const multiFarmQuote = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({
        items: [...items, { productId: remoteProduct.id, quantity: 1 }],
        method: "delivery",
        destinationLocation: { latitude: 22.58, longitude: 88.37 },
      })
      .expect(200)
  ).body;
  assert.equal(multiFarmQuote.requiredPartners, 2);
  assert.equal(multiFarmQuote.availablePartners, 1);
  assert.equal(multiFarmQuote.available, false);
  await Product.deleteOne({ _id: remoteProduct.id });
});
test("multi-farm checkout calculates prices, reserves stock, retries safely and restores stock once", async () => {
  const data = orderData([
    { productId: p1.id, quantity: 1 },
    { productId: p2.id, quantity: 1 },
  ]);
  const estimate = (
    await auth(request(app).post("/api/orders/slot-quote"), consumer)
      .send({
        items: data.items,
        method: "delivery",
        destinationLocation: data.destinationLocation,
      })
      .expect(200)
  ).body;
  assert.equal(estimate.requiredPartners, 2);
  assert.equal(estimate.available, true);
  const placed = await place(consumer, data, "checkout-001").expect(201);
  assert.equal(placed.body.orders.length, 2);
  assert.ok(placed.body.orders.every((order) => order.slot === placed.body.orders[0].slot));
  assert.ok(new Date(placed.body.orders[0].slot) > new Date());
  assert.ok(
    Math.abs(Date.parse(placed.body.orders[0].slot) - Date.parse(estimate.minimumSlot)) <= 30 * 60000,
    "checkout recalculates an ETA close to the live quote",
  );
  assert.equal(placed.body.totalPaise, 10250);
  assert.equal(
    placed.body.orders.reduce((n, o) => n + o.totalPaise, 0),
    10250,
  );
  assert.equal((await Product.findById(p1.id)).stock, 19);
  const retried = await place(consumer, data, "checkout-001").expect(200);
  assert.equal(retried.body.replayed, true);
  assert.equal((await Product.findById(p1.id)).stock, 19);
  await place(consumer, { ...data, coupon: "" }, "checkout-001").expect(409);
  await place(consumer, { ...data, totalPaise: 1 }, "tampered-total").expect(
    400,
  );
  const order = placed.body.orders.find((o) => o.producer === producer.user.id);
  await auth(request(app).get("/api/orders/" + order.id), other).expect(404);
  const own = await auth(
    request(app).get("/api/orders/" + order.id),
    producer,
  ).expect(200);
  assert.equal(own.body.order.handoverCode, undefined);
  assert.equal(own.body.order.recipientName, "Test recipient");
  assert.equal(own.body.order.recipientPhone, "+919876543210");
  assert.equal(own.body.order.deliveryInstructions, "Call at the gate");
  await auth(request(app).post("/api/orders/" + order.id + "/cancel"), consumer)
    .send({ reason: "Plans have changed" })
    .expect(200);
  await auth(request(app).get("/api/orders/" + order.id + "/tracking"), consumer)
    .expect(410);
  await auth(request(app).post("/api/orders/" + order.id + "/cancel"), consumer)
    .send({ reason: "Plans have changed" })
    .expect(200);
  assert.equal((await Product.findById(p1.id)).stock, 20);
});
test("failed checkout rolls back every stock reservation and concurrent buyers cannot oversell", async () => {
  const before = (await Product.findById(p1.id)).stock;
  await place(
    consumer,
    orderData([
      { productId: p1.id, quantity: 1 },
      { productId: p2.id, quantity: 999 },
    ]),
    "rollback-check",
  ).expect(409);
  assert.equal((await Product.findById(p1.id)).stock, before);
  const limited = await Product.create({
    producer: producer.user._id,
    name: "Last carrot",
    farm: "Test Farm",
    category: "Roots & tubers",
    method: "Organic",
    pricePaise: 5500,
    stock: 1,
    location: "Kolkata",
    pickupLocation: { latitude: 22.57, longitude: 88.36 },
    harvest: new Date().toISOString().slice(0, 10),
  });
  const data = orderData([{ productId: limited.id, quantity: 1 }]);
  const results = await Promise.all([
    place(consumer, data, "race-one"),
    place(other, data, "race-two"),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await Product.findById(limited.id)).stock, 0);
});
test("simultaneous retries create one checkout and pickup requires the consumer code", async () => {
  const stockBefore = (await Product.findById(p1.id)).stock;
  const data = orderData([{ productId: p1.id, quantity: 1 }], "pickup");
  const results = await Promise.all([
    place(consumer, data, "same-key-race"),
    place(consumer, data, "same-key-race"),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.orders[0].id, results[1].body.orders[0].id);
  assert.equal((await Product.findById(p1.id)).stock, stockBefore - 1);
  const order = results[0].body.orders[0];
  assert.equal(order.deliveryPaise, 0);
  for (const status of ["Accepted", "Preparing", "Ready for Pickup"])
    await auth(
      request(app).patch("/api/orders/" + order.id + "/status"),
      producer,
    )
      .send({ status })
      .expect(200);
  await auth(request(app).post("/api/orders/" + order.id + "/complete"), driver)
    .send({ code: order.handoverCode })
    .expect(409);
  await auth(
    request(app).post("/api/orders/" + order.id + "/complete"),
    producer,
  )
    .send({ code: order.handoverCode })
    .expect(200);
  await auth(
    request(app).post("/api/orders/" + order.id + "/complete"),
    producer,
  )
    .send({ code: order.handoverCode })
    .expect(409);
  await place(
    consumer,
    { ...data, slot: new Date(Date.now() - 1000).toISOString() },
    "past-slot-test",
  ).expect(400);
});
test("delivery enforces status transitions, driver ownership, OTP and verified reviews", async () => {
  const placed = await place(
    consumer,
    orderData([{ productId: p1.id, quantity: 1 }]),
    "delivery-flow",
  ).expect(201);
  const order = placed.body.orders[0];
  await auth(request(app).post("/api/reviews"), consumer)
    .send({
      orderId: order.id,
      productId: p1.id,
      rating: 5,
      text: "Fresh produce",
    })
    .expect(403);
  await User.updateMany(
    { email: { $in: ["delivery@test.example", "quote-partner@test.example"] } },
    { $set: { deliveryAvailable: false } },
  );
  await auth(
    request(app).patch("/api/orders/" + order.id + "/status"),
    producer,
  )
    .send({ status: "Preparing" })
    .expect(409);
  for (const status of ["Accepted", "Preparing", "Ready for Pickup"])
    await auth(
      request(app).patch("/api/orders/" + order.id + "/status"),
      producer,
    )
      .send({ status })
      .expect(200);
  const jobs = await auth(
    request(app).get("/api/deliveries/available"),
    driver,
  ).expect(200);
  assert.equal(
    jobs.body.deliveries.find((o) => o._id === order.id).address,
    undefined,
  );
  await auth(
    request(app).post("/api/deliveries/" + order.id + "/claim"),
    driver,
  ).expect(200);
  await auth(
    request(app).post("/api/deliveries/" + order.id + "/claim"),
    driver,
  ).expect(409);
  await auth(
    request(app).post("/api/orders/" + order.id + "/complete"),
    producer,
  )
    .send({ code: order.handoverCode })
    .expect(409);
  await auth(request(app).post("/api/orders/" + order.id + "/complete"), driver)
    .send({ code: "000000" })
    .expect(400);
  const complete = await auth(
    request(app).post("/api/orders/" + order.id + "/complete"),
    driver,
  )
    .send({ code: order.handoverCode })
    .expect(200);
  assert.equal(complete.body.order.status, "Delivered");
  assert.equal(complete.body.order.paymentStatus, "collected");
  await auth(request(app).post("/api/orders/" + order.id + "/cancel"), consumer)
    .send({ reason: "Too late to cancel" })
    .expect(409);
  await auth(request(app).post("/api/reviews"), other)
    .send({
      orderId: order.id,
      productId: p1.id,
      rating: 1,
      text: "Not my purchase",
    })
    .expect(403);
  await auth(request(app).post("/api/reviews"), consumer)
    .send({
      orderId: order.id,
      productId: p1.id,
      rating: 5,
      text: "Fresh produce",
    })
    .expect(201);
  const review = await request(app)
    .get("/api/products/" + p1.id + "/reviews")
    .expect(200);
  assert.equal(review.body.reviews[0].rating, 5);
  await auth(
    request(app).get("/api/orders/" + order.id + "/receipt"),
    consumer,
  ).expect(200);
});
test("nearest available delivery partner is assigned and busy partners are skipped", async () => {
  await User.updateMany(
    { email: { $in: ["delivery@test.example", "quote-partner@test.example"] } },
    { $set: { deliveryAvailable: false } },
  );
  const near = await account("delivery", "near-driver@test.example");
  const far = await account("delivery", "far-driver@test.example");
  await auth(request(app).put("/api/deliveries/me/location"), near)
    .send({
      location: { latitude: 22.571, longitude: 88.361 },
      available: true,
    })
    .expect(200);
  await auth(request(app).put("/api/deliveries/me/location"), far)
    .send({
      location: { latitude: 22.7, longitude: 88.5 },
      available: true,
    })
    .expect(200);

  const waiting = (
    await place(
      consumer,
      orderData([{ productId: p1.id, quantity: 1 }]),
      "nearest-driver-waiting",
    ).expect(201)
  ).body.orders[0];

  const first = (
    await place(
      consumer,
      orderData([{ productId: p1.id, quantity: 1 }]),
      "nearest-driver-one",
    ).expect(201)
  ).body.orders[0];
  for (const status of ["Accepted", "Preparing", "Ready for Pickup"])
    await auth(
      request(app).patch("/api/orders/" + first.id + "/status"),
      producer,
    )
      .send({ status })
      .expect(200);
  const assignedFirst = await Order.findById(first.id);
  assert.equal(assignedFirst.status, "Driver Assigned");
  assert.equal(String(assignedFirst.driver), String(near.user._id));
  assert.ok(assignedFirst.assignmentDistanceKm < 1);

  const second = (
    await place(
      consumer,
      orderData([{ productId: p2.id, quantity: 1 }]),
      "nearest-driver-two",
    ).expect(201)
  ).body.orders[0];
  for (const status of ["Accepted", "Preparing", "Ready for Pickup"])
    await auth(
      request(app).patch("/api/orders/" + second.id + "/status"),
      producer2,
    )
      .send({ status })
      .expect(200);
  const assignedSecond = await Order.findById(second.id);
  assert.equal(assignedSecond.status, "Driver Assigned");
  assert.equal(String(assignedSecond.driver), String(far.user._id));

  for (const status of ["Accepted", "Preparing", "Ready for Pickup"])
    await auth(
      request(app).patch("/api/orders/" + waiting.id + "/status"),
      producer,
    )
      .send({ status })
      .expect(200);
  assert.equal((await Order.findById(waiting.id)).driver, null);
  const late = await account("delivery", "late-driver@test.example");
  await auth(request(app).put("/api/deliveries/me/location"), late)
    .send({
      location: { latitude: 22.572, longitude: 88.362 },
      available: true,
    })
    .expect(200);
  const assignedWaiting = await Order.findById(waiting.id);
  assert.equal(assignedWaiting.status, "Driver Assigned");
  assert.equal(String(assignedWaiting.driver), String(late.user._id));
  await Order.updateOne(
    { _id: waiting.id },
    {
      $set: {
        trackingSession: "stale-tracking-session",
        driverLocation: { latitude: 22.57, longitude: 88.36 },
        locationRecordedAt: new Date(),
      },
    },
  );
  await auth(
    request(app).post("/api/orders/" + waiting.id + "/cancel"),
    producer,
  )
    .send({ reason: "Cannot fulfil this order" })
    .expect(200);
  await auth(request(app).get("/api/orders/" + waiting.id + "/tracking"), late)
    .expect(410);
  const cancelled = await Order.findById(waiting.id).select("+trackingSession");
  assert.equal(cancelled.trackingSession, undefined);
  assert.equal(cancelled.driverLocation, undefined);
  await auth(request(app).patch("/api/deliveries/me/availability"), late)
    .send({ available: false })
    .expect(200);

  const dashboard = await auth(
    request(app).get("/api/deliveries/dashboard"),
    near,
  ).expect(200);
  assert.equal(dashboard.body.current.id, first.id);
  assert.equal(dashboard.body.available, false);
  await auth(
    request(app).post("/api/deliveries/" + first.id + "/start"),
    near,
  ).expect(200);
  assert.equal((await Order.findById(first.id)).status, "Out for Delivery");
  await auth(request(app).put("/api/deliveries/me/location"), driver)
    .send({ location: { latitude: 22.572, longitude: 88.363 }, available: true })
    .expect(200);
});
test("cart, favourites, messages, tickets and notifications are scoped to the user", async () => {
  await auth(request(app).put("/api/users/me/cart"), consumer)
    .send({ items: [{ productId: p1.id, quantity: 2 }] })
    .expect(200);
  assert.equal(
    (await auth(request(app).get("/api/users/me/cart"), other).expect(200)).body
      .items.length,
    0,
  );
  await auth(
    request(app).put("/api/users/me/favorites/" + p1.id),
    consumer,
  ).expect(204);
  assert.equal(
    (
      await auth(request(app).get("/api/users/me/favorites"), consumer).expect(
        200,
      )
    ).body.products.length,
    1,
  );
  const order = await Order.findOne({
    consumer: consumer.user._id,
    status: "Delivered",
  });
  await auth(
    request(app).post("/api/orders/" + order.id + "/messages"),
    consumer,
  )
    .send({ text: "Thank you for the harvest!" })
    .expect(201);
  await auth(
    request(app).get("/api/orders/" + order.id + "/messages"),
    other,
  ).expect(404);
  const ticket = await auth(request(app).post("/api/tickets"), consumer)
    .send({
      orderId: order.id,
      category: "quality",
      text: "Please check the produce quality.",
    })
    .expect(201);
  await auth(
    request(app).patch("/api/tickets/" + ticket.body.ticket._id + "/resolve"),
    other,
  )
    .send({ resolution: "Cannot resolve this" })
    .expect(403);
  await auth(
    request(app).patch("/api/tickets/" + ticket.body.ticket._id + "/resolve"),
    admin,
  )
    .send({ resolution: "Issue reviewed and resolved" })
    .expect(200);
  assert.equal(
    (await auth(request(app).get("/api/tickets"), other).expect(200)).body
      .tickets.length,
    0,
  );
  const notifications = await auth(
    request(app).get("/api/users/me/notifications"),
    consumer,
  ).expect(200);
  assert.ok(notifications.body.notifications.length);
  await auth(
    request(app).patch(
      "/api/users/me/notifications/" +
        notifications.body.notifications[0]._id +
        "/read",
    ),
    other,
  ).expect(404);
});
test("suspension revokes sessions and expired verification codes cannot be used", async () => {
  await auth(
    request(app).patch("/api/admin/users/" + unapproved.user.id),
    admin,
  )
    .send({ active: false })
    .expect(200);
  await auth(request(app).get("/api/users/me"), unapproved).expect(401);
  const challenge = await Challenge.create({
    user: other.user._id,
    purpose: "reset",
    codeHash: "invalid",
    expiresAt: new Date(Date.now() - 1000),
  });
  await request(app)
    .post("/api/auth/reset-password")
    .send({ challengeId: challenge.id, code: "123456", password })
    .expect(400);
  await request(app)
    .get("/api/products")
    .set("Origin", "https://untrusted.example")
    .expect(403);
  await request(app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send("{broken")
    .expect(400);
  assert.throws(() =>
    configFromEnv({ NODE_ENV: "production", EXPOSE_DEV_OTP: "true" }),
  );
});

test("farmer photo uploads persist, reject invalid files and enforce image ownership", async () => {
  const photo = (
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#335522" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  await request(app).post("/api/images").send({ base64: photo }).expect(401);
  await auth(request(app).post("/api/images"), consumer)
    .send({ base64: photo })
    .expect(403);
  await auth(request(app).post("/api/images"), producer)
    .send({ base64: Buffer.from("not a photo").toString("base64") })
    .expect(400);
  const uploaded = await auth(request(app).post("/api/images"), producer)
    .send({ base64: photo })
    .expect(201);
  assert.match(uploaded.body.image, /^\/api\/images\/[a-f0-9]{24}$/);
  const fetched = await request(app).get(uploaded.body.image).expect(200);
  assert.equal(fetched.headers["content-type"], "image/jpeg");
  assert.equal(fetched.headers["cross-origin-resource-policy"], "cross-origin");
  await auth(request(app).post("/api/products"), producer2)
    .send({ ...productData(), image: uploaded.body.image })
    .expect(403);
  const created = await auth(request(app).post("/api/products"), producer)
    .send({
      ...productData(),
      name: "Farmer uploaded harvest",
      image: uploaded.body.image,
      expiry: "2099-12-31",
    })
    .expect(201);
  const product = created.body.product;
  const detail = await request(app)
    .get("/api/products/" + product.id)
    .expect(200);
  assert.equal(detail.body.product.image, uploaded.body.image);
  await auth(request(app).patch("/api/products/" + product.id), producer)
    .send({ active: false, minOrder: 3, deliveryOptions: ["pickup"] })
    .expect(200);
  const resumed = await auth(
    request(app).patch("/api/products/" + product.id),
    producer,
  )
    .send({ active: true })
    .expect(200);
  assert.equal(
    resumed.body.product.image,
    uploaded.body.image,
    "Pausing or resuming preserves the uploaded photo",
  );
  assert.equal(resumed.body.product.minOrder, 3);
  assert.deepEqual(resumed.body.product.deliveryOptions, ["pickup"]);
  await auth(request(app).patch("/api/products/" + product.id), producer)
    .send({ image: "", expiry: "" })
    .expect(200);
  const cleared = await Product.findById(product.id);
  assert.equal(cleared.image, "");
  assert.equal(cleared.expiry, undefined);
  await auth(
    request(app).delete("/api/products/" + product.id),
    producer2,
  ).expect(403);
  await auth(
    request(app).delete("/api/products/" + product.id),
    producer,
  ).expect(204);
  await request(app)
    .get("/api/products/" + product.id)
    .expect(404);
  const catalog = await request(app)
    .get("/api/products?q=Farmer%20uploaded%20harvest")
    .expect(200);
  assert.equal(catalog.body.products.length, 0);
});

test("tracking snapshots, participant privacy, GPS ownership, freshness and stop races", async () => {
  const product = (
    await auth(request(app).post("/api/products"), producer)
      .send(productData())
      .expect(201)
  ).body.product;
  const input = orderData([{ productId: product.id, quantity: 1 }]);
  await place(
    consumer,
    { ...input, destinationLocation: { latitude: 91, longitude: 0 } },
    "invalid-location",
  ).expect(400);
  const { destinationLocation, ...missing } = input;
  await place(consumer, missing, "missing-location").expect(400);
  const order = (await place(consumer, input, "tracking-flow").expect(201)).body
    .orders[0];
  await User.updateMany(
    { role: "delivery" },
    { $set: { deliveryAvailable: false } },
  );
  const url = "/api/orders/" + order.id + "/tracking";
  await request(app).get(url).expect(401);
  await auth(request(app).get(url), other).expect(404);
  await auth(request(app).get(url), driver).expect(404);
  await auth(request(app).post(url + "/start"), consumer).expect(403);
  await auth(request(app).post(url + "/start"), driver).expect(409);
  await auth(request(app).patch("/api/products/" + product.id), producer)
    .send({ pickupLocation: { latitude: 23, longitude: 89 } })
    .expect(200);
  let tracking = (await auth(request(app).get(url), producer).expect(200)).body;
  assert.deepEqual(
    tracking.pickup,
    product.pickupLocation,
    "order retains original pickup pin",
  );
  assert.deepEqual(tracking.destination, input.destinationLocation);
  assert.equal(tracking.driver, null);
  for (const status of ["Accepted", "Preparing", "Ready for Pickup"])
    await auth(
      request(app).patch("/api/orders/" + order.id + "/status"),
      producer,
    )
      .send({ status })
      .expect(200);
  const available = (
    await auth(request(app).get("/api/deliveries/available"), driver).expect(
      200,
    )
  ).body.deliveries;
  assert.equal(
    available.find((o) => o._id === order.id).destinationLocation,
    undefined,
  );
  await auth(
    request(app).post("/api/deliveries/" + order.id + "/claim"),
    driver,
  ).expect(200);
  const stranger = await account("delivery", "stranger-driver@test.example");
  await auth(request(app).get(url), stranger).expect(404);
  await auth(request(app).post(url + "/start"), stranger).expect(409);
  const { session } = (
    await auth(request(app).post(url + "/start"), driver).expect(200)
  ).body;
  const sample = {
    session,
    point: { latitude: 22.55, longitude: 88.355 },
    accuracy: 8,
    recordedAt: new Date().toISOString(),
  };
  await auth(request(app).put(url + "/location"), stranger)
    .send(sample)
    .expect(409);
  await auth(request(app).put(url + "/location"), driver)
    .send({ ...sample, point: { latitude: 0, longitude: 181 } })
    .expect(400);
  await auth(request(app).put(url + "/location"), driver)
    .send({
      ...sample,
      recordedAt: new Date(Date.now() - 120000).toISOString(),
    })
    .expect(400);
  await auth(request(app).put(url + "/location"), driver)
    .send(sample)
    .expect(204);
  for (const actor of [consumer, producer, driver]) {
    tracking = (await auth(request(app).get(url), actor).expect(200)).body;
    assert.deepEqual(tracking.driver, sample.point);
    assert.equal(tracking.fresh, true);
    assert.equal(tracking.session, undefined);
  }
  const publicOrder = (
    await auth(request(app).get("/api/orders/" + order.id), consumer).expect(
      200,
    )
  ).body.order;
  assert.equal(publicOrder.trackingSession, undefined);
  assert.equal(publicOrder.driverLocation, undefined);
  await auth(request(app).put(url + "/location"), driver)
    .send(sample)
    .expect(409);
  await Order.updateOne(
    { _id: order.id },
    { $set: { locationReceivedAt: new Date(Date.now() - 61000) } },
  );
  assert.equal(
    (await auth(request(app).get(url), consumer).expect(200)).body.fresh,
    false,
  );
  const replacement = (
    await auth(request(app).post(url + "/start"), driver).expect(200)
  ).body.session;
  await auth(request(app).post(url + "/stop"), driver)
    .send({ session })
    .expect(204);
  assert.equal(
    (await auth(request(app).get(url), consumer).expect(200)).body.sharing,
    true,
    "old screen cannot stop replacement session",
  );
  await auth(request(app).put(url + "/location"), driver)
    .send({ ...sample, recordedAt: new Date().toISOString() })
    .expect(409);
  await auth(request(app).post(url + "/stop"), driver)
    .send({ session: replacement })
    .expect(204);
  tracking = (await auth(request(app).get(url), consumer).expect(200)).body;
  assert.equal(tracking.sharing, false);
  assert.equal(tracking.driver, null);
  await auth(request(app).put(url + "/location"), driver)
    .send({
      ...sample,
      session: replacement,
      recordedAt: new Date().toISOString(),
    })
    .expect(409);
  await auth(request(app).post(url + "/start"), driver).expect(200);
  await auth(request(app).post("/api/auth/logout"), driver).expect(204);
  assert.equal(
    (await auth(request(app).get(url), consumer).expect(200)).body.sharing,
    false,
  );
  driver.token = (
    await request(app)
      .post("/api/auth/login")
      .send({ email: driver.user.email, password })
      .expect(200)
  ).body.accessToken;
  const last = (
    await auth(request(app).post(url + "/start"), driver).expect(200)
  ).body.session;
  await auth(request(app).put(url + "/location"), driver)
    .send({ ...sample, session: last, recordedAt: new Date().toISOString() })
    .expect(204);
  await auth(request(app).post("/api/orders/" + order.id + "/complete"), driver)
    .send({ code: order.handoverCode })
    .expect(200);
  for (const actor of [consumer, producer, driver, admin])
    await auth(request(app).get(url), actor).expect(410);
  await auth(request(app).post(url + "/start"), driver).expect(409);
  const map = await request(app).get("/map/").expect(200);
  assert.match(map.text, /Harvest order map/);
  assert.equal(map.headers["x-frame-options"], undefined);
  await request(app).get("/map/leaflet/leaflet.js").expect(200);
});
