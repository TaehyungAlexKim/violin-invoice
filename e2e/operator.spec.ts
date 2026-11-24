import { test, expect } from '@playwright/test'

test('fixture-backed browser coverage: mobile operator, retry, duplicate, and invoice guards', async ({ page }) => {
  test.setTimeout(60_000)
  // Mock JWT/session and REST only exercise client routing and browser behavior.
  // This is not real Supabase AAL2/RLS integration validation; those remain in Supabase/live tests.
  const pageErrors: string[]=[]
  const consoleAuthErrors:string[]=[]
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message=>{
    if(/auth|jwt|token|session/i.test(message.text())) consoleAuthErrors.push(message.text())
  })
  const jwtHeader = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url')
  const jwtPayload = Buffer.from(JSON.stringify({
    aud:'authenticated', role:'authenticated', sub:'operator-1',
    aal:'aal2', exp:Math.floor(Date.now()/1000)+3600,
  })).toString('base64url')
  const jwt=`${jwtHeader}.${jwtPayload}.c2lnbmF0dXJl`
  await page.addInitScript(({ token, jwt }) => {
    const session={access_token:jwt,refresh_token:'fixture-refresh',expires_in:3600,
      expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',
      user:{id:'operator-1',email:'operator@example.test',aud:'authenticated',role:'authenticated',
        app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()}}
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
    localStorage.setItem(token,JSON.stringify(session))
  },{token:'sb-127.0.0.1-auth-token',jwt})
  await page.route('**/auth/v1/**', async route => {
    const url = route.request().url()
    if (url.includes('/user') || url.includes('/session')) {
      await route.fulfill({ json: { id:'operator-1',email:'operator@example.test',aud:'authenticated',role:'authenticated' } })
    } else if (url.includes('/token')) {
      await route.fulfill({ json: {
        access_token:'fixture-access', refresh_token:'fixture-refresh', expires_in:3600,
        token_type:'bearer', user:{id:'operator-1',email:'operator@example.test'},
      }})
    } else if (url.includes('/factors')) {
      await route.fulfill({ json: { all:[{id:'totp-1',factor_type:'totp',friendly_name:'Fixture MFA',status:'verified'}],totp:[{id:'totp-1',factor_type:'totp',friendly_name:'Fixture MFA',status:'verified'}] } })
    } else if (url.includes('/assurance')) {
      await route.fulfill({ json: { current_level:'aal2',next_level:'aal2',current_authentication_methods:[{method:'totp',timestamp:0}] } })
    } else {
      await route.abort('failed')
    }
  })
  await page.route('**/rest/v1/**', async route => {
    const url = route.request().url()
    const method=route.request().method()
    if (url.includes('app_operators')) {
      await route.fulfill({ json: { workspace_owner_id:'owner-1' }, headers: { 'content-type':'application/vnd.pgrst.object+json' } })
    } else if (url.includes('students')) {
      await route.fulfill({ json: [{ id:'student-1', name:'Test Student', recipient_name:null, email:null, phone:null, billing_address:null, memo:null }] })
    } else if (url.includes('lessons')) {
      await route.fulfill({ json: [{ id:'lesson-1', student_id:'student-1', lesson_date:'2026-11-20', minutes:60, charge_cents:6500, entry_key:'fixture' }] })
    } else if (url.includes('invoices') && method==='GET' && url.includes('id=eq.invoice-1')) {
      await route.fulfill({ json: { id:'invoice-1', student_id:'student-1', status:'draft', period_start:'2026-11-01', period_end:'2026-11-23', invoice_number:null, snapshot_json:null }, headers:{'content-type':'application/vnd.pgrst.object+json'} })
    } else if (url.includes('invoices') && method==='POST') {
      await route.fulfill({ status:409, json:{code:'23505',message:'duplicate operation'}, headers:{'content-type':'application/json'} })
    } else if (url.includes('invoices') && method==='GET' && url.includes('entry_key=eq.')) {
      const entryKey=new URL(url).searchParams.get('entry_key')?.replace(/^eq\./,'') || ''
      await route.fulfill({
        json:{id:'invoice-conflict',student_id:'student-2',status:'draft',entry_key:entryKey,
          period_start:'2026-11-01',period_end:'2026-11-23',invoice_number:null,snapshot_json:null},
        headers:{'content-type':'application/vnd.pgrst.object+json'},
      })
    } else if (url.includes('invoices') && method==='GET' && url.includes('status=eq.finalized')) {
      await route.fulfill({ json: [] })
    } else if (url.includes('invoice_lesson_claims')) {
      await route.fulfill({ json: [] })
    } else if (url.includes('teacher_settings')) {
      await route.fulfill({ json: { teacher_name:'Test Teacher', business_name:null, address:null, email:null, phone:null, currency:'CAD' } })
    } else {
      await route.abort('failed')
    }
  })

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('http://127.0.0.1:4173/violin-invoice/')
  await page.evaluate(({jwt})=>{
    const session={access_token:jwt,refresh_token:'fixture-refresh',expires_in:3600,
      expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',
      user:{id:'operator-1',email:'operator@example.test',aud:'authenticated',role:'authenticated',
        app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()}}
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
  },{jwt})
  await page.goto('http://127.0.0.1:4173/violin-invoice/#/students')
  await expect(page).not.toHaveURL(/#\/login/)
  await expect(page).toHaveURL(/#\/students/)
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()

  await page.goto('http://127.0.0.1:4173/violin-invoice/#/invoices/new')
  await expect(page.getByRole('heading',{name:'Create invoice'})).toBeVisible()
  await page.getByLabel('Student').selectOption('student-1')
  await page.getByRole('button',{name:'Create draft'}).dblclick()
  await expect(page).toHaveURL(/#\/invoices\/new/)
  await expect(page.getByText(/draft key belongs to a different operation/i)).toBeVisible()
  await expect(page.getByRole('button',{name:'Retry'})).toBeEnabled()

  await page.goto('http://127.0.0.1:4173/violin-invoice/#/lessons')
  await expect(page).toHaveURL(/#\/lessons/)
  await expect(page.getByRole('heading',{name:'Lessons'})).toBeVisible()
  await expect(page.getByText('Test Student').last()).toBeVisible()
  await expect(page.getByLabel('Student').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Delete' })).toBeEnabled()

  await page.goto('http://127.0.0.1:4173/violin-invoice/#/invoices/invoice-1')
  await expect(page).toHaveURL(/#\/invoices\/invoice-1/)
  await expect(page.getByRole('heading',{name:'Invoice draft'})).toBeVisible()
  await expect(page.getByText(/Preview:|No unbilled|overlaps/i)).toBeVisible()
  await expect(page.getByRole('button',{name:'Finalize and download'})).toBeVisible()
  await page.getByRole('button',{name:'Preview'}).click()
  await expect(page.getByText(/Preview:/)).toBeVisible()
  await page.getByLabel('End date').fill('2026-11-22')
  await expect(page.getByText(/Preview:|stale|incomplete/i)).toBeVisible()

  await page.goto('http://127.0.0.1:4173/violin-invoice/#/students')
  await expect(page).toHaveURL(/#\/students/)
  expect(pageErrors).toEqual([])
  expect(consoleAuthErrors).toEqual([])
})

for (const width of [320,375,390,430,768,1280]) {
  test(`responsive shell at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('http://127.0.0.1:4173/violin-invoice/')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}
