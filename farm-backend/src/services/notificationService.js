import { Notification } from "../models/Notification.js";
export async function notify(users, text, order, session) {
  const unique = [...new Set(users.filter(Boolean).map(String))];
  if (unique.length)
    await Notification.create(
      unique.map((user) => ({ user, text, order })),
      { session, ordered: true },
    );
}
