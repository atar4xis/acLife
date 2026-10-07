export type Encrypted = ArrayBuffer;

export type EnvelopeKDFParams = {
  algo: "argon2id" | "argon2d" | "argon2i";
  time: number;
  mem: number;
  parallelism: number;
  hashLen: number;
};

export type KDFCost = Pick<EnvelopeKDFParams, "time" | "mem">;
