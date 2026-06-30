import { test, expect } from "bun:test";
import feed from "./events.get";
import sync from "./sync.post";

test("calendar routes export handlers (feed read is separate from sync)", () => {
  expect(typeof feed).toBe("function");
  expect(typeof sync).toBe("function");
});
