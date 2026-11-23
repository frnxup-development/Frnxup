(() => {
  'use strict';
  const $=s=>document.querySelector(s),esc=v=>FX.esc(v);
  async function init(){
    if(!FX.client)return;
    const params=new URLSearchParams(location.search),slug=params.get('slug'),id=params.get('id');
    if(!slug&&!id)return;
    await FX.loadUser();
    let q=FX.client.from('frnxup_pages').select('*').eq('status','active');q=slug?q.eq('slug',slug):q.eq('id',id);
    const {data:page,error}=await q.maybeSingle();if(error||!page)return;
    const own=FX.user?.id===page.owner_user_id;
    if(own){const menu=$('#public-owner-actions');if(menu){menu.hidden=false;menu.href=`/Pages/actions.html?id=${encodeURIComponent(page.id)}`;}}
    const ctaHost=$('#public-page-cta-host');
    if(ctaHost&&page.action_button_enabled&&page.action_button_label&&page.action_button_url){
      try{const u=new URL(page.action_button_url);if(['https:','http:'].includes(u.protocol)){ctaHost.innerHTML=`<a class="pa-public-cta" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(page.action_button_label)} ↗</a>`;}}catch(_){}
    }
    const highlightHost=$('#public-page-highlights');
    if(highlightHost){
      const {data:highlights}=await FX.client.from('frnxup_page_highlights').select('id,title,media_path').eq('page_id',page.id).order('created_at',{ascending:false}).limit(12);
      if(highlights?.length){highlightHost.innerHTML=`<section class="pa-public-highlights"><h2>Highlights</h2><div>${(await Promise.all(highlights.map(async item=>{const url=await FX.mediaUrl(item.media_path);return url?`<figure><img loading="lazy" src="${esc(url)}" alt="${esc(item.title)}"><figcaption>${esc(item.title)}</figcaption></figure>`:'';}))).join('')}</div></section>`;}
    }
    const storiesHost=$('#public-page-stories');
    if(storiesHost){const {data:stories}=await FX.client.from('frnxup_page_stories').select('id,caption,media_path,media_type,created_at').eq('page_id',page.id).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(10);if(stories?.length){storiesHost.innerHTML=`<section class="pa-public-stories"><h2>Page stories</h2><div>${(await Promise.all(stories.map(async s=>{const url=await FX.mediaUrl(s.media_path);return url?`<article>${s.media_type==='video'?`<video controls playsinline src="${esc(url)}"></video>`:`<img loading="lazy" src="${esc(url)}" alt="Page story">`}<p>${esc(s.caption||'')}</p><small>Expires ${esc(FX.time(s.expires_at))}</small></article>`:'';}))).join('')}</div></section>`;}}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(()=>{}),{once:true});else init().catch(()=>{});
})();
