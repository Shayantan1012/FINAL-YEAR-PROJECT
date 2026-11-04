# Harvest backend — Node.js + MongoDB

An Express REST API for the Harvest React Native app. Features are separated into routes, controllers, services, Mongoose models, middleware and validation.

## Start on Windows

Use Node.js 24 LTS. Dependencies are already installed in this workspace.

    cd "C:\Users\SHAYANTAN BISWAS\Desktop\FINAL YEAR PROJECT\farm-backend"
    Copy-Item .env.example .env

Edit .env with your MongoDB connection string. Choose either:

- MongoDB Atlas: create a database user, allow your machine's IP, and use the Atlas connection URI with the harvest database name. Keep credentials in .env, never in the React Native application.
- Local Docker: start Docker Desktop, then run docker compose up -d --wait from this folder. The provided compose file creates a single-node replica set and a persistent volume. The default .env.example URI works with this configuration.

An ordinary standalone MongoDB instance will be rejected at startup. Multi-document transactions require a replica set or Atlas cluster.

Then:

    npm.cmd run dev

Health endpoint: http://localhost:4000/health

The default port is 4000. Restart after changing .env. Stop with Ctrl+C.

## Accounts and product data

No sample accounts or products are seeded. Farmers register in the app, verify their email and request administrator approval.

Create the first administrator in the app: **Sign in / Register ? First administrator setup**. Enter a new email, name, password and confirmation, then sign in. Setup is available only before any administrator exists and closes permanently afterward. Complete initial setup before opening an unconfigured deployment to the public.

The **Administration → Cleanup** page shows current record counts and buttons to permanently delete orders, products, non-admin accounts, all marketplace data, login sessions, or audit history. Each action requires the administrator password and an exact confirmation phrase. Product deletion requires orders to be cleared first; account deletion requires both orders and products to be cleared. Order cleanup restores stock reserved by unfinished orders. Clearing sessions signs everyone out and stops live delivery location sharing. Clearing audit history leaves the audit list empty. The marketplace reset preserves administrator accounts, their login sessions, and audit history; use the separate buttons to clear those records. Back up the database first if you may need the deleted data later.

The optional command-line alternative uses ADMIN_EMAIL, ADMIN_PASSWORD (at least 12 characters), and optionally ADMIN_NAME in your private environment:

    npm.cmd run create-admin

This refuses to overwrite or promote an existing account. Remove the bootstrap credentials after provisioning. It also refuses to run after first-admin setup. Sign in as this administrator in the app, open Admin ? Users and approve verified farmer accounts.

If you previously ran the old sample seeder, remove its unchanged product records with:

    npm.cmd run cleanup:samples
    npm.cmd run cleanup:samples -- --apply

The first command previews the matching count. The second soft-deletes only known legacy listings with the original sample owner, name and exact photo URL. It does not drop collections or delete users/orders. Custom listings and edited photos are preserved.

## What is implemented

- Email/password registration, email-code verification, login, expiring database sessions, logout and password reset that revokes all sessions.
- Consumer, producer, delivery and administrator permissions; producer/delivery approval and account suspension.
- Profiles, saved products, carts, in-app notifications and deletion requests.
- Product creation/editing, soft deletion, pause/reactivate, category/method/location/price search, sorting, pagination and stock availability.
- Atomic multi-producer checkout, stock reservation, server-calculated totals, idempotent request retries, cancellation and one-time stock restoration.
- Automatic home delivery ETA based on farm preparation, route distance, and current nearby partner availability; checkout does not accept a customer-selected delivery time. Farm pickup retains a validated time slot.
- Producer fulfilment statuses, driver claiming, customer-only handover codes, delivery/pickup completion and cash collection records.
- Private order history, receipts, order conversations, verified-purchase reviews, producer replies and support tickets.
- Administrator user moderation, ticket resolution, audit events and producer/admin summaries.

All money in order APIs is integer paise: 4000 = INR 40. Product API inputs/outputs use rupees in the price field, stored as integer paise. Quantities are whole kilograms. Delivery costs 3500 paise, is free above a 49900-paise subtotal, and pickup is free. FRESH10 discounts the produce subtotal by 10%, allocated across suborders. Online payment methods are deliberately not accepted: this implementation supports cash on delivery/payment at pickup only.

## React Native connection

A typed client is provided in ../farm-app/src/services/api.ts, with its own .env.example. Android Studio's standard emulator connects to http://10.0.2.2:4000/api; web uses http://localhost:4000/api; a physical phone needs your computer's LAN IP and the same network.

The application screens now call the API. Farmers authenticate, upload their own photos, and manage their own products; the marketplace displays the saved records. Old demo AsyncStorage state is ignored. Start both servers and use the actual account credentials. A database outage produces an error state, not sample product data.

When a signed-in customer selects a delivery pin, or a farmer selects a pickup pin, the app fills the address using the backend's reverse-geocoding endpoint. Check and add the house, street, and building details: map data may only identify a nearby place. The default OpenStreetMap Nominatim service is used only for these user-selected pins, with a server-side cache and one-request-per-second queue. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) applies; configure `REVERSE_GEOCODE_URL` to use a suitable HTTPS provider for larger deployments. If lookup fails, the app shows pin coordinates and asks for a typed address.

