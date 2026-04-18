import { describe, expect, test } from "bun:test";
import { canonicalize } from "../lib/canonical.js";

describe("canonicalize", () => {
  test("sorts keys deterministically", () => {
    const a = canonicalize({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalize({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
  });

  test("strips signature field at root by default", () => {
    const with_sig = canonicalize({ a: 1, signature: { value: "x" } });
    const without_sig = canonicalize({ a: 1 });
    expect(new TextDecoder().decode(with_sig)).toBe(new TextDecoder().decode(without_sig));
  });

  test("emits exact golden bytes", () => {
    const out = canonicalize({ z: 1, a: [3, 1, 2] });
    expect(new TextDecoder().decode(out)).toBe('{"a":[3,1,2],"z":1}\n');
  });

  test("recursively sorts nested arrays' object keys", () => {
    const out = canonicalize({ list: [{ b: 1, a: 2 }, { d: 1, c: 2 }] });
    expect(new TextDecoder().decode(out)).toBe(
      '{"list":[{"a":2,"b":1},{"c":2,"d":1}]}\n',
    );
  });
});
