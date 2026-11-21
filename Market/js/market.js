(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const esc = (v) => FX.esc(String(v ?? ''));
  const CATEGORIES = [
    'Electronics','Mobile Phones','Computers & Accessories','Home Appliances','Furniture & Home Decor',
    'Fashion & Clothing','Shoes & Bags','Beauty & Personal Care','Health & Wellness','Baby & Kids',
    'Toys & Games','Food & Groceries','Agriculture & Farm Produce','Vehicles & Auto Parts',
    'Motorcycles & Bicycles','Property & Real Estate','Building Materials & Tools','Sports & Fitness',
    'Books & Education','Office & Business Equipment','Pets & Livestock','Musical Instruments & Audio','Art, Crafts & Collectibles'
  ];
  const CONDITIONS = ['Brand new','Like new','Open box','Refurbished','Fairly used - excellent','Fairly used - good','Used - fair','Damaged / for parts'];
  const money = n => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(n||0));
  const dateLabel = s => s ? new Date(s).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : '';
  const query = new URLSearchParams(location.search);
  let selectedContact = null;

  function toast(message) {
    const host = $('#market-toast');
    if (!host) return;
    host.textContent = message; host.classList.add('show');
    clearTimeout(toast._timer); toast._timer = setTimeout(() => host.classList.remove('show'), 3400);
  }
  function fillSelect(select, values, firstLabel) {
    if (!select) return;
    select.innerHTML = `<option value="">${esc(firstLabel)}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }
  function checkEnabled() {
    if (FX.settings?.market_enabled === false) {
      const main = $('main');
      if (main) main.insertAdjacentHTML('afterbegin','<div class="market-empty">Frnxup-Market is temporarily unavailable. Please check again later.</div>');
      return false;
    }
    return true;
  }
  async function fetchMedia(listingId) {
    const {data,error} = await FX.client.from('market_listing_media').select('id,storage_path,sort_order').eq('listing_id',listingId).order('sort_order');
    if (error) return [];
    return Promise.all((data||[]).map(async m=>({...m,url:await FX.mediaUrl(m.storage_path)})));
  }
  function cardMarkup(listing, media, own=false) {
    const image = media[0]?.url;
    const featured = listing.featured_until && new Date(listing.featured_until).getTime()>Date.now();
    return `<article class="market-card">
      <a class="market-card-image" href="/Market/item.html?id=${encodeURIComponent(listing.id)}" aria-label="View ${esc(listing.title)}">
        ${image?`<img src="${esc(image)}" alt="${esc(listing.title)}" loading="lazy">`:'<span class="market-no-image">▧</span>'}
        ${featured?'<span class="market-sponsored">Sponsored</span>':''}${media.length>1?`<span class="market-image-count">▧ ${media.length} photos</span>`:''}
      </a>
      <div class="market-card-copy"><a class="market-card-title" href="/Market/item.html?id=${encodeURIComponent(listing.id)}">${esc(listing.title)}</a>
        <div class="market-card-price">${money(listing.price)}</div><div class="market-card-meta"><span>${esc(listing.location_name)}</span><span>·</span><span class="market-condition">${esc(listing.condition)}</span></div>
        <div class="market-card-meta" style="margin-top:6px"><span>${esc(listing.category)}</span><span>·</span><span>${dateLabel(listing.created_at)}</span></div>
        ${own?`<div class="market-card-actions"><a class="market-btn market-btn-secondary" href="/Market/item.html?id=${encodeURIComponent(listing.id)}">View</a>${listing.status==='published'?`<button class="market-btn market-btn-secondary" data-listing-status="hidden" data-listing-id="${listing.id}">Hide</button><button class="market-btn market-btn-secondary" data-listing-status="sold" data-listing-id="${listing.id}">Mark sold</button>`:`<button class="market-btn market-btn-secondary" data-listing-status="published" data-listing-id="${listing.id}">Publish</button>`}</div>`:''}
      </div></article>`;
  }
  async function loadBrowse() {
    const host = $('#market-listing-grid');
    if (!FX.client) { if(host)host.innerHTML='<div class="market-empty">Connect your Supabase project in js/config.js to load Marketplace listings.</div>'; return; }
    const mine = query.get('mine')==='1';
    const saved = query.get('saved')==='1';
    const inbox = query.get('inbox')==='1';
    if (inbox) {
      $('#market-main-results').hidden = true; $('#market-inbox-panel').hidden = false;
      $('#market-section-title').textContent = 'Marketplace inbox';
      await loadInbox(); return;
    }
    $('#market-main-results').hidden = false; $('#market-inbox-panel').hidden = true;
    const {data:user} = await FX.client.auth.getUser();
    if (mine && !user?.user) { FX.showAuthNotice('Sign in to manage your Marketplace listings.'); host.innerHTML='<div class="market-empty">Sign in to view your listings.</div>'; return; }
    if (mine) $('#market-section-title').textContent = 'My listings';
    else if (saved) $('#market-section-title').textContent = 'Saved items';
    const q = $('#market-q')?.value.trim() || '';
    const category = $('#market-category')?.value || '';
    const locationText = $('#market-location')?.value.trim() || '';
    const condition = $('#market-condition')?.value || '';
    let request = FX.client.from('market_listings').select('id,seller_id,title,description,category,price,condition,location_name,status,featured_until,created_at,view_count').order('featured_until',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}).limit(100);
    if (mine) request=request.eq('seller_id',user.user.id);
    else if(saved){if(!user?.user){FX.showAuthNotice('Sign in to view your saved Marketplace items.');host.innerHTML='<div class="market-empty">Sign in to view your saved items.</div>';return}const {data:savedRows,error:savedError}=await FX.client.from('market_saved_listings').select('listing_id').eq('user_id',user.user.id);if(savedError){host.innerHTML=`<div class="market-empty">${esc(savedError.message)}</div>`;return}const ids=(savedRows||[]).map(x=>x.listing_id);if(!ids.length){host.innerHTML='<div class="market-empty">You have not saved any Marketplace items.</div>';$('#market-result-count').textContent='0 items';return}request=request.in('id',ids).eq('status','published')}
    else request=request.eq('status','published');
    if (category) request=request.eq('category',category);
    if (condition) request=request.eq('condition',condition);
    if (locationText) request=request.ilike('location_name',`%${locationText.replace(/[%_,()]/g,' ')}%`);
    if (q) { const safe=q.replace(/[(),.%]/g,' ').slice(0,80); request=request.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`); }
    const sort=$('#market-sort')?.value||'recent';
    if (sort==='price_asc') request=request.order('price',{ascending:true});
    if (sort==='price_desc') request=request.order('price',{ascending:false});
    const {data,error}=await request;
    if(error){host.innerHTML=`<div class="market-empty">${esc(error.message)}. Run the Frnxup-Market SQL migration in Supabase.</div>`;$('#market-result-count').textContent='Marketplace data is not available';return}
    const rows=data||[]; $('#market-result-count').textContent=`${rows.length} item${rows.length===1?'':'s'} found`;
    if(!rows.length){host.innerHTML=`<div class="market-empty">${mine?'You have not listed anything yet.':'No matching items yet. Try another category or location.'}${mine?'<br><br><a class="market-btn market-btn-primary" href="/Market/sell.html">＋ Sell your first item</a>':''}</div>`;return}
    host.innerHTML=(await Promise.all(rows.map(async row=>cardMarkup(row,await fetchMedia(row.id),mine)))).join('');
    if(FX.user) FX.trackActivity('market_browse','market','/Market/index.html',{mine,category,condition,location:locationText});
  }
  async function loadInbox() {
    const host=$('#market-inbox-list');
    if (!FX.client) { host.innerHTML='<div class="market-empty">Connect Supabase to view your Marketplace inbox.</div>'; return; }
    const user=await FX.loadUser();
    if(!user){FX.showAuthNotice('Sign in to view your Marketplace inbox.');host.innerHTML='<div class="market-empty">Sign in to view messages and purchase requests.</div>';return}
    const [received,sent]=await Promise.all([
      FX.client.from('market_inquiries').select('*').eq('seller_id',user.id).order('created_at',{ascending:false}).limit(100),
      FX.client.from('market_inquiries').select('*').eq('buyer_id',user.id).order('created_at',{ascending:false}).limit(100)
    ]);
    if(received.error||sent.error){host.innerHTML=`<div class="market-empty">${esc(received.error?.message||sent.error?.message)}</div>`;return}
    const rows=[...(received.data||[]).map(x=>({...x,box:'received'})),...(sent.data||[]).map(x=>({...x,box:'sent'}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if(!rows.length){host.innerHTML='<div class="market-empty">No Marketplace messages or purchase requests yet.</div>';return}
    const listings=new Map(); const profiles=new Map();
    const listingIds=[...new Set(rows.map(x=>x.listing_id))], userIds=[...new Set(rows.map(x=>x.box==='received'?x.buyer_id:x.seller_id))];
    if(listingIds.length){const {data}=await FX.client.from('market_listings').select('id,title,price').in('id',listingIds);(data||[]).forEach(x=>listings.set(x.id,x));}
    if(userIds.length){const {data}=await FX.client.from('profiles').select('id,username,display_name').in('id',userIds);(data||[]).forEach(x=>profiles.set(x.id,x));}
    host.innerHTML=rows.map(row=>{const person=profiles.get(row.box==='received'?row.buyer_id:row.seller_id);const listing=listings.get(row.listing_id);const canRespond=row.box==='received'&&row.status==='pending';return `<article class="market-inquiry"><div class="market-inquiry-head"><b>${row.box==='received'?'From':'To'} ${esc(person?.display_name||person?.username||'Frnxup member')}</b><span class="market-condition">${row.request_type==='purchase'?'Purchase request':'Message'} · ${esc(row.status)}</span></div><p><b>${esc(listing?.title||'Item listing')}</b> · ${money(listing?.price)}</p><p>${esc(row.message)}</p><small>${dateLabel(row.created_at)}</small>${canRespond?`<div class="market-card-actions"><button class="market-btn market-btn-primary" data-inquiry-status="accepted" data-inquiry-id="${row.id}">Accept</button><button class="market-btn market-btn-secondary" data-inquiry-status="declined" data-inquiry-id="${row.id}">Decline</button></div>`:''}</article>`}).join('');
  }
  async function updateListingStatus(id,status) {
    const {error}=await FX.client.from('market_listings').update({status}).eq('id',id);
    if(error)throw error; await FX.trackActivity('market_listing_status_changed','market_listing',id,{status});toast(`Listing ${status==='sold'?'marked as sold':status==='hidden'?'hidden':'published'}.`);await loadBrowse();
  }
  function bindBrowse() {
    fillSelect($('#market-category'),CATEGORIES,'All categories');fillSelect($('#market-condition'),CONDITIONS,'Any condition');
    $('#market-filter-form').addEventListener('submit',e=>{e.preventDefault();loadBrowse()});
    $('#market-sort').addEventListener('change',loadBrowse);
    document.addEventListener('click',async e=>{
      const status=e.target.closest('[data-listing-status]');if(status){status.disabled=true;try{await updateListingStatus(status.dataset.listingId,status.dataset.listingStatus)}catch(err){toast(err.message);status.disabled=false}return}
      const response=e.target.closest('[data-inquiry-status]');if(response){response.disabled=true;const {error}=await FX.client.from('market_inquiries').update({status:response.dataset.inquiryStatus}).eq('id',response.dataset.inquiryId);if(error)toast(error.message);else{toast('Request updated.');loadInbox()}return}
    });
    loadBrowse();
  }

  function renderPhotoPreview(files) {
    const host=$('#listing-photo-preview'); if(!host)return;
    (host._urls||[]).forEach(URL.revokeObjectURL);host._urls=[];
    if(!files.length){host.innerHTML='<span>Your photo previews will appear here before publishing.</span>';return}
    host.innerHTML=files.map((file,i)=>{const url=URL.createObjectURL(file);host._urls.push(url);return `<div class="market-preview-tile"><img src="${url}" alt="Selected item photo ${i+1}"><button type="button" data-remove-photo="${i}" aria-label="Remove photo">×</button></div>`}).join('');
  }
  async function reverseGeocode(lat,lon) {
    try { const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);if(!r.ok)return '';const d=await r.json();const a=d.address||{};return [a.suburb||a.neighbourhood||a.village||a.town||a.city,a.state,a.country].filter(Boolean).join(', ')||d.display_name||''; } catch(_){return ''}
  }
  function initMap() {
    const host=$('#market-location-map'); if(!host||!window.L)return;
    const map=L.map(host,{scrollWheelZoom:false}).setView([9.082,8.675],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    let marker=null;
    async function pin(lat,lon,label='') {
      $('#listing-latitude').value=String(lat);$('#listing-longitude').value=String(lon);
      if(marker)marker.setLatLng([lat,lon]);else marker=L.marker([lat,lon],{draggable:true}).addTo(map);
      marker.off('dragend');marker.on('dragend',async e=>{const p=e.target.getLatLng();await pin(p.lat,p.lng)});
      const place=label||await reverseGeocode(lat,lon);if(place)$('#listing-location').value=place;else if(!$('#listing-location').value)$('#listing-location').value=`${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
    }
    map.on('click',e=>pin(e.latlng.lat,e.latlng.lng));
    $('#market-map-current').addEventListener('click',()=>{if(!navigator.geolocation){toast('Location services are not available in this browser.');return}navigator.geolocation.getCurrentPosition(async p=>{const {latitude,longitude}=p.coords;map.setView([latitude,longitude],14);await pin(latitude,longitude)},()=>toast('Could not read your location. You can tap the map to choose manually.'),{enableHighAccuracy:true,timeout:10000})});
    $('#market-map-find').addEventListener('click',async()=>{const term=$('#market-map-search').value.trim();if(!term){toast('Enter a place to search for.');return}const btn=$('#market-map-find');btn.disabled=true;try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(term)}`);const arr=await r.json();if(!arr.length)throw new Error('Place not found. Try a nearby town or landmark.');const p=arr[0],lat=Number(p.lat),lon=Number(p.lon);map.setView([lat,lon],14);await pin(lat,lon,p.display_name.split(',').slice(0,3).join(', '))}catch(err){toast(err.message)}finally{btn.disabled=false}});
    setTimeout(()=>map.invalidateSize(),220);
  }
  async function initSell() {
    const user=await FX.loadUser();if(!user){FX.showAuthNotice('Sign in to list an item for sale.');$('#market-publish').disabled=true;return}
    fillSelect($('#listing-category'),CATEGORIES,'Choose a category');fillSelect($('#listing-condition'),CONDITIONS,'Choose condition');
    initMap();
    $('#listing-photos').addEventListener('change',()=>{const files=[...$('#listing-photos').files];if(files.length>10||files.some(f=>!f.type.startsWith('image/')||f.size>15*1024*1024)){toast('Choose up to 10 images, each no larger than 15 MB.');$('#listing-photos').value='';renderPhotoPreview([]);return}renderPhotoPreview(files)});
    $('#listing-photo-preview').addEventListener('click',e=>{const btn=e.target.closest('[data-remove-photo]');if(!btn)return;const dt=new DataTransfer();[...$('#listing-photos').files].forEach((f,i)=>{if(i!==Number(btn.dataset.removePhoto))dt.items.add(f)});$('#listing-photos').files=dt.files;renderPhotoPreview([...dt.files])});
    $('#market-sell-form').addEventListener('submit',async e=>{e.preventDefault();const files=[...$('#listing-photos').files];const message=$('#market-sell-message');const button=$('#market-publish');
      if(files.length<2){message.textContent='Please upload at least 2 item photographs.';return}
      if(!$('#listing-latitude').value||!$('#listing-longitude').value||!$('#listing-location').value.trim()){message.textContent='Choose the item location on the map before publishing.';return}
      if(!FX.enabled('market_enabled')){message.textContent='Frnxup-Market is temporarily disabled by administrators.';return}
      button.disabled=true;message.textContent='Uploading photographs and publishing your listing…';let uploaded=[],listingId=null;
      try{
        const {data:listing,error}=await FX.client.from('market_listings').insert({seller_id:user.id,title:$('#listing-title').value.trim(),description:$('#listing-description').value.trim(),category:$('#listing-category').value,price:Number($('#listing-price').value),condition:$('#listing-condition').value,location_name:$('#listing-location').value.trim(),latitude:Number($('#listing-latitude').value),longitude:Number($('#listing-longitude').value),status:'draft'}).select('id').single();
        if(error)throw error;listingId=listing.id;
        for(let i=0;i<files.length;i++){const path=await FX.upload(files[i],'market');uploaded.push(path);}
        const records=uploaded.map((path,i)=>({listing_id:listingId,seller_id:user.id,storage_path:path,sort_order:i+1}));
        const {error:mediaError}=await FX.client.from('market_listing_media').insert(records);if(mediaError)throw mediaError;
        const {error:publishError}=await FX.client.from('market_listings').update({status:'published'}).eq('id',listingId);if(publishError)throw publishError;
        toast('Your item is now listed on Frnxup-Market.');location.href=`/Market/item.html?id=${encodeURIComponent(listingId)}`;
      }catch(err){if(listingId)await FX.client.from('market_listings').delete().eq('id',listingId);if(uploaded.length)await FX.client.storage.from('frnxup-media').remove(uploaded);message.textContent=err.message;button.disabled=false}
    });
  }
  async function contactSeller(type) {
    const user=await FX.loadUser();if(!user){FX.showAuthNotice('Sign in to contact the seller.');return}
    if(!selectedContact)return;if(user.id===selectedContact.seller_id){toast('This is your own listing.');return}
    $('#market-contact-title').textContent=type==='purchase'?'Request to buy':'Message seller';$('#market-contact-caption').textContent=type==='purchase'?'Send a purchase request to the seller.':'Ask the seller a question about this item.';
    $('#market-contact-message').value=type==='purchase'?'Hello, I would like to buy this item. Is it still available?':'';
    $('#market-contact-modal').dataset.type=type;$('#market-contact-modal').classList.add('open');$('#market-contact-modal').setAttribute('aria-hidden','false');$('#market-contact-message').focus();
  }
  async function loadItem() {
    const id=query.get('id');const host=$('#market-item-detail');if(!FX.client){host.innerHTML='<div class="market-empty">Connect Supabase to load this item.</div>';return}if(!id){host.innerHTML='<div class="market-empty">No item was selected.</div>';return}
    const {data:item,error}=await FX.client.from('market_listings').select('*').eq('id',id).maybeSingle();
    if(error||!item){host.innerHTML=`<div class="market-empty">${esc(error?.message||'This item is unavailable or has been removed.')}</div>`;return}
    if(item.status!=='published'&&item.seller_id!==FX.user?.id){host.innerHTML='<div class="market-empty">This item is no longer available.</div>';return}
    const user=await FX.loadUser();const media=await fetchMedia(id);const {data:seller}=await FX.client.from('profiles').select('id,username,display_name,avatar_path').eq('id',item.seller_id).maybeSingle();
    selectedContact={...item,seller_id:item.seller_id};
    if(!user||user.id!==item.seller_id)FX.client.rpc('frnxup_market_increment_view',{p_listing_id:id});
    const avatar=seller?.avatar_path?await FX.mediaUrl(seller.avatar_path):'';
    const first=media[0]?.url||'';
    host.innerHTML=`<section class="market-item-gallery"><div class="market-item-hero" id="market-item-hero">${first?`<img src="${esc(first)}" alt="${esc(item.title)}">`:'<span class="market-no-image">▧</span>'}</div><div class="market-thumbs">${media.map((m,i)=>`<button type="button" data-item-photo="${i}" class="${i===0?'active':''}" aria-label="Show photo ${i+1}"><img src="${esc(m.url)}" alt=""></button>`).join('')}</div></section>
    <aside class="market-item-card"><span class="market-eyebrow">${esc(item.category)}</span><h1>${esc(item.title)}</h1><div class="market-item-price">${money(item.price)}</div><div class="market-item-location">⌖ ${esc(item.location_name)} · Listed ${dateLabel(item.created_at)}</div><span class="market-condition">${esc(item.condition)}</span><p class="market-item-description">${esc(item.description)}</p><div class="market-seller-box"><div class="market-seller-avatar">${avatar?`<img src="${esc(avatar)}" alt="">`:esc((seller?.display_name||seller?.username||'S').slice(0,1).toUpperCase())}</div><div><small>Seller</small><br><a href="/Dashboard/profile.html?id=${encodeURIComponent(item.seller_id)}">${esc(seller?.display_name||seller?.username||'Frnxup member')}</a></div></div>
    <div class="market-item-actions"><button class="market-btn market-btn-primary" id="market-request-buy">Request to buy</button><button class="market-btn market-btn-secondary" id="market-message-seller">Send seller a message</button><button class="market-btn market-btn-secondary" id="market-save-item">♡ Save item</button><button class="market-btn market-btn-secondary" id="market-report-item">⚑ Report listing</button></div>
    <div class="market-boost-panel"><h3>🚀 Boost this item</h3><p>Boosted items receive sponsored placement in Marketplace. 1 week ₦200 · 2 weeks ₦400 · 3 weeks ₦600 · 4 weeks / month ₦800. Requests are reviewed by Frnxup admins.</p><select id="market-boost-weeks"><option value="1">1 week — ₦200</option><option value="2">2 weeks — ₦400</option><option value="3">3 weeks — ₦600</option><option value="4">4 weeks / month — ₦800</option></select><input id="market-boost-reference" maxlength="160" placeholder="Payment reference (optional)"><button class="market-btn market-btn-primary" id="market-request-boost">Request boost</button></div>
    <small style="display:block;color:var(--muted);margin-top:12px;line-height:1.5">Arrange inspection, collection and payment directly with the seller. Never pay before you are satisfied that the item and seller are genuine.</small></aside>`;
    if(user?.id===item.seller_id){$('#market-request-buy').hidden=true;$('#market-message-seller').hidden=true;$('#market-save-item').hidden=true;}
    $('#market-item-hero').dataset.main=first;
    host.addEventListener('click',e=>{const thumb=e.target.closest('[data-item-photo]');if(thumb){const n=Number(thumb.dataset.itemPhoto);$('#market-item-hero').innerHTML=`<img src="${esc(media[n]?.url||'')}" alt="${esc(item.title)}">`;host.querySelectorAll('[data-item-photo]').forEach(x=>x.classList.toggle('active',x===thumb));}});
    $('#market-request-buy').onclick=()=>contactSeller('purchase');$('#market-message-seller').onclick=()=>contactSeller('message');
    $('#market-save-item').onclick=async()=>{const u=await FX.loadUser();if(!u){FX.showAuthNotice('Sign in to save this item.');return}const {error}=await FX.client.from('market_saved_listings').upsert({user_id:u.id,listing_id:id},{onConflict:'user_id,listing_id'});if(error)toast(error.message);else{toast('Item saved.');FX.trackActivity('market_item_saved','market_listing',id)}};
    $('#market-report-item').onclick=async()=>{const u=await FX.loadUser();if(!u){FX.showAuthNotice('Sign in to report a listing.');return}const reason=prompt('Tell Frnxup why this listing should be reviewed:');if(!reason||reason.trim().length<5)return;const {error}=await FX.client.from('market_reports').insert({listing_id:id,reporter_id:u.id,reason:reason.trim()});if(error)toast(error.message);else toast('Report sent to the Frnxup moderation team.')};
    $('#market-request-boost').onclick=async()=>{const u=await FX.loadUser();if(!u){FX.showAuthNotice('Sign in to request a listing boost.');return}if(FX.settings?.market_boosts_enabled===false){toast('Marketplace boosts are temporarily disabled.');return}const weeks=Number($('#market-boost-weeks').value);const amount=weeks*200;if(!confirm(`Submit a ${weeks}-week boost request for ₦${amount.toLocaleString()}? The boost begins after admin payment review.`))return;const {error}=await FX.client.from('market_boosts').insert({listing_id:id,payer_id:u.id,duration_weeks:weeks,amount_ngn:amount,payment_reference:$('#market-boost-reference').value.trim(),status:'pending_review'});if(error)toast(error.message);else toast('Boost request submitted for admin review.')};
    $('#market-contact-form').onsubmit=async e=>{e.preventDefault();const u=await FX.loadUser();if(!u){FX.showAuthNotice('Sign in to contact the seller.');return}const type=$('#market-contact-modal').dataset.type;const message=$('#market-contact-message').value.trim();if(message.length<2)return;const btn=$('#market-contact-submit');btn.disabled=true;try{const {error}=await FX.client.from('market_inquiries').insert({listing_id:id,buyer_id:u.id,seller_id:item.seller_id,request_type:type,message,status:'pending'});if(error)throw error;$('#market-contact-modal').classList.remove('open');toast(type==='purchase'?'Purchase request sent to seller.':'Message sent to seller.')}catch(err){$('#market-contact-feedback').textContent=err.message}finally{btn.disabled=false}};
    document.querySelector('[data-close-contact]').onclick=()=>{$('#market-contact-modal').classList.remove('open');$('#market-contact-modal').setAttribute('aria-hidden','true')};
    await FX.trackActivity('market_item_view','market_listing',id,{title:item.title});
  }

  document.addEventListener('DOMContentLoaded',async()=>{
    try {
      await FX.loadUser(); await FX.loadSettings();
      const page=document.body.dataset.marketPage;
      if(page==='browse'){if(checkEnabled())bindBrowse()}
      else if(page==='sell'){if(checkEnabled())initSell()}
      else if(page==='item'){if(checkEnabled())loadItem()}
    } catch(error) { const host=$('#market-listing-grid')||$('#market-item-detail')||$('#market-sell-message');if(host)host.textContent=error.message; }
  });
})();
