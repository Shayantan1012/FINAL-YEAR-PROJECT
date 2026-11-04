/* global L */
const map = L.map("map").setView([0, 0], 2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
})
  .on("tileerror", () => {
    document.getElementById("error").textContent =
      "Map tiles unavailable. Check internet access; coordinates remain available in the app.";
  })
  .addTo(map);
const pins = L.layerGroup().addTo(map);
let selectable = false,
  fitted = false;
const valid = (p) =>
  p &&
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180;
const send = (data) => {
  if (window.ReactNativeWebView)
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  else window.parent.postMessage(data, "*");
};
window.harvestMap = (data) => {
  if (!data || data.type !== "pins" || !Array.isArray(data.markers)) return;
  selectable = data.selectable === true;
  pins.clearLayers();
  const bounds = [];
  for (const marker of data.markers.slice(0, 3)) {
    if (!valid(marker)) continue;
    const label = [
      "Pickup",
      "Destination",
      "Delivery partner",
      "Selected location",
    ].includes(marker.label)
      ? marker.label
      : "Location";
    const color =
      label === "Delivery partner"
        ? "#c26112"
        : label === "Destination"
          ? "#215ec7"
          : "#275c3b";
    const coordinates = [marker.latitude, marker.longitude];
    L.circleMarker(coordinates, {
      radius: 10,
      color: "white",
      weight: 3,
      fillColor: color,
      fillOpacity: 1,
    })
      .bindTooltip(label, { permanent: true, direction: "top" })
      .addTo(pins);
    bounds.push(coordinates);
  }
  if (bounds.length && (!fitted || selectable)) {
    map.fitBounds(bounds, { padding: [45, 45], maxZoom: 16 });
    fitted = true;
  }
};
window.addEventListener("message", (event) => {
  if (event.source === window.parent) window.harvestMap(event.data);
});
map.on("click", (event) => {
  if (selectable)
    send({
      type: "select",
      latitude: event.latlng.lat,
      longitude: event.latlng.lng,
    });
});
send({ type: "ready" });
