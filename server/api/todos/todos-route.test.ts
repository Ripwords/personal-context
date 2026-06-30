import { test, expect } from "bun:test";
import dropOne from "./[id].delete";
import clearUnscheduled from "./clear-unscheduled.post";
import complete from "./[id]/complete.post";
import projectPatch from "./[id]/project.patch";
import schedule from "./[id]/schedule.post";

test("todo routes export handlers", () => {
  expect(typeof dropOne).toBe("function");
  expect(typeof clearUnscheduled).toBe("function");
  expect(typeof complete).toBe("function");
  expect(typeof projectPatch).toBe("function");
  expect(typeof schedule).toBe("function");
});
