import { desc, eq, sql } from "drizzle-orm";
import { type DbOrTx } from "../client";
import { chatSession, chatMessage, type ChatSession, type ChatMessage, type NewChatMessage } from "../schema";

export async function createChatSession(db: DbOrTx, title?: string): Promise<ChatSession> {
  const [row] = await db
    .insert(chatSession)
    .values({ title: title ?? "New chat" })
    .returning();
  return row!;
}

export async function listChatSessions(db: DbOrTx, limit = 50): Promise<ChatSession[]> {
  return db.select().from(chatSession).orderBy(desc(chatSession.updatedAt)).limit(limit);
}

export async function getChatMessages(db: DbOrTx, sessionId: string): Promise<ChatMessage[]> {
  return db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
    .orderBy(chatMessage.createdAt);
}

export async function addChatMessage(
  db: DbOrTx,
  input: Pick<NewChatMessage, "sessionId" | "role" | "content"> & { parts?: unknown },
): Promise<ChatMessage> {
  // Insert the message
  const [msg] = await db
    .insert(chatMessage)
    .values({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      parts: input.parts ?? null,
    })
    .returning();

  // Bump session updatedAt; if title is still "New chat" and role is "user", set title from first 50 chars
  const trimmedContent = input.content.slice(0, 50);
  await db
    .update(chatSession)
    .set({
      updatedAt: sql`now()`,
      title: sql`CASE WHEN title = 'New chat' AND ${input.role} = 'user' THEN ${trimmedContent} ELSE title END`,
    })
    .where(eq(chatSession.id, input.sessionId));

  return msg!;
}

export async function deleteChatSession(db: DbOrTx, id: string): Promise<void> {
  await db.delete(chatSession).where(eq(chatSession.id, id));
}
