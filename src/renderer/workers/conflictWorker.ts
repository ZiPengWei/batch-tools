type DiffOp = { type: "equal" | "insert" | "delete"; lines: string[] };
type DiffEdit = {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
  lines: string[];
};
type DiffResult = { edits: DiffEdit[]; baseToSideBoundary: number[] };

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function myersDiff(a: string[], b: string[], max = 6000): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n + m > max) return null;
  const cost = n * m;
  if (cost > 220000) return null;

  const dp: number[][] = new Array(n + 1);
  dp[0] = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const row = new Array(m + 1);
    row[0] = 0;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      if (ai === b[j - 1]) row[j] = dp[i - 1][j - 1] + 1;
      else row[j] = dp[i - 1][j] >= row[j - 1] ? dp[i - 1][j] : row[j - 1];
    }
    dp[i] = row;
  }

  const ops: Array<{ t: "equal" | "insert" | "delete"; line: string }> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ t: "equal", line: a[i - 1] });
      i--;
      j--;
      continue;
    }
    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ t: "insert", line: b[j - 1] });
      j--;
      continue;
    }
    if (i > 0) {
      ops.push({ t: "delete", line: a[i - 1] });
      i--;
    }
  }

  ops.reverse();
  const grouped: DiffOp[] = [];
  for (const o of ops) {
    const last = grouped[grouped.length - 1];
    if (last && last.type === o.t) last.lines.push(o.line);
    else grouped.push({ type: o.t, lines: [o.line] });
  }
  return grouped;
}

function buildDiff(baseLines: string[], sideLines: string[]): DiffResult {
  const ops = myersDiff(baseLines, sideLines) ?? null;
  if (!ops) {
    const baseLen = baseLines.length;
    const sideLen = sideLines.length;
    const min = Math.min(baseLen, sideLen);
    const edits: DiffEdit[] = [];
    const baseToSideBoundary: number[] = new Array(baseLen + 1);
    for (let i = 0; i <= baseLen; i++)
      baseToSideBoundary[i] = Math.min(i, sideLen);
    for (let i = 0; i < min; i++) {
      if (baseLines[i] !== sideLines[i]) {
        edits.push({
          baseStart: i,
          baseEnd: i + 1,
          sideStart: i,
          sideEnd: i + 1,
          lines: [sideLines[i]],
        });
      }
    }
    if (sideLen > baseLen) {
      edits.push({
        baseStart: baseLen,
        baseEnd: baseLen,
        sideStart: baseLen,
        sideEnd: sideLen,
        lines: sideLines.slice(baseLen),
      });
    } else if (baseLen > sideLen) {
      edits.push({
        baseStart: sideLen,
        baseEnd: baseLen,
        sideStart: sideLen,
        sideEnd: sideLen,
        lines: [],
      });
    }
    return { edits, baseToSideBoundary };
  }

  const edits: DiffEdit[] = [];
  const baseToSideBoundary: number[] = new Array(baseLines.length + 1);
  let i = 0;
  let j = 0;
  baseToSideBoundary[0] = 0;
  let active: DiffEdit | null = null;
  for (const op of ops) {
    if (op.type === "equal") {
      if (active) {
        edits.push(active);
        active = null;
      }
      for (let idx = 0; idx < op.lines.length; idx++) {
        i++;
        j++;
        baseToSideBoundary[i] = j;
      }
      continue;
    }
    if (!active)
      active = {
        baseStart: i,
        baseEnd: i,
        sideStart: j,
        sideEnd: j,
        lines: [],
      };
    if (op.type === "delete") {
      for (let idx = 0; idx < op.lines.length; idx++) {
        i++;
        active.baseEnd = i;
        baseToSideBoundary[i] = j;
      }
    } else if (op.type === "insert") {
      for (let idx = 0; idx < op.lines.length; idx++) {
        active.lines.push(op.lines[idx]);
        j++;
        active.sideEnd = j;
      }
    }
    active.baseEnd = i;
    active.sideEnd = j;
  }
  if (active) edits.push(active);
  baseToSideBoundary[baseLines.length] = sideLines.length;
  return { edits, baseToSideBoundary };
}

function applyEditsToBaseSegment(
  baseLines: string[],
  start: number,
  end: number,
  edits: DiffEdit[]
): string[] {
  if (start === end) {
    const out: string[] = [];
    for (const e of edits) {
      if (
        e.baseStart === start &&
        e.baseEnd === start &&
        Array.isArray(e.lines) &&
        e.lines.length
      ) {
        out.push(...e.lines);
      }
    }
    return out;
  }
  const out: string[] = [];
  let pos = start;
  for (const e of edits) {
    const s = Math.max(start, e.baseStart);
    const ee = Math.min(end, e.baseEnd);
    if (e.baseEnd <= start || e.baseStart >= end) continue;
    if (pos < s) out.push(...baseLines.slice(pos, s));
    if (e.baseStart >= start && e.baseEnd <= end) {
      out.push(...e.lines);
      pos = e.baseEnd;
    } else {
      const before = baseLines.slice(s, ee);
      if (before.length) out.push(...before);
      pos = ee;
    }
  }
  if (pos < end) out.push(...baseLines.slice(pos, end));
  return out;
}