API tokens stay in memory in the supplied client. Add platform-secure storage if implementing remembered login. Never put MongoDB or SMTP credentials into EXPO_PUBLIC variables.

## Verification and mail

For local development EXPOSE_DEV_OTP=true returns developmentCode with registration/reset challenge responses. There are no fixed OTPs. Codes expire in 10 minutes, can be used once, and allow at most five attempts.

Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM to send actual verification/recovery emails. Production startup requires SMTP and forbids exposing codes. Sessions use random tokens; only SHA-256 token hashes are stored. Passwords use salted asynchronous scrypt.

## Tests

    npm.cmd test

Tests download and launch an isolated temporary MongoDB replica set. They never connect to MONGODB_URI or your application database. The first run needs internet access for the MongoDB binary; subsequent runs use its cache.

Tests exercise authentication, authorization, schema validation, multi-farm totals, idempotency, rollback, concurrent stock reservation, cancellation, delivery codes, reviews and per-user data isolation.

## Structure

    src/
      app.js             Express application and global middleware
      server.js          Database startup, HTTP listener, shutdown
      config.js          Environment configuration
      db.js              Replica-set check and database indexes
      routes/            Endpoint definitions by feature
      controllers/       Validated requests and responses
      services/          Checkout, cancellation, authentication, notifications
      models/            Individual MongoDB/Mongoose models
      middleware/        Authentication, role and approval checks
      lib/               Validation, password/token utilities and errors
    scripts/create-admin.js
    scripts/remove-legacy-samples.js
    tests/api.test.js
    docs/API.md

## Deployment boundary

This is a runnable backend for the core marketplace, not every one of the PDF's 141 requirements. Not implemented: online gateways/refunds, bank payouts, identity-document storage, identity-document verification, SMS/WhatsApp, geospatial driver matching, road-route calculation, background GPS, real-time sockets, tax invoices, market feeds, configurable promotions, and regional content translations. Product photos are uploaded through POST /api/images and stored in MongoDB. The API validates JPEG/PNG/WebP bytes (maximum 5 MB / 25 megapixels), strips metadata and resizes to at most 1600 pixels. Unused uploaded images are retained; automatic orphan cleanup is not implemented.

Cash receipts record the fulfiller's confirmation, not proof from a payment gateway. Approval is an administrator decision, not automated identity verification. Delivery serviceability is not geofenced yet. Message transport does not expose contact fields, but user-written messages are not automatically redacted.

Use HTTPS in deployment. The default rate limiter is per-process memory; configure a shared limiter and trusted reverse-proxy handling before multi-instance hosting. Configure backup/restore for MongoDB and a private database network. Docker configuration here is local-only with its port bound to loopback and no database authentication.

## Order location tracking

Products require `pickupLocation: { latitude, longitude }` on creation. Delivery checkout requires `destinationLocation` in addition to the address. Existing products must be edited to add a pickup pin before checkout. Orders snapshot both endpoints; changes to a product do not move previous orders. A farmer with multiple pickup points gets one order per pickup point.

`GET /api/orders/:id/tracking` is restricted to the consumer, producer, assigned driver or administrator. Only the assigned approved delivery partner may start/publish tracking for an Out for Delivery order. The API keeps a single last location, accuracy and timestamp, with no movement history. Sharing sessions prevent delayed requests from restarting stopped sharing. Stop, successful logout of the sharing login session, and completed handover clear the location. Unavailable/older samples are explicitly marked stale after one minute.

The app uses foreground Expo GPS and polls every ten seconds. No socket server or background location service is needed. `/map/` hosts the public Leaflet document and local renderer assets; no account tokens or order coordinates are put in its URL. The app passes points directly to the embedded document. Tile images come from OpenStreetMap, with attribution and normal caching. Deployment must follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); the community tile service has no availability guarantee. Do not add bulk downloads or offline prefetching.

See `docs/API.md` for tracking endpoints and `../farm-app/README.md` for the complete three-role test flow. Tests use an isolated MongoDB and include coordinate validation, endpoint snapshots, role isolation, stale samples, session replacement, late updates, stop, logout and completion.

## Administrator workspace

Admin includes Overview, Users, Farms, Administrators, Create administrator, Products, Orders, Deliveries, Support, Reviews and Activity. Lists are paginated. Products include paused, out-of-stock and deleted listings. Administrators can inspect order chats and tracking, approve farmers/drivers, suspend ordinary accounts, pause listings, resolve tickets, and review recorded cash totals and audit events. Password hashes, session tokens and private handover codes are never exposed by admin pages.

An administrator may create another administrator account with a new email and password, or grant access to an existing active, email-verified account through Users ? Grant administrator access ? Confirm. This switches the account to the administrator role; removing access restores its previous role and approval. Access changes revoke the target's existing sessions, so they must sign in again. Administrators cannot remove their own access or suspend an administrator through ordinary moderation. To suspend another administrator, first remove their admin access, then suspend the resulting ordinary account.

A singleton MongoDB control record serializes setup and access changes inside transactions. Simultaneous initial setup requests create at most one administrator. Concurrent cross-revocations cannot remove all administrators. The setup-closed flag survives removal of administrator records. Existing administrator installations are recognized at startup. Every creation, grant and revocation generates an audit event. The CLI uses the same one-time setup guard.
