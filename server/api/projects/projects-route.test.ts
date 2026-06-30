import { test, expect } from "bun:test";
import list from "./index.get";
import create from "./index.post";
import patch from "./[id].patch";
import del from "./[id].delete";

test("project routes export handlers (list/create/patch/delete)", () => {
  expect(typeof list).toBe("function");
  expect(typeof create).toBe("function");
  expect(typeof patch).toBe("function");
  expect(typeof del).toBe("function");
});
