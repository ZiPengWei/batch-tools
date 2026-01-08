export type GitConflictMarkerBlock = {
  startLine: number;
  endLine: number;
  leftLabel: string;
  baseLabel: string;
  rightLabel: string;
  leftLines: string[];
  baseLines: string[];
  rightLines: string[];
};

function parseLabel(line: string, prefix: string) {
  const s = String(line || "");
  if (!s.startsWith(prefix)) return "";
  return s.slice(prefix.length).trim();
}

export function parseGitConflictMarkers(text: string): GitConflictMarkerBlock[] {
  const lines = String(text ?? "").split(/\r?\n/g);
  const blocks: GitConflictMarkerBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.startsWith("<<<<<<<")) {
      i += 1;
      continue;
    }
    const startLine = i + 1;
    const leftLabel = parseLabel(line, "<<<<<<<");
    i += 1;

    const leftLines: string[] = [];
    const baseLines: string[] = [];
    const rightLines: string[] = [];
    let baseLabel = "";
    let rightLabel = "";

    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.startsWith("|||||||")) break;
      if (l.startsWith("=======")) break;
      leftLines.push(l);
      i += 1;
    }

    if (i < lines.length && (lines[i] ?? "").startsWith("|||||||")) {
      baseLabel = parseLabel(lines[i] ?? "", "|||||||");
      i += 1;
      while (i < lines.length) {
        const l = lines[i] ?? "";
        if (l.startsWith("=======")) break;
        baseLines.push(l);
        i += 1;
      }
    }

    if (i >= lines.length || !(lines[i] ?? "").startsWith("=======")) break;
    i += 1;

    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.startsWith(">>>>>>>")) break;
      rightLines.push(l);
      i += 1;
    }

    if (i >= lines.length || !(lines[i] ?? "").startsWith(">>>>>>>")) break;
    rightLabel = parseLabel(lines[i] ?? "", ">>>>>>>");
    const endLine = i + 1;
    i += 1;

    blocks.push({
      startLine,
      endLine,
      leftLabel,
      baseLabel,
      rightLabel,
      leftLines,
      baseLines,
      rightLines,
    });
  }
  return blocks;
}

