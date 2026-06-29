import { test, expect } from "bun:test";
import dropOne from "./[id].delete";
import clearUnscheduled from "./clear-unscheduled.post";

test("todo routes export handlers", () => {
  expect(typeof dropOne).toBe("function");
  expect(typeof clearUnscheduled).toBe("function");
});
