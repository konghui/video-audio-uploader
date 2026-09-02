import WebSocket from 'ws';
const sid = process.argv[2];
const ws = new WebSocket('ws://localhost:8080/ws', { headers: { Cookie: `sid=${sid}` } });
let n=0;
ws.on('open', ()=>console.log('[ws] connected'));
ws.on('message', (d)=>{ n++; const e=JSON.parse(d.toString()); console.log(`[ws] ${e.stage} ${Math.round(e.percent)}% status=${e.status} :: ${e.message.slice(0,80)}`); });
ws.on('close', ()=>console.log('[ws] closed'));
ws.on('error', (e)=>console.log('[ws] error', e.message));
setTimeout(()=>{ console.log(`[ws] done, ${n} events`); ws.close(); process.exit(0); }, 150000);
