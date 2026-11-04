# API reference

Base URL: http://localhost:4000/api

Authenticated requests require Authorization: Bearer ACCESS_TOKEN.
JSON errors have the shape { "error": { "message": "...", "fields": [] } }; fields appears for validation errors.
Collection endpoints accept page (default 1) and limit (default 20, maximum 100).
API examples below use MongoDB IDs returned by preceding requests.

## Authentication

| Method | Path                 | Body                                                        |
| ------ | -------------------- | ----------------------------------------------------------- |
| POST   | /auth/register       | name, email, password, role; farmName required for producer |
| POST   | /auth/verify         | challengeId, code                                           |
| POST   | /auth/login          | email, password                                             |
| POST   | /auth/request-code   | email, purpose: verify or reset                             |
| POST   | /auth/reset-password | challengeId, code, password                                 |
| POST   | /auth/logout         | none; authentication required                               |

Roles: consumer, producer, delivery. Administrator accounts cannot be registered through /auth/register. One-time setup uses /auth/admin-setup. Passwords: 12–128 characters. Login and verify return user, accessToken, expiresAt. Save the challengeId from registration/request-code; local-only developmentCode is also returned when enabled.

## Account

| Method     | Path                             | Body / purpose                                                     |
| ---------- | -------------------------------- | ------------------------------------------------------------------ |
| GET/PATCH  | /users/me                        | name, address, phone, farmName, language (en/bn/hi/as/or/ne/ta/te), notifications |
| POST       | /users/me/deletion-request       | administrator review request                                       |
| GET        | /users/me/favorites              | saved products                                                     |
| PUT/DELETE | /users/me/favorites/:productId   | add/remove                                                         |
| GET        | /users/me/notifications          | user notifications                                                 |
| PATCH      | /users/me/notifications/:id/read | mark read                                                          |
| GET/PUT    | /users/me/cart                   | PUT: items array of productId and quantity                         |

PUT cart replaces its contents; an empty array clears it. Checkout validates the submitted items independently and does not automatically clear the saved cart. Clear the saved cart explicitly after receiving a successful checkout response.

## Products

| Method       | Path           | Access                                             |
| ------------ | -------------- | -------------------------------------------------- |
| GET          | /products      | public, available approved-grower listings         |
| GET          | /products/:id  | public product details                             |
| GET          | /products/mine | own producer listings, including paused/zero stock |
| POST         | /products      | approved producer                                  |
| PATCH/DELETE | /products/:id  | owner or administrator                             |

Product fields: name, category (Vegetables / Leafy greens / Roots & tubers), method (Organic / Naturally grown / Conventionally grown), price in rupees, integer stock, location, required pickupLocation {latitude, longitude}, harvest (YYYY-MM-DD), optional expiry, minOrder, HTTPS image URL, active, deliveryOptions array (delivery/pickup). Only kg is currently supported.

Search query: q, category, method, location, minPrice, maxPrice, producer.
Sort: newest, priceAsc, priceDesc, freshest.

## Checkout example

POST /orders, with an Idempotency-Key header such as checkout-20261005-001:

    {
      "items": [
        {"productId": "REPLACE_WITH_PRODUCT_ID", "quantity": 2}
      ],
      "method": "delivery",
      "address": "24 Lake Road, Kolkata 700029",
      "destinationLocation": {"latitude": 22.51, "longitude": 88.35},
      "recipientName": "Asha Das",
      "recipientPhone": "+919876543210",
      "deliveryInstructions": "Call at the gate",
      "slot": "2026-10-31T12:00:00+05:30",
      "coupon": "FRESH10"
    }

Before checkout, POST `/orders/slot-quote` with `items`, `method`, and `destinationLocation` for delivery. It returns `minimumSlot`, `maximumSlot`, straight-line `distanceKm`, `availablePartners` (approved, fresh GPS, not currently assigned, within 30 km of a pickup), and service hours. Pickup allows at least three hours for preparation. Delivery adds an estimated journey time and a larger buffer when no nearby partner is online. Quotes are estimates, not confirmed delivery promises; checkout recalculates them.

Use a 30-minute ISO slot from 09:00 through 19:00 IST, no earlier than `minimumSlot` and within seven days. Recipient name (2–80 characters) and phone (7–15 digits) are required; instructions are optional (up to 300 characters). For pickup, address and destinationLocation may be omitted. Delivery requires both. Coordinates must be numeric latitude -90..90 and longitude -180..180. The server calculates all prices and charges. Unknown price/total/payment fields are rejected. Each producer pickup point gets a separate order.

Keep the same Idempotency-Key when retrying an unchanged request after a timeout. A new checkout needs a new key. A successful retry returns the existing orders without reserving more stock. A changed body with an existing key returns 409.

Response: orders, totalPaise, replayed. Orders contain item price snapshots and the consumer's handoverCode. Keep that code private until handover; producers and drivers cannot retrieve it.

## Orders and delivery

| Method | Path                  | Body / access                            |
| ------ | --------------------- | ---------------------------------------- |
| GET    | /orders               | role-scoped order history                |
| GET    | /orders/:id           | order participants/admin                 |
| GET    | /orders/:id/receipt   | order participants/admin                 |
| POST   | /orders/:id/cancel    | reason; consumer/producer/admin          |
| PATCH  | /orders/:id/status    | status; owning approved producer         |
| GET    | /deliveries/available | approved driver; no consumer address     |
| POST   | /deliveries/:id/claim | approved driver; atomic assignment       |
| POST   | /orders/:id/complete  | code; assigned driver or pickup producer |

