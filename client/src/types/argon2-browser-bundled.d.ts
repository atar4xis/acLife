declare module "argon2-browser/dist/argon2-bundled.min.js" {
  import type * as Argon2 from "argon2-browser";
  const argon2: typeof Argon2;
  export default argon2;
}
