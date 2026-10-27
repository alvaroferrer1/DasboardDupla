from pathlib import Path
import requests, json, re, time
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
base='http://127.0.0.1:39773'
html=(root/'edge/public/index.html').read_text()
html=re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
html=re.sub(r'<script type="module"[^>]*></script>', '', html)
css=(root/'edge/public/style.css').read_text()
js=(root/'edge/public/app.js').read_text()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 def make_session(width,height,ismobile,email,password):
  api=requests.Session()
  session_cookie={'value':None}
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=ismobile,has_touch=ismobile,device_scale_factor=2 if ismobile else 1)
  def remote(source,path,method='GET',body=None):
   headers={'Content-Type':'application/json','Origin':base}
   if session_cookie['value']: headers['Cookie']=session_cookie['value']
   r=api.request(method,base+path,data=body,headers=headers,timeout=15)
   if r.headers.get('Set-Cookie'): session_cookie['value']=r.headers['Set-Cookie'].split(';')[0]
   return {'status':r.status_code,'body':r.text,'contentType':r.headers.get('Content-Type','application/json')}
  ctx.expose_binding('remoteApi',remote)
  pg=ctx.new_page()
  errors=[];pg.on('pageerror',lambda exc:errors.append(str(exc)))
  pg.set_content(html)
  pg.add_style_tag(content=css)
  pg.evaluate('''() => {
    window.fetch=async (path, opts={})=>{
      const result=await window.remoteApi(path,opts.method||'GET',opts.body??null);
      return new Response(result.body,{status:result.status,headers:{'Content-Type':result.contentType}});
    };
    window.WebSocket=class {
     static OPEN=1;
     constructor(){this.readyState=1;setTimeout(()=>this.onopen?.(),5);}
     close(){this.readyState=3;}
    };
  }''')
  pg.add_script_tag(content=js)
  pg.locator('input[name="email"]').fill(email)
  pg.locator('input[name="password"]').fill(password)
  pg.locator('#login-form button[type="submit"]').click()
  pg.wait_for_timeout(1100)
  print('AFTER LOGIN',pg.locator('body').inner_text()[:700], 'errors',errors)
  pg.get_by_text('Inicio',exact=True).first.wait_for(timeout=13000)
  return ctx,pg,errors
 try:
  desktop,a,errors_a=make_session(1440,900,False,'usuario1@ejemplo.invalid','PruebaUna2026_Segura!')
  mobile,b,errors_b=make_session(390,844,True,'usuario2@ejemplo.invalid','PruebaDos2026_Segura!')
  print('logged in, a buttons',[(x.inner_text()[:32]) for x in a.locator('button').all()][:30]);print('b body',b.locator('body').inner_text()[:500])
  print('a errors',errors_a,'b errors',errors_b)
  a.get_by_role('button',name='Nueva idea o proyecto').click()
  print('modal visible',a.locator('.modal-card').count(),'form fields',[(i.get_attribute('name'),i.get_attribute('type')) for i in a.locator('.modal-card input,.modal-card select,.modal-card textarea').all()]); print('modal text',a.locator('.modal-card').inner_text()[:1600] if a.locator('.modal-card').count() else 'NONE')
  a.locator('.modal-card [name=title]').fill('PROYECTO UI DOBLE SESION')
  a.locator('.modal-card [name=space]').select_option('couple')
  a.locator('.modal-card [name=template]').select_option('blank')
  a.locator('.modal-card button[type=submit]').click()
  a.wait_for_timeout(650)
  print('POST SAVE',a.locator('body').inner_text()[-700:],'error',errors_a)
  a.screenshot(path=str(root.parent/'responsive_escritorio.png'),full_page=True)
  b.screenshot(path=str(root.parent/'responsive_movil.png'),full_page=True)
 finally:browser.close()
