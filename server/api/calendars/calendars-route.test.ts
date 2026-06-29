import { test, expect } from "bun:test";
import list from "./index.get";
import patch from "./[id].patch";

test("calendar routes export handlers", () => {
  expect(typeof list).toBe("function");
  expect(typeof patch).toBe("function");
});
