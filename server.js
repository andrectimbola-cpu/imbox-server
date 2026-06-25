// =====================================================
// INBOX WHATSAPP - Serviço (Railway)
// =====================================================
const express = require('express');
const app = express();
app.use(express.json({ limit: '25mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const PORT = process.env.PORT || 3000;

const H = { apikey: SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json' };
async function sbGet(p){ const r=await fetch(`${SUPABASE_URL}/rest/v1/${p}`,{headers:H}); return r.json(); }
async function sbPost(t,b){ const r=await fetch(`${SUPABASE_URL}/rest/v1/${t}`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(b)}); return r.json(); }
async function sbPatch(t,q,b){ await fetch(`${SUPABASE_URL}/rest/v1/${t}?${q}`,{method:'PATCH',headers:H,body:JSON.stringify(b)}); }

function limparTel(t){ let n=(t||'').replace(/\D/g,''); if(n.length<=11&&!n.startsWith('55'))n='55'+n; return n; }

async function zapiTexto(tel,msg){
  const r=await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,{
    method:'POST',headers:{'Content-Type':'application/json','Client-Token':ZAPI_CLIENT_TOKEN},
    body:JSON.stringify({phone:limparTel(tel),message:msg})});
  return r.json();
}

// =====================================================
// 1. WEBHOOK — recebe mensagens
// =====================================================
app.post('/webhook', async (req,res)=>{
  res.sendStatus(200);
  try{
    const d = req.body;
    const ehMinha = !!d.fromMe;
    const tel = limparTel(d.phone);
    if(!tel) return;
    if (ehMinha && (d.fromApi || d.fromAPI)) return;

    let tipo='texto', conteudo='', midia_url=null;
    if(d.text?.message){ tipo='texto'; conteudo=d.text.message; }
    else if(d.image){ tipo='imagem'; midia_url=d.image.imageUrl; conteudo=d.image.caption||''; }
    else if(d.audio){ tipo='audio'; midia_url=d.audio.audioUrl; }
    else if(d.video){ tipo='video'; midia_url=d.video.videoUrl; conteudo=d.video.caption||''; }
    else if(d.document){ tipo='documento'; midia_url=d.document.documentUrl; conteudo=d.document.fileName||''; }
    else if(d.sticker){ tipo='figurinha'; midia_url=d.sticker.stickerUrl; }
    else { conteudo='(mensagem não suportada)'; }

    const nome = d.senderName || d.chatName || tel;
    const foto = d.senderPhoto || null;
    const preview = tipo==='texto' ? conteudo : '📎 '+tipo;
    const agora = new Date().toISOString();
    const direcao = ehMinha ? 'enviada' : 'recebida';

    let conv = (await sbGet(`conversas?telefone=eq.${tel}`))[0];
    if(!conv){
      const novo = await sbPost('conversas',{telefone:tel,nome,foto,ultima_mensagem:preview,ultima_em:agora,nao_lidas: ehMinha?0:1});
      conv = Array.isArray(novo)?novo[0]:novo;
    } else {
      await sbPatch('conversas',`id=eq.${conv.id}`,{
        ultima_mensagem:preview, ultima_em:agora,
        nao_lidas: ehMinha ? (conv.nao_lidas||0) : (conv.nao_lidas||0)+1,
        ...(foto&&!conv.foto?{foto}:{}),
        ...(conv.nome===conv.telefone&&nome!==tel?{nome}:{})
      });
    }
    await sbPost('mensagens',{conversa_id:conv.id,telefone:tel,direcao,tipo,conteudo,midia_url,zaapi_id:d.messageId||null});
    console.log(`${direcao==='enviada'?'Enviada por mim':'Recebida'} (${nome}): ${preview}`);
  }catch(e){ console.error('Erro webhook:',e.message); }
});

// =====================================================
// 2. AGENDADOR — envia mensagens agendadas
// =====================================================
async function processarAgendamentos(){
  try{
    const agora=new Date().toISOString();
    const pendentes=await sbGet(`agendamentos?enviada=eq.false&enviar_em=lte.${agora}&order=enviar_em.asc`);
    if(!Array.isArray(pendentes)||!pendentes.length)return;
    for(const a of pendentes){
      try{
        await zapiTexto(a.telefone,a.conteudo);
        await sbPatch('agendamentos',`id=eq.${a.id}`,{enviada:true});
        const tel=limparTel(a.telefone);
        let conv=(await sbGet(`conversas?telefone=eq.${tel}`))[0];
        if(!conv){const n=await sbPost('conversas',{telefone:tel,nome:a.nome||tel,ultima_mensagem:a.conteudo,ultima_em:new Date().toISOString()});conv=Array.isArray(n)?n[0]:n;}
        else await sbPatch('conversas',`id=eq.${conv.id}`,{ultima_mensagem:a.conteudo,ultima_em:new Date().toISOString()});
        await sbPost('mensagens',{conversa_id:conv.id,telefone:tel,direcao:'enviada',tipo:'texto',conteudo:a.conteudo});
        console.log(`Agendamento enviado para ${a.nome||tel}`);
        await new Promise(r=>setTimeout(r,3000));
      }catch(err){ console.error('Falha agendamento:',err.message); }
    }
  }catch(e){ console.error('Erro agendador:',e.message); }
}
setInterval(processarAgendamentos, 60*1000);
processarAgendamentos();

app.get('/',(req,res)=>res.send('Inbox WhatsApp — serviço ativo'));
app.listen(PORT,()=>console.log(`Serviço rodando na porta ${PORT}`));
