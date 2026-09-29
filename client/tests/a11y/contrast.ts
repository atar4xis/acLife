type Rgb = [number, number, number];

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const encode = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const decode = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

// parses "oklch(L C H / A%)" into linear-light-encoded sRGB [0..1] plus alpha
export function parseOklch(css: string): { rgb: Rgb; alpha: number } {
  const m = css.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/,
  );
  if (!m) throw new Error(`unsupported color: ${css}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const alpha =
    m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
  return { rgb: lin.map((c) => encode(clamp(c))) as Rgb, alpha };
}

// resolves a color over an opaque backdrop into opaque sRGB [0..1]
export function resolve(css: string, backdrop?: Rgb): Rgb {
  const { rgb, alpha } = parseOklch(css);
  if (alpha === 1) return rgb;
  if (!backdrop) throw new Error(`translucent color needs a backdrop: ${css}`);
  return rgb.map((c, i) => c * alpha + backdrop[i] * (1 - alpha)) as Rgb;
}

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

export function contrastRatio(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
