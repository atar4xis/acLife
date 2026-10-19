export const CLIENT_ID = Math.random().toString(36).slice(2, 8);

export const withClient = (path: string) =>
  path + (path.includes("?") ? "&" : "?") + "c=" + CLIENT_ID;
