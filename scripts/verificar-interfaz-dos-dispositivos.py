"""Real Chromium DOM / CSS / click tests with genuine API+SQLite requests forwarded
from the host because this runtime forbids browser network navigation.
WebSocket network itself is tested independently by verificar-ws-local.mjs.
No production data or physical devices are involved.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import requests, re, json, os, time
root=Path(__file__).resolve().parents[1]
output=Path(os.getenv('DUPLA_TEST_OUT',root.parent/'PRUEBAS_VISUALES'))
output.mkdir(parents=True,exist_ok=True)
base=os.getenv('DUPLA_TEST_URL','http://127.0.0.1:39773')
html=(root/'edge/public/index.html').read_text()
html=re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
html=re.sub(r'<script type="module"[^>]*></script>', '', html)
css=(root/'edge/public/style.css').read_text()
js=(root/'edge/public/app.js').read_text()
results=[]
def ck(name,condition,details=''):
 results.append({'name':name,'passed':bool(condition),'details':details})
 if not condition: raise AssertionError(f'{name}: {details}')
 print('OK',name)

def boot(browser,width,height,mobile,email,password):
 client=requests.Session();cookie={'value':None}
 ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile,device_scale_factor=2 if mobile else 1)
 def forward(source,path,method='GET',body=None):
  headers={'Content-Type':'application/json','Origin':base}
  if cookie['value']:headers['Cookie']=cookie['value']
  r=client.request(method,base+path,data=body,headers=headers,timeout=15)
  if r.headers.get('Set-Cookie'):cookie['value']=r.headers['Set-Cookie'].split(';')[0]
  return {'status':r.status_code,'body':r.text,'contentType':r.headers.get('Content-Type','application/json')}
 ctx.expose_binding('remoteApi',forward)
 pg=ctx.new_page();errors=[];pg.on('pageerror',lambda err:errors.append(str(err)))
 pg.set_content(html);pg.add_style_tag(content=css)
 pg.evaluate('''() => {
  window.fetch=async(path,opts={})=>{const r=await window.remoteApi(path,opts.method||'GET',opts.body??null);return new Response(r.body,{status:r.status,headers:{'Content-Type':r.contentType}})};
  window.WebSocket=class {static OPEN=1;constructor(){this.readyState=1;setTimeout(()=>this.onopen?.(),5)}close(){this.readyState=3}};
 }''')
 pg.add_script_tag(content=js)
 pg.locator('#login-form [name=email]').fill(email)
 pg.locator('#login-form [name=password]').fill(password)
 pg.locator('#login-form [type=submit]').click()
 pg.locator('[data-nav=home]').wait_for(timeout=12000)
 return pg,ctx,errors

def emit_to_other(page,space,id):
 page.evaluate('''({space,id}) => {const msg={space,projectId:id,actor:'another-user',at:new Date().toISOString()};S.stream.onmessage?.({data:JSON.stringify(msg)})}''',{'space':space,'id':id})

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.getenv('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
 try:
  a,ctx_a,errors_a=boot(browser,1440,900,False,'usuario1@ejemplo.invalid','PruebaUna2026_Segura!')
  b,ctx_b,errors_b=boot(browser,390,844,True,'usuario2@ejemplo.invalid','PruebaDos2026_Segura!')
  ck('Dos sesiones independientes inician sesión por interfaz',a.locator('.shell').count()==1 and b.locator('.shell').count()==1)
  title='UI Compartido '+str(int(time.time()))
  a.get_by_role('button',name='Nueva idea o proyecto').click()
  a.locator('.modal-card [name=title]').fill(title)
  a.locator('.modal-card [name=space]').select_option('couple')
  a.locator('.modal-card [name=template]').select_option('blank')
  a.locator('.modal-card [type=submit]').click()
  a.locator('.project-page h1').filter(has_text=title).wait_for(timeout=10000)
  pid=a.evaluate('S.project.id')
  ck('Crear proyecto desde navegador escritorio y guardarlo',bool(pid))
  emit_to_other(b,'couple',pid)
  b.locator('[data-nav=couple]').click();b.locator(f'[data-project="{pid}"]').wait_for(timeout=15000)
  ck('Nueva ficha aparece en segundo navegador móvil',b.locator(f'[data-project="{pid}"]').count()>0)
  b.locator(f'[data-project="{pid}"]').click()
  b.locator('.project-page h1').filter(has_text=title).wait_for(timeout=10000)
  b.locator('.project-main-head [data-action=new-task]').click()
  b.locator('.modal-card [name=title]').fill('Tarea creada en el móvil')
  b.locator('.modal-card [type=submit]').click()
  b.get_by_text('Tarea creada en el móvil').first.wait_for(timeout=10000)
  ck('Móvil guarda tarea en proyecto compartido',True)
  emit_to_other(a,'couple',pid)
  a.get_by_text('Tarea creada en el móvil').first.wait_for(timeout=10000)
  ck('Escritorio recupera tarea creada por segundo usuario',True)
  # Force a disconnected interval and then invoke the same resynchronization used
  # by the application when a WebSocket reconnects.
  b.evaluate('S.stream.close();S.stream.readyState=3')
  a.locator('[data-action=edit-project]').first.click()
  a.locator('.modal-card [name=description]').fill('Descripción guardada mientras el móvil estaba desconectado')
  a.locator('.modal-card [type=submit]').click()
  a.locator('.project-description').filter(has_text='Descripción guardada').wait_for(timeout=10000)
  b.evaluate('S.stream.onopen?.()')
  b.locator('.project-description').filter(has_text='Descripción guardada').wait_for(timeout=12000)
  ck('Reconciliación visual de datos tras reconectar',True)
  widths=[280,320,360,375,390,430,600,667,768,844,1024,1280,1440,1920]
  tested=[]
  for w in widths:
   b.set_viewport_size({'width':w,'height':844 if w<850 else 900})
   info=b.evaluate('''() => ({width:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth,
      heading:document.querySelector('.project-main-head')?.getBoundingClientRect().width||0,
      badImages:[...document.images].filter(img=>img.complete && img.naturalWidth===0).length})''')
   tested.append({'screen':w,**info})
   ck(f'Responsive sin desbordamiento horizontal {w}px',info['scroll']<=info['width']+2,str(info))
  for w in [320,390,768,1440]:
   b.set_viewport_size({'width':w,'height':844 if w<850 else 900})
   b.screenshot(path=str(output/f'proyecto_{w}px.png'),full_page=True)
  b.set_viewport_size({'width':390,'height':844})
  for tab in b.locator('.project-tabs [data-tab]').all():
   key=tab.get_attribute('data-tab');tab.click();b.wait_for_timeout(45)
   widths_now=b.evaluate('''() => [document.documentElement.scrollWidth,document.documentElement.clientWidth]''')
   ck(f'Pestaña {key} usable en móvil',widths_now[0]<=widths_now[1]+2)
  ck('Sin excepciones JS en escritorio y móvil',not errors_a and not errors_b,f'A={errors_a}, B={errors_b}')
  print('COMPROBACIONES:',len(results),'aprobadas',sum(x['passed'] for x in results))
  (output/'resultado_qa.json').write_text(json.dumps({'checks':results,'widths':tested,'limitations':['Navegación interceptada por políticas del navegador; se verifica JS/CSS Chromium y peticiones reales a API SQLite por puente','WebSocket visual simulado; WebSocket de red real cubierto en verificar-ws-local.mjs','No son móviles físicos ni cuentas de producción']},ensure_ascii=False,indent=2))
 finally:browser.close()
