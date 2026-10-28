import { expect, type Page, type TestInfo } from '@playwright/test';

/** Chromium AX inspection is exposure evidence, not screen-reader speech certification. */
export async function expectUpdateAnnouncement(page: Page, text: string, info: TestInfo) {
  const main = page.locator('main');
  await expect(main).toHaveAttribute('inert', '');
  const notice = page.locator('p.visually-hidden[role="status"]').filter({ hasText: text });
  await expect(notice).toHaveCount(1);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'p.visually-hidden[role="status"]',
    });
    let backendNodeId: number | undefined;
    for (const nodeId of nodeIds) {
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
      if (!outerHTML.includes(text)) continue;
      backendNodeId = (await cdp.send('DOM.describeNode', { nodeId })).node.backendNodeId;
    }
    expect(backendNodeId).toBeDefined();
    const partial = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId });
    const full = await cdp.send('Accessibility.getFullAXTree');
    const exposed = full.nodes.filter((node) => !node.ignored);
    const evidence = {
      text,
      inert: await main.evaluate((element) => (element as HTMLElement).inert),
      notice: await notice.evaluate((element) => ({
        html: element.outerHTML,
        inertAncestor: !!element.closest('[inert]'),
      })),
      partial,
      full,
    };
    await info.attach('held-update-accessibility-tree', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    const status = partial.nodes.find((node) => node.backendDOMNodeId === backendNodeId)!;
    expect(status.ignored, 'the applying announcement must not inherit inert exclusion').toBe(
      false,
    );
    expect(status.role?.value).toBe('status');
    expect(status.name?.value).toBe(text);
    expect(status.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'live',
          value: expect.objectContaining({ value: 'polite' }),
        }),
        expect.objectContaining({
          name: 'atomic',
          value: expect.objectContaining({ value: true }),
        }),
      ]),
    );
    expect(exposed.filter((node) => node.role?.value === 'status')).toHaveLength(1);
    expect(
      exposed.filter((node) => node.role?.value === 'StaticText' && node.name?.value === text),
    ).toHaveLength(1);
    expect(
      exposed.filter((node) =>
        ['button', 'checkbox', 'combobox', 'textbox', 'link', 'main'].includes(
          String(node.role?.value),
        ),
      ),
    ).toHaveLength(0);
    expect(evidence.notice.inertAncestor).toBe(false);
    // Native focus is blocked, not just hidden from role locators. No forced clicks.
    const controls = main.locator('button, input, select, textarea, a[href]');
    expect(await controls.count()).toBeGreaterThan(0);
    expect(
      await controls.first().evaluate((element) => {
        (element as HTMLElement).focus();
        return document.activeElement === element;
      }),
    ).toBe(false);
    expect(
      await controls
        .first()
        .click({ trial: true, timeout: 150 })
        .then(
          () => true,
          () => false,
        ),
    ).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await cdp.detach();
  }
}
