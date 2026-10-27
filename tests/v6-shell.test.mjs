// DUPLA 6 · armazón: menú y cabecera solo enlazan a páginas reales; búsqueda rápida conectada.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../edge/public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../edge/public/style.css',import.meta.url),'utf8');

test('DUPLA 6: cada data-nav apunta a una vista que content() sabe pintar',()=>{
 const body=app.slice(app.indexOf('function content(){'),app.indexOf('\n',app.indexOf('function content(){')));
 const views=new Set([...body.matchAll(/case '(\w+)'/g)].map(m=>m[1]).concat('home'));
 const navs=new Set([...app.matchAll(/data-nav="(\w+)"/g)].map(m=>m[1]));
 for(const fn of ['sidebar','header']){const src=app.slice(app.indexOf(`function ${fn}(){`));for(const m of src.slice(0,src.indexOf('\n')).matchAll(/(?:navBtn|tab)\('(\w+)'/g))navs.add(m[1]);}
 assert(navs.size>=14,'el menú debe mantener todas las secciones existentes');
 for(const v of navs)assert(views.has(v),'Enlace a vista inexistente: '+v);
 for(const v of ['home','work','couple','dates','ideas','guardian','activity','connections','settings','actions','search','notices','knowledge','intelligence'])assert(navs.has(v),'Falta en el menú: '+v);
});

test('DUPLA 6: búsqueda rápida en cabecera, Ctrl+K y estilos del armazón',()=>{
 assert.match(app,/id="quick-search"/);
 assert.match(app,/ev\.target\.id==='quick-search'/);
 assert.match(app,/await runSearch\(q\);nav\('search'\)/);
 assert.match(app,/S\.searchResults=await api\('\/api\/search\?'\+qs\)/);
 assert.match(app,/\(ev\.ctrlKey\|\|ev\.metaKey\)&&ev\.key\.toLowerCase\(\)==='k'/);
 assert.match(app,/aria-label="Notificaciones: \$\{unread\} sin leer"/);
 assert(css.includes('/* DUPLA 6 · Fusión con la imagen de referencia'));
 assert(!app.includes('rx=2/'),'icono SVG con atributos sin comillas');
});
