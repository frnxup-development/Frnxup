(() => {
  'use strict';
  const routes = {
    'page-create-post':'create-post',
    'page-switch-personal':'switch-account',
    'page-share-public':'share',
    'page-share-link':'share',
    'page-view-followers':'followers',
    'page-save-settings':'settings',
    'page-edit-details':'edit-details',
    'page-invite-friends':'invite',
    'page-cover-edit':'cover-photo'
  };
  document.addEventListener('click', event => {
    const target=event.target;
    const pageAvatar=target.closest('#page-avatar-wrap');
    const menu=target.closest('#page-more-actions');
    let route=menu?'actions':null;
    if(!route&&pageAvatar)route='profile-photo';
    if(!route){const match=target.closest('[id]');if(match)route=routes[match.id]||null;}
    if(!route)return;
    const id=new URLSearchParams(location.search).get('id')||window.FX?.activePageId?.();
    if(!id){event.preventDefault();window.FX?.toast?.('Open a Page dashboard first.');return;}
    event.preventDefault();event.stopPropagation();if(event.stopImmediatePropagation)event.stopImmediatePropagation();
    location.assign(`/Pages/${route}.html?id=${encodeURIComponent(id)}`);
  },true);
})();
