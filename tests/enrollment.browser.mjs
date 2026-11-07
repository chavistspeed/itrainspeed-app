// Install Playwright separately or set PLAYWRIGHT_MODULE to its module path.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
import assert from 'node:assert/strict'
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE})
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:3100'
const path='/enroll/off-season-track'
const user={id:'guardian-1',email:'parent@example.test',aud:'authenticated',role:'authenticated'}
const jwt = 'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:2000000000,role:'authenticated'})).toString('base64url')+'.test'
const session={access_token:jwt,refresh_token:'test-refresh',expires_at:2000000000,expires_in:3600,token_type:'bearer',user}
const pkg={id:'pkg-track',name:'Off-Season Track & Field',credit_type:'track',access_type:'membership',price_cents:17500,payment_type:'subscription',description:'Track program',active:true}
const athletes=[{id:'athlete-1',first_name:'Alex',last_name:'Runner',age:12},{id:'athlete-2',first_name:'Sam',last_name:'Runner',age:14}]
const member={id:'ent-1',package_id:pkg.id,athlete_id:'athlete-1',guardian_id:user.id,status:'active',credit_type:'track',unlimited:true}
let passed=0
async function scenario(name, options, run){
 const context=await browser.newContext({viewport:{width:390,height:844}})
 if(options.signedIn!==false) await context.addCookies([{name:'sb-enrollment-test-auth-token',value:'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'),url:base}])
 const page=await context.newPage()
 const errors=[]; page.on('pageerror',err=>errors.push(err.message))
 let entitlements=options.entitlements||[]; let checkoutBody; let booked=false
 await page.route('https://enrollment-test.supabase.co/**',async route=>{
  const url=new URL(route.request().url()); const table=url.pathname.split('/').pop()
  let response
  if(table==='training_approved') response=options.approved!==false
  else if(url.pathname.includes('/auth/v1/token')) response=session
  else if(url.pathname.includes('/auth/v1/user')) response=user
  else if(table==='packages') response=options.unavailable?[]:[pkg]
  else if(table==='athletes') response=options.noAthletes?[]:athletes
  else if(table==='entitlements') response=entitlements
  else if(table==='profiles') response={id:user.id,full_name:'Parent Runner',waiver_accepted_at:options.waiver===false?null:'2026-01-01',waiver_version:'2026-01'}
  else if(table==='session_availability') response=[{id:'session-1',program_name:'Track Session',service_type:'track',start_at:'2027-01-01T12:00:00Z',min_age:8,max_age:18,capacity:10,booked_count:0},{id:'session-2',program_name:'Private Session',service_type:'private',start_at:'2027-01-01T12:00:00Z',capacity:10,booked_count:0}]
  else if(table==='bookings') response=booked?[{session_id:'session-1'}]:[]
  else if(table==='book_session_v15'){booked=true;response=null}
  else if(table==='sign_parent_waiver_v1') response=null
  else response=[]
  await route.fulfill({status:options.failLookup&&table==='entitlements'?500:200,contentType:'application/json',body:JSON.stringify(response)})
 })
 await page.route('**/api/stripe/create-checkout-session',async route=>{checkoutBody=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:base+path+'?athlete=athlete-1&checkout=success'})})})
 await page.route('**/api/notifications/**',route=>route.fulfill({status:200,body:'{}'}))
 try{await run({page,setEntitlements:e=>{entitlements=e},getCheckout:()=>checkoutBody});assert.deepEqual(errors,[]);passed++;console.log('PASS '+name)}
 finally{await context.close()}
}
try{
await scenario('logged-out link returns to program after login',{signedIn:false},async({page})=>{
 await page.goto(base+path);await page.waitForURL('**/login?**');assert.equal(new URL(page.url()).searchParams.get('next'),path)
 await page.getByLabel('Email').fill('parent@example.test');await page.getByLabel('Password').fill('password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(base+path);await page.getByRole('heading',{name:'Off-Season Track & Field',exact:true}).waitFor()
})
await scenario('explicit athlete choice, checkout payload, webhook activation, track booking',{},async({page,setEntitlements,getCheckout})=>{
 await page.goto(base+path);const enroll=page.getByRole('button',{name:'Enroll selected athlete'});await enroll.waitFor();assert.ok(await enroll.isDisabled())
 await page.getByRole('combobox').selectOption('athlete-1');await page.waitForURL('**/off-season-track?athlete=athlete-1');await enroll.click();await page.waitForURL('**checkout=success');assert.deepEqual(getCheckout(),{package_id:pkg.id,athlete_id:'athlete-1',enrollment:'off-season-track'})
 await page.getByText('Checking for your membership activation...').waitFor();assert.equal(await page.getByRole('button',{name:'Enroll selected athlete'}).count(),0)
 setEntitlements([member]);await page.getByRole('button',{name:'Refresh membership status'}).click();await page.getByRole('link',{name:'Book Track Training'}).click();await page.getByRole('heading',{name:'Track Session'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Private Session'}).count(),0)
 await page.getByRole('button',{name:/Book/}).click();await page.getByText('Training booked successfully.').waitFor()
})
await scenario('membership prevents repurchase and siblings remain separate',{entitlements:[{...member,cancel_at_period_end:true}]},async({page})=>{
 await page.goto(base+path+'?athlete=athlete-1');await page.getByText('This athlete already has this membership. No additional purchase is needed.').waitFor();await page.getByText('Cancellation is scheduled.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Enroll selected athlete'}).count(),0)
 await page.getByRole('combobox').selectOption('athlete-2');await page.getByRole('button',{name:'Enroll selected athlete'}).waitFor();assert.ok(await page.getByRole('button',{name:'Enroll selected athlete'}).isEnabled())
})
await scenario('waiver required and return retained',{waiver:false},async({page})=>{
 await page.goto(base+path+'?athlete=athlete-1');await page.getByRole('link',{name:'Review and sign waiver'}).waitFor();assert.ok(await page.getByRole('button',{name:'Enroll selected athlete'}).isDisabled());await page.getByRole('link',{name:'Review and sign waiver'}).click();await page.waitForURL('**/waiver?**');assert.equal(new URL(page.url()).searchParams.get('next'),path+'?athlete=athlete-1');
 await page.getByPlaceholder('Enter your full legal name').fill('Parent Runner');await page.getByRole('checkbox').check();await page.getByRole('radio').first().check();await page.getByRole('button',{name:'Accept & Sign Waiver'}).click();await page.getByRole('link',{name:'Continue to training'}).waitFor();assert.equal(await page.getByRole('link',{name:'Continue to training'}).getAttribute('href'),path+'?athlete=athlete-1')
})
await scenario('cancelled checkout retains athlete and allows retry',{},async({page})=>{await page.goto(base+path+'?athlete=athlete-2&checkout=cancelled');await page.getByText('Checkout was cancelled. Enrollment has not been completed.').waitFor();assert.equal(await page.getByRole('combobox').inputValue(),'athlete-2');assert.ok(await page.getByRole('button',{name:'Enroll selected athlete'}).isEnabled())})
await scenario('no athlete links to existing profile flow',{noAthletes:true},async({page})=>{await page.goto(base+path);await page.getByRole('link',{name:'Add athlete',exact:true}).click();await page.getByRole('link',{name:'Continue to Off-Season Track'}).waitFor()})
await scenario('unavailable catalog does not substitute another plan',{unavailable:true},async({page})=>{await page.goto(base+path);await page.getByText('This program is currently unavailable.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Enroll selected athlete'}).count(),0)})
await scenario('membership lookup error blocks purchase',{failLookup:true},async({page})=>{await page.goto(base+path);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Enroll selected athlete'}).count(),0)})
await scenario('unapproved returning families contact coach without repeating intro',{approved:false},async({page})=>{await page.goto(base+path+'?athlete=athlete-1');await page.getByText('Your coach needs to confirm your returning-family training access.',{exact:false}).waitFor();assert.ok(await page.getByRole('button',{name:'Enroll selected athlete'}).isDisabled());assert.equal(await page.getByRole('link',{name:'Schedule an intro call'}).count(),0)})
console.log(`${passed} browser scenarios passed`)
}finally{await browser.close()}
