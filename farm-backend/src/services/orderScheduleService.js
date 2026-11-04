import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { distanceKm } from "./deliveryAssignmentService.js";
import { ensure } from "../lib/errors.js";

const HOUR = 3600000;
const IST_OFFSET = 5.5 * HOUR;
const MAX_LOCATION_AGE = 30 * 60 * 1000;
const SLOT_INTERVAL = 30 * 60 * 1000;

export function inServiceHours(date) {
  const hours = ((date.getTime() + IST_OFFSET) % (24 * HOUR)) / HOUR;
  return hours >= 9 && hours <= 19 && hours % 0.5 === 0;
}

function nextServiceSlot(timestamp) {
  let time = Math.ceil(timestamp / SLOT_INTERVAL) * SLOT_INTERVAL;
  for (let attempts = 0; attempts < 60; attempts++) {
    const date = new Date(time);
    if (inServiceHours(date)) return date;
    time += SLOT_INTERVAL;
  }
  throw new Error("No available service slot");
}

export async function quoteOrderSlot(input, { session } = {}) {
  const products = await Product.find({
    _id: { $in: input.items.map(({ productId }) => productId) },
  })
    .select("_id producer pickupLocation deliveryOptions active deleted stock minOrder expiry")
    .session(session || null);
  ensure(products.length === input.items.length, 409, "An item is unavailable");
  const locations = new Map();
  const producerIds = new Set();
  for (const line of input.items) {
    const product = products.find((item) => String(item._id) === line.productId);
    ensure(
      product &&
        product.active &&
        !product.deleted &&
        product.stock >= line.quantity &&
        line.quantity >= product.minOrder &&
        (!product.expiry || product.expiry >= new Date().toISOString().slice(0, 10)) &&
        product.deliveryOptions.includes(input.method) &&
        product.pickupLocation,
      409,
      "An item is unavailable for the selected delivery method",
    );
    producerIds.add(String(product.producer));
    locations.set(
      `${product.producer}:${product.pickupLocation.latitude}:${product.pickupLocation.longitude}`,
      product.pickupLocation,
    );
  }
  const activeGrowers = await User.countDocuments({
    _id: { $in: [...producerIds] },
    role: "producer",
    active: true,
    verified: true,
    approved: true,
  }).session(session || null);
  ensure(activeGrowers === producerIds.size, 409, "A farm is currently unavailable");
  const pickups = [...locations.values()];
  let distance = 0;
  let partnerCount = 0;
  let partnerTravelKm = 0;
  if (input.method === "delivery") {
    ensure(input.destinationLocation, 400, "Select a delivery destination pin");
    distance = Math.max(
      ...pickups.map((pickup) => distanceKm(pickup, input.destinationLocation)),
    );
    const activeDrivers = await Order.distinct("driver", {
      driver: { $ne: null },
      status: { $in: ["Driver Assigned", "Out for Delivery"] },
    }).session(session || null);
    const candidates = await User.find({
      role: "delivery",
      active: true,
      verified: true,
      approved: true,
      deliveryAvailable: true,
      deliveryLocation: { $exists: true },
      deliveryLocationUpdatedAt: {
        $gte: new Date(Date.now() - MAX_LOCATION_AGE),
      },
      _id: { $nin: activeDrivers },
    })
      .select("deliveryLocation")
      .session(session || null);
    const choices = pickups.map((pickup) =>
      candidates
        .map((driver, index) => ({
          index,
          km: distanceKm(driver.deliveryLocation, pickup),
        }))
        .filter((candidate) => candidate.km <= 30)
        .sort((a, b) => a.km - b.km),
    );
    // Match a different nearby partner to each pickup point. Two partners
    // near one farm cannot cover another farm outside their service area.
    const assigned = new Map();
    const match = (pickupIndex, visited) => {
      for (const candidate of choices[pickupIndex]) {
        if (visited.has(candidate.index)) continue;
        visited.add(candidate.index);
        const previous = assigned.get(candidate.index);
        if (previous === undefined || match(previous, visited)) {
          assigned.set(candidate.index, pickupIndex);
          return true;
        }
      }
      return false;
    };
    for (const pickupIndex of choices
      .map((_, index) => index)
      .sort((a, b) => choices[a].length - choices[b].length))
      if (match(pickupIndex, new Set())) partnerCount++;
    partnerTravelKm = Math.max(
      0,
      ...[...assigned].map(([driverIndex, pickupIndex]) =>
        distanceKm(candidates[driverIndex].deliveryLocation, pickups[pickupIndex]),
      ),
    );
  }
  const available = input.method === "pickup" || partnerCount >= pickups.length;
  // Farm preparation, the nearest available rider's trip to the farm, and
  // the farm-to-customer route all contribute to the automatic delivery ETA.
  const leadMinutes = input.method === "pickup"
    ? 3 * 60
    : Math.max(
        90,
        75 + Math.ceil((partnerTravelKm / 20) * 60) +
          Math.ceil((distance * 1.35 / 25) * 60) +
          (pickups.length - 1) * 20,
      );
  const minimumSlot = available
    ? nextServiceSlot(Date.now() + leadMinutes * 60000)
    : null;
  if (minimumSlot)
    ensure(
      minimumSlot.getTime() < Date.now() + 7 * 24 * HOUR,
      409,
      "No delivery time is available within the next seven days for this distance",
    );
  return {
    minimumSlot: minimumSlot?.toISOString() ?? null,
    maximumSlot: new Date(Date.now() + 7 * 24 * HOUR).toISOString(),
    distanceKm: Math.round(distance * 10) / 10,
    availablePartners: partnerCount,
    requiredPartners: input.method === "delivery" ? pickups.length : 0,
    available,
    estimatedMinutes: minimumSlot
      ? Math.ceil((minimumSlot.getTime() - Date.now()) / 60000)
      : null,
    method: input.method,
    serviceHours: "09:00–19:00 IST",
    estimateOnly: true,
  };
}