function buildSegments(leftEdits: DiffEdit[], rightEdits: DiffEdit[]) {
  let li = 0;
  let ri = 0;
  const segs: Array<{
    start: number;
    end: number;
    l: DiffEdit[];
    r: DiffEdit[];
  }> = [];
  while (li < leftEdits.length || ri < rightEdits.length) {
    const nextL =
      li < leftEdits.length
        ? leftEdits[li].baseStart
        : Number.POSITIVE_INFINITY;
    const nextR =
      ri < rightEdits.length
        ? rightEdits[ri].baseStart
        : Number.POSITIVE_INFINITY;
    const start = Math.min(nextL, nextR);
    let end = start;
    const l: DiffEdit[] = [];
    const r: DiffEdit[] = [];

    while (li < leftEdits.length && leftEdits[li].baseStart === start) {
      const e = leftEdits[li];
      l.push(e);
      end = Math.max(end, e.baseEnd);
      li++;
    }
    while (ri < rightEdits.length && rightEdits[ri].baseStart === start) {
      const e = rightEdits[ri];
      r.push(e);
      end = Math.max(end, e.baseEnd);
      ri++;
    }

    let changed = true;
    while (changed) {
      changed = false;
      while (li < leftEdits.length) {
        const e = leftEdits[li];
        const isInsert = e.baseStart === e.baseEnd;
        if (e.baseStart < end || (isInsert && e.baseStart === end)) {
          l.push(e);
          end = Math.max(end, e.baseEnd);
          li++;
          changed = true;
        } else break;
      }
      while (ri < rightEdits.length) {
        const e = rightEdits[ri];
        const isInsert = e.baseStart === e.baseEnd;
        if (e.baseStart < end || (isInsert && e.baseStart === end)) {
          r.push(e);
          end = Math.max(end, e.baseEnd);
          ri++;
          changed = true;
        } else break;
      }
    }
    segs.push({ start, end, l, r });
  }
  return segs;
}

function countThreeWayConflictBlocks(
  baseText: string,
  leftText: string,
  rightText: string
) {
  const baseLines = String(baseText ?? "").split("\n");
  const leftLines = String(leftText ?? "").split("\n");
  const rightLines = String(rightText ?? "").split("\n");
  const leftDiff = buildDiff(baseLines, leftLines);
  const rightDiff = buildDiff(baseLines, rightLines);
  const segments = buildSegments(leftDiff.edits, rightDiff.edits);
  if (!segments.length) return 0;

  let count = 0;
  for (const seg of segments) {
    const baseSeg = baseLines.slice(seg.start, seg.end);
    const leftSeg = applyEditsToBaseSegment(
      baseLines,
      seg.start,
      seg.end,
      seg.l
    );
    const rightSeg = applyEditsToBaseSegment(
      baseLines,
      seg.start,
      seg.end,
      seg.r
    );
    const leftChanged = !arraysEqual(leftSeg, baseSeg);
    const rightChanged = !arraysEqual(rightSeg, baseSeg);
    if (!leftChanged || !rightChanged) continue;
    if (arraysEqual(leftSeg, rightSeg)) continue;
    count += 1;
  }
  return count;
}

function computeAutoMergeText(
  baseText: string,
  leftText: string,
  rightText: string
) {
  const baseLines = String(baseText ?? "").split("\n");
  const leftLines = String(leftText ?? "").split("\n");
  const rightLines = String(rightText ?? "").split("\n");
  const leftDiff = buildDiff(baseLines, leftLines);
  const rightDiff = buildDiff(baseLines, rightLines);
  const segs = buildSegments(leftDiff.edits, rightDiff.edits);
  if (!segs.length) return String(baseText ?? "");

  const out: string[] = [];
  let pos = 0;
  for (const seg of segs) {
    if (pos < seg.start) out.push(...baseLines.slice(pos, seg.start));
    const baseSeg = baseLines.slice(seg.start, seg.end);
    const lSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.l);
    const rSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.r);
    if (arraysEqual(lSeg, rSeg)) out.push(...lSeg);
    else if (arraysEqual(lSeg, baseSeg)) out.push(...rSeg);
    else if (arraysEqual(rSeg, baseSeg)) out.push(...lSeg);
    else out.push(...baseSeg);
    pos = seg.end;
  }
  if (pos < baseLines.length) out.push(...baseLines.slice(pos));
  return out.join("\n");
}

type AnalyzeReq = {
  id: number;
  type: "analyze";
  base: string;
  left: string;
  right: string;
};
type AnalyzeRes =
  | {
      id: number;
      ok: true;
      conflictCount: number;
      merged: string | null;
      computeMs: number;
    }
  | { id: number; ok: false; error: string };

const ctx: any = self as any;

ctx.onmessage = (ev: any) => {
  const msg = ev.data as AnalyzeReq;
  const id = Number(msg?.id || 0);
  if (!id || msg?.type !== "analyze") return;
  try {
    const t0 = Date.now();
    const conflictCount = countThreeWayConflictBlocks(
      msg.base,
      msg.left,
      msg.right
    );
    const merged =
      conflictCount === 0
        ? computeAutoMergeText(msg.base, msg.left, msg.right)
        : null;
    const computeMs = Math.max(0, Date.now() - t0);
    const res: AnalyzeRes = { id, ok: true, conflictCount, merged, computeMs };
    ctx.postMessage(res);
  } catch (e) {
    const res: AnalyzeRes = { id, ok: false, error: String(e) };
    ctx.postMessage(res);
  }
};
