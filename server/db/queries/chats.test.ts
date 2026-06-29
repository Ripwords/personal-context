import { describe, test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import {
  createChatSession,
  listChatSessions,
  getChatMessages,
  addChatMessage,
  deleteChatSession,
} from "./chats";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("createChatSession", () => {
  test("creates with default title 'New chat'", async () => {
    const session = await createChatSession(db);
    expect(session.id).toBeString();
    expect(session.title).toBe("New chat");
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  test("creates with custom title", async () => {
    const session = await createChatSession(db, "My custom session");
    expect(session.id).toBeString();
    expect(session.title).toBe("My custom session");
  });
});

describe("listChatSessions", () => {
  test("returns empty list when no sessions", async () => {
    const list = await listChatSessions(db);
    expect(list).toHaveLength(0);
  });

  test("returns sessions ordered by updatedAt descending (newest first)", async () => {
    const older = await createChatSession(db, "Older session");
    // Add a message to the newer session to bump its updatedAt
    const newer = await createChatSession(db, "Newer session");
    await addChatMessage(db, {
      sessionId: newer.id,
      role: "user",
      content: "Hello newer",
    });

    const list = await listChatSessions(db);
    expect(list[0]!.id).toBe(newer.id);
    expect(list[1]!.id).toBe(older.id);
  });

  test("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createChatSession(db, `Session ${i}`);
    }
    const list = await listChatSessions(db, 3);
    expect(list).toHaveLength(3);
  });
});

describe("getChatMessages", () => {
  test("returns empty list for new session", async () => {
    const session = await createChatSession(db);
    const messages = await getChatMessages(db, session.id);
    expect(messages).toHaveLength(0);
  });

  test("returns messages in chronological order", async () => {
    const session = await createChatSession(db);
    const first = await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "First message",
    });
    const second = await addChatMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "Second message",
    });

    const messages = await getChatMessages(db, session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.id).toBe(first.id);
    expect(messages[1]!.id).toBe(second.id);
  });
});

describe("addChatMessage", () => {
  test("creates message with correct fields", async () => {
    const session = await createChatSession(db);
    const msg = await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "Hello world",
    });

    expect(msg.id).toBeString();
    expect(msg.sessionId).toBe(session.id);
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello world");
    expect(msg.parts).toBeNull();
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  test("creates message with parts", async () => {
    const session = await createChatSession(db);
    const parts = [{ type: "text", text: "Hello" }];
    const msg = await addChatMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "Hello",
      parts,
    });

    expect(msg.parts).toEqual(parts);
  });

  test("bumps session updatedAt", async () => {
    const session = await createChatSession(db);
    const originalUpdatedAt = session.updatedAt;

    // Small delay to ensure time difference
    await new Promise((r) => setTimeout(r, 10));

    await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "Bump the session",
    });

    const sessions = await listChatSessions(db);
    const updated = sessions.find((s) => s.id === session.id);
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  test("sets title from first user message when title is 'New chat'", async () => {
    const session = await createChatSession(db);
    expect(session.title).toBe("New chat");

    await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "This is my first message",
    });

    const sessions = await listChatSessions(db);
    const updated = sessions.find((s) => s.id === session.id);
    expect(updated!.title).toBe("This is my first message");
  });

  test("truncates title to first 50 chars from first user message", async () => {
    const session = await createChatSession(db);
    const longContent = "A".repeat(100);

    await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: longContent,
    });

    const sessions = await listChatSessions(db);
    const updated = sessions.find((s) => s.id === session.id);
    expect(updated!.title).toBe("A".repeat(50));
  });

  test("does NOT change title when title is already custom", async () => {
    const session = await createChatSession(db, "My Custom Title");

    await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "This should not overwrite the title",
    });

    const sessions = await listChatSessions(db);
    const updated = sessions.find((s) => s.id === session.id);
    expect(updated!.title).toBe("My Custom Title");
  });

  test("role 'assistant' does NOT change title even when title is 'New chat'", async () => {
    const session = await createChatSession(db);

    await addChatMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "This assistant message should not set the title",
    });

    const sessions = await listChatSessions(db);
    const updated = sessions.find((s) => s.id === session.id);
    expect(updated!.title).toBe("New chat");
  });
});

describe("deleteChatSession", () => {
  test("deletes session and cascades to messages", async () => {
    const session = await createChatSession(db);
    await addChatMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "Message that will be deleted",
    });
    await addChatMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "Another message to be deleted",
    });

    // Verify messages exist before deletion
    const messagesBefore = await getChatMessages(db, session.id);
    expect(messagesBefore).toHaveLength(2);

    await deleteChatSession(db, session.id);

    // Session should be gone
    const sessions = await listChatSessions(db);
    expect(sessions.find((s) => s.id === session.id)).toBeUndefined();

    // Messages should be cascade-deleted
    const messagesAfter = await getChatMessages(db, session.id);
    expect(messagesAfter).toHaveLength(0);
  });
});
