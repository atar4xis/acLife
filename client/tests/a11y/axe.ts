import { configureAxe } from "jest-axe";
import { expect } from "vitest";

// jsdom cannot compute color contrast, covered by tests/a11y/contrast.test.ts
const runAxe = configureAxe({
  rules: { "color-contrast": { enabled: false } },
});

// jsdom has no canvas, axe probes it for icon-ligature detection
HTMLCanvasElement.prototype.getContext = () => null;

export async function expectNoViolations(
  container: Element,
  disabledRules: string[] = [],
) {
  const { violations } = await runAxe(container, {
    rules: Object.fromEntries(
      disabledRules.map((id) => [id, { enabled: false }]),
    ),
  });
  expect(
    violations.map(
      (v) =>
        `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target).join(" | ")}`,
    ),
  ).toEqual([]);
}
