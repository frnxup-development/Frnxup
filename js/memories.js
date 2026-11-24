document.addEventListener('DOMContentLoaded', async () => {
  const host = document.querySelector('#fx-memories-list');
  if (!host) return;
  try { await FX.loadUser(); } catch (error) { FXStates.fail(host,error,{retry:()=>location.reload()}); return; }
  if (!FX.client) { FXStates.render(host,'configuration'); return; }
  if (!FX.user) { FXStates.render(host,'auth',{title:'Sign in to view your memories',message:'Your monthly and yearly memories are private to your account.',href:'/Auth/index.html?next=%2FDashboard%2Fmemories.html'}); return; }
  FXStates.loading(host,{title:'Finding your memories',message:'Looking through your own posts for monthly and yearly moments.'});
  const {data,error} = await FX.client.rpc('frnxup_my_memories',{p_limit:60});
  if (error) { FXStates.fail(host,error,{retry:()=>location.reload(),title:'Memories could not be loaded'}); return; }
  if (!data?.length) { FXStates.empty(host,{title:'No memories for today yet',message:'When one of your own posts reaches a monthly or yearly anniversary, it will appear here.'}); return; }
  const ids=data.map(row=>row.id);
  const {data:mediaRows,error:mediaError}=await FX.client.from('post_media').select('post_id,media_path,media_type,sort_order').in('post_id',ids).order('sort_order',{ascending:true});
  if(mediaError){FXStates.fail(host,mediaError,{retry:()=>location.reload(),title:'Memory photos could not be loaded'});return;}
  const byPost=new Map();(mediaRows||[]).forEach(row=>{if(!byPost.has(row.post_id))byPost.set(row.post_id,[]);byPost.get(row.post_id).push(row)});
  data.forEach(row=>{if(!byPost.has(row.id)&&row.media_path)byPost.set(row.id,[{post_id:row.id,media_path:row.media_path,media_type:row.media_type||'image',sort_order:1}])});
  const all=[...byPost.values()].flat(),urls=await Promise.all(all.map(row=>FX.mediaUrl(row.media_path))),urlMap=new Map(all.map((row,index)=>[row.media_path,urls[index]]));
  host.innerHTML=data.map(row=>{
    const assets=(byPost.get(row.id)||[]).map(media=>({url:urlMap.get(media.media_path),type:media.media_type,name:`frnxup-memory-${row.id}-${media.sort_order}.${(media.media_path?.split('.').pop()||(media.media_type==='video'?'mp4':'jpg')).toLowerCase()}`})).filter(x=>x.url);
    const collage=window.FXMediaTools?.collage(assets,`memory-${row.id}`,'Memory post media')||'';
    const kind=row.memory_kind==='yearly'?'A year ago today':'A month ago today';
    return `<article class="fx-memory-card"><div class="fx-memory-card-top"><span class="fx-memory-flower">${row.memory_kind==='yearly'?'🌷':'🌼'}</span><span class="fx-memory-kind">${kind}</span><time>${FX.esc(FX.time(row.created_at))}</time></div>${row.body?`<p>${FX.esc(row.body)}</p>`:''}${collage}<a class="button subtle" href="/Posts/view.html?id=${encodeURIComponent(row.id)}">View original post ↗</a></article>`;
  }).join('');
  FXStates.loaded(host);
});