Producer transitions: Pending → Accepted → Preparing → Ready for Pickup.
Delivery: driver claim → Out for Delivery → correct code → Delivered.
Pickup: Ready for Pickup → correct code → Delivered.

Consumer cancellation is allowed only in Pending/Accepted. Producer/admin cancellation is allowed before dispatch. Cancellation restores stock once and voids unpaid cash. Five incorrect handover attempts lock completion; a support ticket can be opened, but code reissue/unlock is not implemented.

## Community and support

| Method   | Path                  | Body / access                                             |
| -------- | --------------------- | --------------------------------------------------------- |
| GET      | /products/:id/reviews | public review text/rating                                 |
| POST     | /reviews              | orderId, productId, rating 1–5, text; delivered purchaser |
| PATCH    | /reviews/:id/reply    | reply; product's producer                                 |
| GET/POST | /orders/:id/messages  | POST text; order participants                             |
| GET/POST | /tickets              | POST text, optional orderId, category                     |
| PATCH    | /tickets/:id/resolve  | resolution; administrator                                 |

Ticket categories: quality, quantity, payment, delivery, account, other.
Messages and notifications use polling; no websocket service is provided.

## Administration

| Method | Path                | Body / purpose                                  |
| ------ | ------------------- | ----------------------------------------------- |
| GET    | /admin/users        | users, without password hashes                  |
| PATCH  | /admin/users/:id    | active and/or approved; cannot change admins    |
| GET    | /admin/dashboard    | marketplace counts and cash totals              |
| GET    | /admin/audit        | moderation history                              |
| GET    | /producer/dashboard | own listings, orders, low stock and cash totals |

Suspending a user revokes sessions. Producer/delivery accounts require administrator approval after email verification. Approvals are recorded decisions; document verification is not implemented.

## Farmer photo uploads

POST /images requires an authenticated, approved producer. Send JSON with base64 containing the photo bytes (no data-URL prefix). Maximum file size: 5 MB, JPEG/PNG/WebP, 25 megapixels. The server validates and converts the image to JPEG, strips metadata, and stores it in MongoDB. The response contains image, a relative /api/images/:id URL.

Use that value in the product create/update image field. The server checks that the image belongs to the product's producer. GET /images/:id returns JPEG bytes for display in mobile/web. Resolve relative image URLs against the API server origin. Send image as an empty string to remove a photo, or expiry as an empty string to clear an expiry date.

## Tracking

| Method | Path | Body / access |
| --- | --- | --- |
| GET | /orders/:id/tracking | Order participants or administrator |
| POST | /orders/:id/tracking/start | No body; assigned approved partner on Out for Delivery order |
| PUT | /orders/:id/tracking/location | session, point {latitude, longitude}, recordedAt (UTC ISO timestamp), accuracy (metres or null) |
| POST | /orders/:id/tracking/stop | session; assigned partner |

Start returns `{session: UUID}`. The session is a generation identifier, not a replacement for the bearer token. Starting again invalidates the previous session. Stop with an old session cannot stop a newer session. Publishing requires the active session and a newer sample than the stored one, less than 60 seconds old and no more than 10 seconds in the future. Out-of-range coordinates are rejected. Rejected stale/session/status updates return 409; malformed samples return 400.

GET returns `orderId, status, method, pickupAddress, destinationAddress, pickup, destination, driver, recordedAt, accuracy, sharing, fresh`. Points can be null, especially for older orders. The public tracking response never includes the sharing UUID or handover code. `fresh` is false after 60 seconds without an accepted sample. The UI labels retained points as last known rather than live. Stop, logout of the sharing login session, and handover completion clear the partner position. No background publishing is implemented by the app.

The public `/map/` document is outside the `/api` prefix. Serve that route and its `/map/leaflet/` assets alongside the API when using a reverse proxy.

## First administrator and delegated access

| Method | Path | Body / access |
| --- | --- | --- |
| GET | /auth/admin-setup | Public; returns `{available}` |
| POST | /auth/admin-setup | name, email, password; succeeds only once before any admin exists |
| POST | /admin/administrators | name, email, password; authenticated administrator |
| PATCH | /admin/users/:id/admin-access | `{grant: true}` to promote; `{grant: false}` to revoke |
| GET | /admin/users?role=producer | Optional role filter; paginated users and total |
| GET | /admin/products | All listings, including paused/deleted; paginated products and total |
| GET | /admin/reviews | All reviews/replies; paginated reviews and total |
| GET | /admin/audit | Paginated events and total |
| GET | /admin/dashboard | Account, approval, product, order, delivery, support and cash totals |

Admin creation returns `{user}` with status 201; sign in through /auth/login afterward. New admin accounts are enabled by the provisioning authority without the ordinary registration OTP flow. Existing emails are rejected with 409; promote verified existing users through the access endpoint. Normal registration rejects administrator role or privilege fields. Setup and access changes are transactional, last-admin safe and audited. A role change revokes the target's sessions and stores/restores their previous ordinary role and approval. Password confirmation is checked by the form and is never stored.

All existing /orders, /orders/:id/tracking, /orders/:id/messages and /tickets endpoints provide their administrator scopes. /orders supports an optional method=delivery or method=pickup filter. Tickets and audit responses include total for pagination.
