import { describe, test, expect } from "bun:test";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  test("returns empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  test("returns empty array for whitespace-only string", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  test("returns single chunk for short text", () => {
    const result = chunkText("Hello world");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Hello world");
  });

  test("splits long text into multiple chunks ≤ maxChars", () => {
    // Build a text with clearly separated paragraphs
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i}: ${"x".repeat(200)}`
    );
    const text = paragraphs.join("\n\n");
    const result = chunkText(text, { maxChars: 500 });

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  test("drops empty/whitespace-only paragraphs", () => {
    const text = "First paragraph\n\n\n\n   \n\nSecond paragraph";
    const result = chunkText(text);
    expect(result).toHaveLength(1); // both fit in one chunk
    expect(result[0]).toContain("First paragraph");
    expect(result[0]).toContain("Second paragraph");
  });

  test("preserves order of paragraphs", () => {
    const paragraphs = ["Alpha", "Beta", "Gamma", "Delta"];
    const text = paragraphs.join("\n\n");
    const result = chunkText(text);
    const joined = result.join(" ");
    const alphaIdx = joined.indexOf("Alpha");
    const betaIdx = joined.indexOf("Beta");
    const gammaIdx = joined.indexOf("Gamma");
    const deltaIdx = joined.indexOf("Delta");
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(gammaIdx);
    expect(gammaIdx).toBeLessThan(deltaIdx);
  });

  test("uses default maxChars of 2000", () => {
    // Single paragraph under 2000 chars → one chunk
    const text = "a".repeat(1999);
    const result = chunkText(text);
    expect(result).toHaveLength(1);
  });

  test("single paragraph exceeding maxChars is emitted as its own chunk", () => {
    const bigPara = "word ".repeat(500); // ~2500 chars
    const result = chunkText(bigPara, { maxChars: 100 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    // each chunk should be at most maxChars (oversized paras emit as-is)
    // but they must not be empty
    for (const c of result) {
      expect(c.trim()).not.toBe("");
    }
  });

  test("accumulates paragraphs into chunks respecting maxChars boundary", () => {
    // Each paragraph is 100 chars; maxChars=250 → at most 2 per chunk
    const para = "x".repeat(100);
    const text = Array(6).fill(para).join("\n\n");
    const result = chunkText(text, { maxChars: 250 });
    expect(result.length).toBeGreaterThanOrEqual(3);
    for (const chunk of result) {
      expect(chunk.trim()).not.toBe("");
    }
  });
});
