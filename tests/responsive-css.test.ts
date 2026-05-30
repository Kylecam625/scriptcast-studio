import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function mediaBlock(maxWidth: number) {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  expect(start).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not parse @media (max-width: ${maxWidth}px) block.`);
}

describe("mobile responsive CSS", () => {
  test("phone layout keeps the workflow stepper inside the viewport", () => {
    const phone = mediaBlock(640);

    expect(phone).toContain(".mobile-step-summary");
    expect(phone).toContain(".stepper-track");
    expect(phone).toContain(".desktop-step-label");
    expect(phone).toContain("display: none;");
  });

  test("phone controls avoid narrow two-column labels", () => {
    const phone = mediaBlock(640);

    expect(phone).toContain(".input-switch");
    expect(phone).toContain("grid-template-columns: 1fr;");
    expect(phone).toContain("white-space: normal;");
  });

  test("phone idea duration selector keeps three stable tap targets", () => {
    const phone = mediaBlock(640);

    expect(phone).toContain(".duration-options");
    expect(phone).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(phone).toContain(".duration-button");
    expect(phone).toContain("min-height: 54px;");
  });

  test("phone summary stats remain scannable without a long single-column stack", () => {
    const phone = mediaBlock(640);

    expect(phone).toContain(".status-row");
    expect(phone).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  test("dark mode has explicit theme tokens and a visible toggle", () => {
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain(".theme-toggle");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });
});
