(() => {
  const page = document.currentScript;
  const code = (page?.dataset.examCode || '').toUpperCase();
  const name = page?.dataset.examName || code;
  const officialSite = page?.dataset.officialSite || '';
  const authority = page?.dataset.authority || 'Examination provider';
  const $ = id => document.getElementById(id);
  const img = $('exam-official-logo');
  const fallback = $('exam-logo-fallback');
  const label = $('exam-authority');
  if (label) label.textContent = authority;
  const toStart = `/Edu-Afrika/index.html?exam=${encodeURIComponent(code)}`;
  $('exam-prepare-link')?.setAttribute('href', toStart);
  $('exam-back-link')?.setAttribute('href', '/Edu-Afrika/index.html');
  const site = $('exam-official-site');
  if (officialSite) { site.href = officialSite; site.hidden = false; }
  else { site.hidden = true; }
  async function loadLogo() {
    const cfg = window.FRNXUP_CONFIG || {};
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
    try {
      const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {data,error} = await client.from('edu_exam_types').select('name,logo_url,is_active').eq('code',code).eq('is_active',true).maybeSingle();
      if (error) throw error;
      if (!data) return;
      if (data.name) document.title = `${data.name} preparation · EDU-AFRIKA`;
      if (data.logo_url) {
        img.src = data.logo_url;
        img.alt = `${data.name || name} official logo`;
        img.hidden = false;
        fallback.hidden = true;
        img.onerror = () => { img.hidden = true; fallback.hidden = false; };
      }
    } catch (_) { /* Landing page remains usable even if the logo catalogue is unavailable. */ }
  }
  loadLogo();
})();
