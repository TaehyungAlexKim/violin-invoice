import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const snapshot = {
  schemaVersion: 1,
  currency: 'CAD',
  businessTimezone: 'America/Vancouver',
  locale: 'en-CA',
  invoice: { id:'invoice-1', number:'VI-2026-000001', status:'finalized', issueDate:'2026-11-23' },
  servicePeriod: { start:'2026-11-01', end:'2026-11-23' },
  sender: { name:'Test Teacher', address:'Vancouver, BC', email:'teacher@example.test' },
  recipient: { name:'김민수' },
  lines: [{ sourceLessonId:'lesson-1', lessonDate:'2026-11-20', minutes:60, chargeCents:6500 }],
  subtotalCents:6500, taxCents:0, totalCents:6500,
  render: {
    fontManifest: {
      family:'Noto Sans KR',
      normalFile:'NotoSansKR-subset-2.0.ttf',
      sha256:'c9a5624db8919577ac53deb3a111dc6561bd4b69c06774288cc634a630f24c60',
      license:'OFL-1.1', normalOnly:true, licenseFile:'OFL.txt',
    },
    templateVersion:'2.0', rendererName:'pdfmake', rendererVersion:'0.3.15',
  },
}

test('375px slow-3G production finalized PDF download', async ({ page, context }) => {
  test.setTimeout(120_000)
  const pageErrors:string[]=[]
  const consoleAuthErrors:string[]=[]
  page.on('pageerror', error=>pageErrors.push(error.message))
  page.on('console', message=>{
    if(/auth|jwt|token/i.test(message.text())) consoleAuthErrors.push(message.text())
  })
  await page.setViewportSize({ width:375, height:812 })
  const cdp=await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions',{
    offline:false, latency:400, downloadThroughput:400*1024/8, uploadThroughput:100*1024/8,
  })

  // Fixture session/fake JWT is only for client routing. This is browser coverage,
  // not real Supabase AAL2 or RLS integration validation (covered in Supabase tests/live).
  await page.addInitScript(()=>{
    const jwt='eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhYWwiOiJhYWwyIiwic3ViIjoib3BlcmF0b3ItMSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.c2lnbmF0dXJl'
    const session={access_token:jwt,refresh_token:'fixture-refresh',expires_in:3600,
      expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',
      user:{id:'operator-1',email:'operator@example.test',aud:'authenticated',role:'authenticated',
        app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()}}
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
  })

  await page.route('**/auth/v1/**', async route=>{
    const url=route.request().url()
    if(url.includes('/user')) return route.fulfill({json:{id:'operator-1',email:'operator@example.test',aud:'authenticated',role:'authenticated'}})
    if(url.includes('/factors')) return route.fulfill({json:{all:[{id:'totp-1',factor_type:'totp',status:'verified'}],totp:[{id:'totp-1',factor_type:'totp',status:'verified'}]}})
    if(url.includes('/assurance')) return route.fulfill({json:{current_level:'aal2',next_level:'aal2',current_authentication_methods:[{method:'totp',timestamp:0}]}})
    if(url.includes('/token')) return route.abort('accessdenied')
    return route.abort('failed')
  })
  await page.route('**/rest/v1/**', async route=>{
    const url=route.request().url()
    if(url.includes('app_operators')){
      return route.fulfill({json:{workspace_owner_id:'owner-1'},headers:{'content-type':'application/vnd.pgrst.object+json'}})
    }
    if(url.includes('students')){
      return route.fulfill({json:[{id:'student-1',name:'김민수',recipient_name:'김민수',email:null,phone:null,billing_address:null,memo:null}]})
    }
    if(url.includes('teacher_settings')){
      return route.fulfill({json:{teacher_name:'Test Teacher',business_name:'Studio',address:null,email:null,phone:null,currency:'CAD'},headers:{'content-type':'application/vnd.pgrst.object+json'}})
    }
    if(url.includes('invoices')){
      return route.fulfill({json:{id:'invoice-1',student_id:'student-1',status:'finalized',
        period_start:'2026-11-01',period_end:'2026-11-23',invoice_number:'VI-2026-000001',
        issue_date:'2026-11-23',finalized_at:'2026-11-23T20:00:00Z',snapshot_json:snapshot},
        headers:{'content-type':'application/vnd.pgrst.object+json'}})
    }
    return route.abort('failed')
  })

  let fontRequestBytes=0
  let fontResponseBytes=0
  let fontRequestUrl=''
  page.on('response', response=>{
    if(response.url().includes('/fonts/NotoSansKR-subset-2.0.ttf')){
      fontRequestUrl=response.url()
      const length=response.headers()['content-length']
      if(length) fontResponseBytes=Number(length)
    }
  })
  let fontFinishedBytes=0
  cdp.on('Network.responseReceived',(event:any)=>{
    if(event.response.url.includes('/fonts/NotoSansKR-subset-2.0.ttf')){
      fontRequestBytes=event.response.encodedDataLength||0
      fontRequestUrl=event.response.url
    }
  })
  cdp.on('Network.loadingFinished',(event:any)=>{
    if(fontRequestUrl) fontFinishedBytes=event.encodedDataLength||0
  })

  await page.goto('http://127.0.0.1:4173/violin-invoice/')
  await page.evaluate(()=>{
    const jwt='eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhYWwiOiJhYWwyIiwic3ViIjoib3BlcmF0b3ItMSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.c2lnbmF0dXJl'
    const session={access_token:jwt,refresh_token:'fixture-refresh',expires_in:3600,
      expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',
      user:{id:'operator-1',email:'operator@example.test',aud:'authenticated',role:'authenticated',
        app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()}}
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
  })
  await page.goto('http://127.0.0.1:4173/violin-invoice/#/invoices/invoice-1')
  await expect(page).toHaveURL(/#\/invoices\/invoice-1/)
  await expect(page.getByRole('heading',{name:'Invoice VI-2026-000001'})).toBeVisible()
  const downloadPromise=page.waitForEvent('download')
  const started=Date.now()
  await page.getByRole('button',{name:'Download PDF'}).click()
  await expect(page.getByRole('status')).toContainText(/Preparing PDF|Loading PDF|Generating PDF|PDF download started|Preparing PDF font/i,{timeout:15_000})
  const download=await downloadPromise
  const elapsed=Date.now()-started
  const path=await download.path()
  expect(path).toBeTruthy()
  const downloaded=await readFile(path!)
  expect(downloaded.subarray(0,5).toString()).toBe('%PDF-')

  const font=await readFile('public/fonts/NotoSansKR-subset-2.0.ttf')
  await expect.poll(()=>fontRequestUrl).toContain('/fonts/NotoSansKR-subset-2.0.ttf')
  expect(font.byteLength).toBe(4108588)
  expect(fontFinishedBytes||fontResponseBytes||fontRequestBytes).toBeGreaterThan(4000000)
  expect(downloaded.byteLength).toBeGreaterThan(1000)
  expect(pageErrors).toEqual([])
  expect(consoleAuthErrors).toEqual([])
  console.log(JSON.stringify({
    fontBytes:font.byteLength,pdfBytes:downloaded.byteLength,elapsedMs:elapsed,
    measuredFontTransferBytes:fontFinishedBytes||fontResponseBytes||fontRequestBytes,
  }))
})
