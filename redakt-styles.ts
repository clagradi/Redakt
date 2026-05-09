export const REDAKT_STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Special+Elite&family=Oswald:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap');

    :root {
      --bg:#020202; --bg2:#070707; --bg3:#0c0c0c; --bg4:#121212; --bg5:#181818;
      --border:#1a1a1a; --border2:#252525; --border3:#333;
      --text:#aaa; --text2:#777; --text3:#555; --text4:#3a3a3a;
      --red:#a30000; --red2:#cc1111; --red-dim:rgba(180,0,0,.12);
      --gold:#b8960c; --gold2:#d4af37;
      --green:#2d7a2d; --green2:#4caf50;
      --blue:#3a5e8e; --blue2:#5b8eff;
    }

    *, *::before, *::after { box-sizing:border-box; -webkit-font-smoothing:antialiased; }
    body { margin:0; }

    .redakt-app {
      display:flex; flex-direction:column; height:100vh;
      background:var(--bg); overflow:hidden; color:var(--text);
      font-family:'Inter','system-ui',sans-serif;
    }

    ::-webkit-scrollbar { width:6px; height:6px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:#1c1c1c; border-radius:3px; }
    ::-webkit-scrollbar-thumb:hover { background:#2a2a2a; }

    /* ── header ─────────────────────────────────────────────────────────────── */
    .header { background:var(--bg2); border-bottom:1px solid var(--border);
      padding:0 18px; height:54px; display:flex; align-items:center; gap:12px;
      flex-shrink:0; position:relative; z-index:100; }
    .header::after { content:''; position:absolute; bottom:0; left:0; right:0; height:1.5px;
      background:linear-gradient(90deg,transparent 0%,var(--red) 30%,var(--gold) 70%,transparent 100%); }
    .brand { display:flex; align-items:center; gap:10px; }
    .seal { width:36px; height:36px; border-radius:50%; border:1.5px solid var(--gold);
      display:flex; align-items:center; justify-content:center;
      font-family:'Oswald',sans-serif; font-weight:700; font-size:11px; color:var(--gold);
      flex-shrink:0; position:relative; box-shadow:0 0 14px rgba(184,150,12,.18); }
    .seal::before { content:''; position:absolute; inset:-3px; border-radius:50%; border:1px solid rgba(184,150,12,.25); }
    .brand-name { font-family:'Oswald',sans-serif; font-weight:700; font-size:18px;
      letter-spacing:6px; color:var(--gold); }
    .brand-tag { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:3px;
      color:var(--text3); display:block; margin-top:1px; }
    .header-right { margin-left:auto; display:flex; align-items:center; gap:10px; }
    .doc-name { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--text2);
      padding:4px 10px; background:var(--bg3); border:1px solid var(--border); }
    .stat-pill { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:1.5px;
      color:var(--red2); background:var(--red-dim);
      border:1px solid rgba(204,17,17,.25); padding:4px 8px; }

    /* ── toolbar ────────────────────────────────────────────────────────────── */
    .toolbar { background:var(--bg2); border-bottom:1px solid var(--border);
      padding:8px 16px; display:flex; gap:4px; flex-wrap:wrap; align-items:center; flex-shrink:0; }
    .btn { font-family:'Oswald',sans-serif; font-size:9.5px; letter-spacing:1.5px;
      text-transform:uppercase; padding:7px 12px; cursor:pointer; border:none; outline:none;
      transition:all .12s; white-space:nowrap; display:inline-flex; align-items:center; gap:5px; }
    .btn:disabled { opacity:.3; cursor:not-allowed; }
    .btn-ghost { background:transparent; color:var(--text2); border:1px solid var(--border2); }
    .btn-ghost:not(:disabled):hover { border-color:#444; color:#bbb; background:var(--bg3); }
    .btn-gold { background:linear-gradient(180deg,var(--gold2),var(--gold)); color:#0a0a0a;
      font-weight:700; box-shadow:inset 0 1px 0 rgba(255,255,255,.2); }
    .btn-gold:not(:disabled):hover { background:var(--gold2); }
    .btn-red { background:linear-gradient(180deg,#b81515,var(--red)); color:#fff;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.15); }
    .btn-red:not(:disabled):hover { background:#b81515; }
    .btn-green { background:rgba(45,122,45,.5); color:var(--green2); border:1px solid var(--green); }
    .btn-green:not(:disabled):hover { background:rgba(45,122,45,.7); }
    .active-blue  { background:rgba(20,40,80,.55)!important; color:var(--blue2)!important; border:1px solid var(--blue)!important; }
    .active-red   { background:rgba(110,0,0,.55)!important; color:#ff8080!important; border:1px solid #770000!important; }
    .active-amber { background:rgba(80,55,0,.55)!important; color:#e0b020!important; border:1px solid #604a00!important; }
    .sep { width:1px; height:22px; background:var(--border2); margin:0 3px; flex-shrink:0; }
    .zoom-group { display:flex; align-items:center; gap:1px; }
    .zoom-value { font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--text2);
      min-width:38px; text-align:center; padding:0 4px; }
    .mode-indicator { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2.5px;
      animation:blink 1.2s step-end infinite; margin-left:auto; padding:5px 10px; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
    .full-width { width:100%; justify-content:center; }
    .mt-6 { margin-top:6px; }

    /* ── search bar ─────────────────────────────────────────────────────────── */
    .search-bar { background:var(--bg3); border-bottom:1px solid var(--border);
      padding:8px 16px; display:flex; align-items:center; gap:8px; flex-shrink:0;
      animation:slideDown .2s ease; }
    @keyframes slideDown { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
    .search-input { flex:1; background:var(--bg4); border:1px solid var(--border2); color:#ccc;
      font-family:'JetBrains Mono',monospace; font-size:12px; padding:7px 12px; outline:none; max-width:380px; }
    .search-input:focus { border-color:var(--gold); }
    .search-input::placeholder { color:#3a3a3a; }
    .search-hint { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:1.5px; color:var(--text3); }

    /* ── loading ────────────────────────────────────────────────────────────── */
    .lbar-indeterminate { height:2px;
      background:linear-gradient(90deg,transparent,var(--gold) 40%,var(--red2) 60%,transparent);
      background-size:300% 100%; animation:lb 1s linear infinite; flex-shrink:0; }
    @keyframes lb { 0%{background-position:100% 0} 100%{background-position:-200% 0} }
    .lbar-track { height:2px; background:var(--bg3); flex-shrink:0; }
    .lbar-fill { height:100%; background:linear-gradient(90deg,var(--red),var(--gold)); transition:width .3s; }
    .lmsg { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:3px; color:var(--gold);
      text-align:center; padding:5px; background:var(--bg2); text-transform:uppercase;
      border-bottom:1px solid var(--border); flex-shrink:0; }

    /* ── body / sidebar / main ──────────────────────────────────────────────── */
    .body { display:flex; flex:1; overflow:hidden; min-height:0; }
    .sidebar { width:158px; flex-shrink:0; background:var(--bg2);
      border-right:1px solid var(--border); overflow-y:auto; }
    .sidebar-header { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:2.5px;
      color:var(--text3); padding:11px 11px 7px; text-transform:uppercase;
      border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg2); z-index:1; }
    .sidebar-page { padding:9px; cursor:pointer; border-bottom:1px solid var(--border);
      transition:background .12s; position:relative; }
    .sidebar-page:hover { background:var(--bg3); }
    .sidebar-page.active { background:var(--bg4); }
    .sidebar-page.active::before { content:''; position:absolute; left:0; top:0; bottom:0;
      width:2px; background:var(--gold); }
    .thumbnail { width:100%; aspect-ratio:.707; background:var(--bg4); overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,.5); }
    .thumbnail img { width:100%; height:100%; object-fit:cover; object-position:top; display:block; }
    .thumb-meta { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
    .thumb-num { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:1.5px; color:var(--text3); }
    .thumb-count { font-family:'Oswald',sans-serif; font-size:8px; padding:1.5px 6px;
      background:var(--red-dim); color:var(--red2); border:1px solid rgba(204,17,17,.25); }

    .main-scroll { flex:1; overflow:auto; background:var(--bg); min-width:0; }
    .pages-wrap { padding:24px 24px 64px; display:flex; flex-direction:column; align-items:center; gap:20px; }
    .page-outer { display:flex; flex-direction:column; align-items:center; }
    .page-wrap { position:relative; box-shadow:0 2px 12px rgba(0,0,0,.6),0 8px 40px rgba(0,0,0,.5);
      transition:width .15s; }
    .page-img { display:block; width:100%; height:auto; user-select:none; -webkit-user-drag:none; }
    .overlay { position:absolute; inset:0; z-index:10; touch-action:none; }
    .overlay.rect  { cursor:crosshair; }
    .overlay.smart { cursor:text; }
    .overlay.erase { cursor:default; }
    .redaction-box { position:absolute; background:#040404; pointer-events:none; }
    .redaction-box.erasable { pointer-events:all; cursor:pointer; transition:background .1s; }
    .redaction-box.erasable:hover { background:rgba(100,0,0,.92); outline:1px solid var(--red2); }
    .redaction-box.erasable:hover::after { content:'✕'; position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      color:var(--red2); font-size:14px; font-family:'Oswald',sans-serif; font-weight:700; }
    .rect-ghost { position:absolute; background:rgba(180,0,0,.3);
      border:1.5px dashed var(--red2); pointer-events:none; z-index:20; }
    .word-highlight { position:absolute; background:rgba(180,0,0,.45); pointer-events:none;
      z-index:15; transition:background .08s; outline:1px solid rgba(255,80,80,.6); }
    .page-label { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:3px;
      color:var(--text3); padding:5px; text-transform:uppercase; }

    /* ── stats panel ────────────────────────────────────────────────────────── */
    .stats-panel { width:240px; flex-shrink:0; background:var(--bg2);
      border-left:1px solid var(--border); overflow-y:auto; }
    .stats-section { padding:14px; border-bottom:1px solid var(--border); }
    .stats-header { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:2.5px;
      color:var(--text3); text-transform:uppercase; margin-bottom:10px; }
    .stat-big { font-family:'Oswald',sans-serif; font-size:32px; font-weight:300;
      color:var(--gold); line-height:1; }
    .stat-big-sub { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:2px;
      color:var(--text3); text-transform:uppercase; margin-top:4px; }
    .stat-row { display:flex; justify-content:space-between; align-items:center;
      margin-bottom:6px; font-family:'JetBrains Mono',monospace; font-size:11px; }
    .stat-row span:first-child { color:var(--text2); }
    .stat-row span:last-child  { color:#ccc; font-weight:500; }
    .page-bar { display:flex; align-items:center; gap:8px; margin-bottom:5px; font-size:10px; }
    .page-bar-label { font-family:'JetBrains Mono',monospace; color:var(--text2);
      width:48px; flex-shrink:0; font-size:10px; }
    .page-bar-track { flex:1; height:6px; background:var(--bg4); position:relative; overflow:hidden; }
    .page-bar-fill { position:absolute; left:0; top:0; bottom:0;
      background:linear-gradient(90deg,var(--red),var(--red2)); }
    .page-bar-num { font-family:'JetBrains Mono',monospace; color:#ccc;
      width:20px; text-align:right; flex-shrink:0; }

    /* ── landing page ───────────────────────────────────────────────────────── */
    .landing { padding:0; background:var(--bg); }
    .hero { position:relative; min-height:calc(100vh - 110px); display:flex;
      flex-direction:column; align-items:center; justify-content:center; padding:40px 24px;
      text-align:center; gap:20px; overflow:hidden; }
    .hero::before { content:''; position:absolute; inset:0;
      background:radial-gradient(ellipse at center, rgba(184,150,12,.04) 0%, transparent 60%);
      pointer-events:none; }
    .hero-stamp { position:absolute; opacity:.04; font-family:'Oswald',sans-serif;
      font-weight:700; font-size:clamp(80px,16vw,200px); letter-spacing:8px; color:var(--red);
      transform:rotate(-15deg); pointer-events:none; user-select:none;
      animation:stampFloat 6s ease-in-out infinite; }
    @keyframes stampFloat { 0%,100%{transform:rotate(-15deg) translateY(0)} 50%{transform:rotate(-13deg) translateY(-10px)} }
    .hero-pretitle { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:5px;
      color:var(--gold); text-transform:uppercase; opacity:0; animation:fadeUp .8s ease forwards; }
    .hero-title { font-family:'Oswald',sans-serif; font-weight:700;
      font-size:clamp(48px,9vw,108px); letter-spacing:clamp(8px,1.5vw,18px); color:#e8e8e8;
      text-transform:uppercase; line-height:.95; margin:0;
      opacity:0; animation:fadeUp .8s ease .15s forwards; }
    .hero-sub { font-family:'Inter',sans-serif; font-weight:300; font-size:clamp(13px,1.6vw,17px);
      color:var(--text2); max-width:600px; line-height:1.6;
      opacity:0; animation:fadeUp .8s ease .3s forwards; margin:0; }
    .hero-divider { width:60px; height:1px; background:var(--gold);
      opacity:0; animation:fadeUp .8s ease .35s forwards; }
    .hero-cta { display:flex; gap:10px; flex-wrap:wrap; justify-content:center;
      margin-top:8px; opacity:0; animation:fadeUp .8s ease .45s forwards; }
    .cta-primary { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2.5px;
      padding:14px 28px; background:linear-gradient(180deg,var(--gold2),var(--gold));
      color:#0a0a0a; font-weight:700; cursor:pointer; border:none; text-transform:uppercase;
      box-shadow:0 4px 20px rgba(184,150,12,.3); transition:transform .15s, box-shadow .15s; }
    .cta-primary:hover { transform:translateY(-2px); box-shadow:0 6px 28px rgba(184,150,12,.4); }
    .cta-secondary { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2.5px;
      padding:14px 28px; background:transparent; color:#aaa; font-weight:600; cursor:pointer;
      border:1px solid var(--border3); text-transform:uppercase; transition:all .15s; }
    .cta-secondary:hover { border-color:var(--gold); color:var(--gold); }
    .hero-meta { display:flex; gap:20px; font-family:'Oswald',sans-serif; font-size:9px;
      letter-spacing:2px; color:var(--text3); text-transform:uppercase; margin-top:10px;
      opacity:0; animation:fadeUp .8s ease .6s forwards; }
    .hero-meta span::before { content:'■ '; color:var(--green2); }
    @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }

    .features { padding:60px 24px; background:var(--bg2);
      border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
    .features-h { text-align:center; font-family:'Oswald',sans-serif; font-size:11px;
      letter-spacing:4px; color:var(--gold); text-transform:uppercase; margin-bottom:8px; }
    .features-t { text-align:center; font-family:'Oswald',sans-serif; font-size:28px;
      letter-spacing:3px; color:#ddd; text-transform:uppercase; margin-bottom:48px; font-weight:400; }
    .features-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
      gap:1px; max-width:1100px; margin:0 auto; background:var(--border); border:1px solid var(--border); }
    .feature { padding:28px 22px; background:var(--bg2); transition:background .2s; }
    .feature:hover { background:var(--bg3); }
    .feature-icon { font-size:26px; margin-bottom:12px; }
    .feature-t { font-family:'Oswald',sans-serif; font-size:13px; letter-spacing:2px;
      color:#ddd; text-transform:uppercase; margin-bottom:8px; font-weight:600; }
    .feature-d { font-family:'Inter',sans-serif; font-size:12.5px; line-height:1.6;
      color:var(--text2); font-weight:300; }

    .how { padding:50px 24px; }
    .how-h { text-align:center; font-family:'Oswald',sans-serif; font-size:11px;
      letter-spacing:4px; color:var(--gold); text-transform:uppercase; margin-bottom:8px; }
    .how-t { text-align:center; font-family:'Oswald',sans-serif; font-size:24px;
      letter-spacing:3px; color:#ddd; text-transform:uppercase; margin-bottom:36px; font-weight:400; }
    .how-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:32px; max-width:900px; margin:0 auto; }
    @media (max-width:720px) { .how-grid { grid-template-columns:1fr; } }
    .step { text-align:center; padding:0 12px; }
    .step-n { font-family:'Oswald',sans-serif; font-size:42px; font-weight:300;
      color:var(--gold); margin-bottom:8px; line-height:1; }
    .step-t { font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:2.5px;
      color:#ccc; text-transform:uppercase; margin-bottom:8px; font-weight:600; }
    .step-d { font-family:'Inter',sans-serif; font-size:13px; color:var(--text2); line-height:1.6; }

    .footer { padding:24px; text-align:center; border-top:1px solid var(--border); background:var(--bg2); }
    .footer-text { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2px;
      color:var(--text4); text-transform:uppercase; }

    /* ── modals ─────────────────────────────────────────────────────────────── */
    .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:9990;
      display:flex; align-items:center; justify-content:center; padding:20px;
      backdrop-filter:blur(4px); animation:fadeIn .15s ease; }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    .modal { background:var(--bg2); border:1px solid var(--border2); padding:0;
      max-width:520px; width:100%; max-height:90vh; overflow:auto;
      box-shadow:0 20px 80px rgba(0,0,0,.8); animation:modalIn .2s ease; }
    @keyframes modalIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    .modal-header { padding:18px 22px; border-bottom:1px solid var(--border);
      display:flex; align-items:center; justify-content:space-between; }
    .modal-title { font-family:'Oswald',sans-serif; font-size:13px; letter-spacing:3px;
      color:var(--gold); text-transform:uppercase; }
    .modal-close { background:none; border:none; color:var(--text3); cursor:pointer;
      font-size:18px; line-height:1; padding:4px; }
    .modal-close:hover { color:#fff; }
    .modal-body { padding:20px 22px; }
    .modal-footer { padding:16px 22px; border-top:1px solid var(--border);
      display:flex; gap:10px; justify-content:flex-end; }

    .field { margin-bottom:16px; }
    .field-label { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2px;
      color:var(--text2); text-transform:uppercase; margin-bottom:6px; display:block; }
    .field-input { width:100%; background:var(--bg4); border:1px solid var(--border2);
      color:#ccc; font-family:'JetBrains Mono',monospace; font-size:12px;
      padding:8px 10px; outline:none; }
    .field-input:focus { border-color:var(--gold); }
    .stamp-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:6px; }
    .stamp-option { padding:8px 10px; background:var(--bg4); border:1px solid var(--border2);
      cursor:pointer; text-align:center; font-family:'Oswald',sans-serif; font-size:9.5px;
      letter-spacing:1.5px; color:var(--text2); transition:all .12s; text-transform:uppercase; }
    .stamp-option:hover { color:#ccc; border-color:#444; }
    .stamp-option.active { background:var(--red-dim); border-color:var(--red2); color:#ff6060; }

    .help-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 20px; }
    .help-row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; }
    .help-label { font-family:'Inter',sans-serif; font-size:12px; color:var(--text); }
    .kbd { font-family:'JetBrains Mono',monospace; font-size:10px; background:var(--bg4);
      border:1px solid var(--border2); padding:2px 6px; color:#aaa; box-shadow:0 1px 0 var(--border); }

    /* ── toast & overlays ───────────────────────────────────────────────────── */
    .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      font-family:'Oswald',sans-serif; font-size:9.5px; letter-spacing:2px;
      text-transform:uppercase; padding:10px 18px; background:var(--bg2);
      border:1px solid var(--border2); color:var(--text); z-index:9999; pointer-events:none;
      animation:tin .2s ease; box-shadow:0 4px 20px rgba(0,0,0,.6); }
    .toast-error   { border-color:var(--red); color:#ff7070; }
    .toast-success { border-color:var(--green); color:var(--green2); }
    @keyframes tin { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

    .drop-overlay { position:fixed; inset:0; z-index:9998; background:rgba(0,0,0,.92);
      border:2px dashed var(--gold); display:flex; align-items:center; justify-content:center;
      flex-direction:column; gap:14px; pointer-events:none; }
    .drop-overlay-text { font-family:'Oswald',sans-serif; font-size:14px; letter-spacing:4px;
      color:var(--gold); text-transform:uppercase; }

    .hint-bar { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2px;
      color:var(--text3); text-align:center; padding:6px; text-transform:uppercase;
      background:var(--bg2); border-top:1px solid var(--border); }

    input[type=file] { display:none; }

    /* ── responsive ─────────────────────────────────────────────────────────── */
    @media (max-width:1024px) { .stats-panel { display:none; } }
    @media (max-width:640px) {
      .sidebar { display:none; }
      .toolbar { padding:8px 10px; }
      .btn { font-size:9px; padding:6px 9px; }
      .hero-meta { flex-direction:column; gap:6px; }
      .doc-name { display:none; }
    }

`;
