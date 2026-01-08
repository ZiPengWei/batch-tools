import { describe, expect, it } from "vitest";
import { parseGitConflictMarkers } from "../src/renderer/utils/conflictMarkers";

describe("parseGitConflictMarkers", () => {
  it("解析带 diff3 的冲突块", () => {
    const text = [
      "a",
      "<<<<<<< LOCAL",
      "l1",
      "l2",
      "||||||| BASE",
      "b1",
      "b2",
      "=======",
      "r1",
      ">>>>>>> REMOTE",
      "z",
    ].join("\n");
    const blocks = parseGitConflictMarkers(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0].startLine).toBe(2);
    expect(blocks[0].endLine).toBe(10);
    expect(blocks[0].leftLabel).toBe("LOCAL");
    expect(blocks[0].baseLabel).toBe("BASE");
    expect(blocks[0].rightLabel).toBe("REMOTE");
    expect(blocks[0].leftLines).toEqual(["l1", "l2"]);
    expect(blocks[0].baseLines).toEqual(["b1", "b2"]);
    expect(blocks[0].rightLines).toEqual(["r1"]);
  });

  it("解析不带 base 段的冲突块", () => {
    const text = [
      "a",
      "<<<<<<< ours",
      "l1",
      "=======",
      "r1",
      "r2",
      ">>>>>>> theirs",
      "z",
    ].join("\n");
    const blocks = parseGitConflictMarkers(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0].leftLabel).toBe("ours");
    expect(blocks[0].baseLabel).toBe("");
    expect(blocks[0].rightLabel).toBe("theirs");
    expect(blocks[0].leftLines).toEqual(["l1"]);
    expect(blocks[0].baseLines).toEqual([]);
    expect(blocks[0].rightLines).toEqual(["r1", "r2"]);
  });

  it("无冲突标记时返回空", () => {
    const blocks = parseGitConflictMarkers("a\nb\nc\n");
    expect(blocks.length).toBe(0);
  });
});

