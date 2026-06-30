import { test, expect } from "bun:test";
import { isSuccessfulMutation, newMutationCallIds, type ToolPartLike } from "./copilot";

function part(over: Partial<ToolPartLike>): ToolPartLike {
  return { toolName: "create_event", toolCallId: "c1", state: "output-available", output: {}, ...over };
}

test("create_event with an id and no error counts as a mutation", () => {
  expect(isSuccessfulMutation(part({ output: { created: "event", id: "e1", title: "X" } }))).toBe(true);
});

test("create_event with an empty id / error does not count", () => {
  expect(isSuccessfulMutation(part({ output: { created: "event", id: "", error: "bad date" } }))).toBe(false);
});

test("delete_event success vs failure", () => {
  expect(isSuccessfulMutation(part({ toolName: "delete_event", output: { deleted: true } }))).toBe(true);
  expect(isSuccessfulMutation(part({ toolName: "delete_event", output: { deleted: false, reason: "ambiguous" } }))).toBe(false);
});

test("update_event success vs failure", () => {
  expect(isSuccessfulMutation(part({ toolName: "update_event", output: { updated: true } }))).toBe(true);
  expect(isSuccessfulMutation(part({ toolName: "update_event", output: { updated: false, reason: "not-found" } }))).toBe(false);
});

test("non-mutation tools never count", () => {
  expect(isSuccessfulMutation(part({ toolName: "read_calendar", output: { events: [] } }))).toBe(false);
  expect(isSuccessfulMutation(part({ toolName: "web_search", output: { results: [] } }))).toBe(false);
});

test("incomplete (still streaming) tool parts do not count", () => {
  expect(isSuccessfulMutation(part({ state: "input-available", output: undefined }))).toBe(false);
});

test("newMutationCallIds returns only fresh successful mutations", () => {
  const parts: ToolPartLike[] = [
    part({ toolCallId: "a", toolName: "delete_event", output: { deleted: true } }),
    part({ toolCallId: "b", toolName: "read_calendar", output: { events: [] } }),
    part({ toolCallId: "c", toolName: "create_event", output: { created: "event", id: "e1" } }),
  ];
  const seen = new Set<string>(["a"]); // already acted on
  expect(newMutationCallIds(parts, seen)).toEqual(["c"]);
});

test("newMutationCallIds is empty when nothing new succeeded", () => {
  const parts: ToolPartLike[] = [part({ toolCallId: "x", toolName: "delete_event", output: { deleted: false } })];
  expect(newMutationCallIds(parts, new Set())).toEqual([]);
});
