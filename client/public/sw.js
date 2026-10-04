self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};

  switch (data.type) {
    case "notification":
      self.registration.showNotification(data.title || "Notification", {
        body: data.body,
        icon: "/android-chrome-512x512.png",
      });
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
