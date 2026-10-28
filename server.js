// Development server only. Deploy static assets with a production static host.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const args=process.argv.slice(2),value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const root=resolve(import.meta.dirname);const allowed=new Set(['/','/index.html','/app.js','/domain.js','/style.css']);
http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(!allowed.has(pathname)){res.writeHead(404);return res.end('Not found');}const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep))throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]+'; charset=utf-8','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(Number(value('--port',3000)),value('--host','127.0.0.1'),()=>console.log('Inboxy development server ready'));
