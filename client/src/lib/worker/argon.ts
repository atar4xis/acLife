import argon2 from "argon2-browser/dist/argon2-bundled.min.js";

self.onmessage = async (e) => {
  const { password, salt, time, mem, hashLen, parallelism } = e.data;

  try {
    const result = await argon2.hash({
      pass: password,
      salt: new Uint8Array(salt),
      time,
      mem,
      hashLen,
      parallelism,
    });

    self.postMessage({ hash: Array.from(result.hash) });
  } catch (err) {
    if (err instanceof Error) self.postMessage({ error: err.message });
  }
};
