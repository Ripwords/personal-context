import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStore, makeObjectStore, S3Store } from "./object-store";

const scratch = join(tmpdir(), `bd-store-test-${process.pid}`);

test("LocalStore put/read/delete roundtrip under a key", async () => {
  const store = new LocalStore(scratch);
  const key = "documents/abc-hello.txt";
  const bytes = new TextEncoder().encode("hello world");

  await store.put(key, bytes, "text/plain");
  const back = await store.read(key);
  expect(new TextDecoder().decode(back)).toBe("hello world");

  await store.delete(key);
  expect(store.read(key)).rejects.toBeDefined(); // gone
});

test("LocalStore.delete is a no-op for a missing key", async () => {
  const store = new LocalStore(scratch);
  await store.delete("documents/never-existed"); // must not throw
});

test("makeObjectStore selects S3 when bucket + credentials are set, else local", () => {
  expect(
    makeObjectStore({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "http://localhost:3900" }),
  ).toBeInstanceOf(S3Store);
  expect(makeObjectStore({})).toBeInstanceOf(LocalStore);
});
