import { test, expect } from '@playwright/test'

test.describe('mobile shell', () => {
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    test(`login fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Violin Lesson Invoices' })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      const inputs = page.locator('input')
      for (const input of await inputs.all()) {
        const box = await input.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      }
    })
  }

  test('keyboard focus is visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/')
    const email=page.getByRole('textbox', { name: 'Email' })
    await expect(page.getByRole('heading', { name: 'Violin Lesson Invoices' })).toBeVisible()
    await expect(email).toBeVisible()
    await email.focus()
    await page.keyboard.press('Tab')
    const password=page.getByLabel('Password')
    await expect(password).toBeFocused()
    const focusStyle = await password.evaluate(element => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    expect(focusStyle.outlineStyle).not.toBe('none')
    expect(parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0)
  })
})
