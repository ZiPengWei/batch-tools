import { expect, test } from "@playwright/test";

async function waitForAnyButton(list: any) {
  await expect
    .poll(async () => {
      return await list.locator("button").count();
    })
    .toBeGreaterThan(0);
}

async function shadowState(list: any) {
  return await list.evaluate((el: HTMLElement) => {
    const top = el.children[0] as HTMLElement | undefined;
    const bottom = el.children[1] as HTMLElement | undefined;
    const topDisplay = top ? getComputedStyle(top).display : "";
    const bottomDisplay = bottom ? getComputedStyle(bottom).display : "";
    return { topDisplay, bottomDisplay };
  });
}

test("三列表支持独立滚动与边界阴影反馈", async ({ page }) => {
  await page.goto("/");

  const projectList = page.locator('[aria-label="项目列表"]');
  const sourceList = page.locator('[aria-label="源分支列表"]');
  const targetList = page.locator('[aria-label="目标分支列表"]');

  await expect(projectList).toBeVisible();
  await expect(sourceList).toBeVisible();
  await expect(targetList).toBeVisible();

  await waitForAnyButton(projectList);
  await waitForAnyButton(sourceList);
  await waitForAnyButton(targetList);

  const projectDims = await projectList.evaluate((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      rectHeight: rect.height,
      overflowY: cs.overflowY,
      position: cs.position,
    };
  });
  if (projectDims.overflowY !== "auto" && projectDims.overflowY !== "scroll") {
    throw new Error(`项目列表 overflowY 非滚动：${JSON.stringify(projectDims)}`);
  }
  if (!(projectDims.scrollHeight > projectDims.clientHeight)) {
    throw new Error(`项目列表未产生溢出滚动：${JSON.stringify(projectDims)}`);
  }

  await expect
    .poll(async () => {
      const s = await shadowState(projectList);
      return s.topDisplay === "none" && s.bottomDisplay !== "none";
    })
    .toBe(true);

  const sourceInitial = await shadowState(sourceList);
  expect(sourceInitial.topDisplay).toBe("none");

  await projectList.evaluate((el: HTMLElement) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    el.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(async () => {
      const s = await shadowState(projectList);
      return s.topDisplay !== "none" && s.bottomDisplay !== "none";
    })
    .toBe(true);

  const sourceStill = await shadowState(sourceList);
  expect(sourceStill.topDisplay).toBe("none");

  await projectList.evaluate((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(async () => {
      const s = await shadowState(projectList);
      return s.bottomDisplay === "none";
    })
    .toBe(true);
});

test("合并弹窗日志会自动滚动到底部", async ({ page }) => {
  await page.goto("/");

  const targetList = page.locator('[aria-label="目标分支列表"]');
  await expect(targetList).toBeVisible();
  await waitForAnyButton(targetList);
  await targetList.locator("button").first().click();

  const startBtn = page.getByRole("button", { name: /开始批量合并/ }).first();
  await expect(startBtn).toBeEnabled();
  await startBtn.click();
  await page.getByRole("button", { name: "确认" }).click();

  const wrap = page.locator('[data-testid="confirm-log-wrapper"]');
  await expect(wrap).toBeVisible();

  await expect(wrap.getByText(/E2E step/).first()).toBeVisible();

  const logContent = wrap.locator(".n-log .n-scrollbar-container");
  const fallback = wrap.locator(".n-log");
  const content = (await logContent.count()) ? logContent.first() : fallback.first();

  await expect
    .poll(async () => {
      return await content.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight);
    })
    .toBe(true);

  await expect
    .poll(async () => {
      return await content.evaluate((el: HTMLElement) => {
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) return true;
        return el.scrollTop >= max - 4;
      });
    })
    .toBe(true);
});
