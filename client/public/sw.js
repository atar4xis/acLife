self.addEventListener("push", async (event) => {
  const data = event.data?.json() || {};

  switch (data.type) {
    case "notification":
      self.registration.showNotification(data.title || "Notification", {
        body: data.body,
        icon: "/android-chrome-512x512.png",
      });
      break;

    case "sync":
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: false,
      });

      for (const client of clients) {
        client.postMessage(data);
      }
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
