const APP_NAME = "acLife";
const icon = new URL("app-icon.png", self.registration.scope).href;

self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};

  switch (data.type) {
    case "notification":
      self.registration.showNotification(data.title || "Notification", {
        body: data.body,
        icon,
      });
      break;

    case "event-start":
      event.waitUntil(
        caches
          .open("acl-locale")
          .then((cache) => cache.match("/locale"))
          .then((res) => res.json())
          .then((locale) => locale.notify?.eventStarting || "Event starting")
          .catch(() => "Event starting")
          .then((body) =>
            self.registration.showNotification(APP_NAME, { body, icon, tag: "event-start" }),
          ),
      );
      break;

    default:
      break;
  }
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
