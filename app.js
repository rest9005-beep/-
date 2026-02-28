'use strict';

// =========================================================
// UTILS
// =========================================================
const Utils = (() => {
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }
  function fmtViews(n) {
    if(n>=1e9) return (n/1e9).toFixed(1)+'млрд';
    if(n>=1e6) return (n/1e6).toFixed(1)+'млн';
    if(n>=1e3) return (n/1e3).toFixed(1)+'тыс';
    return String(n);
  }
  function fmtTime(secs) {
    if(!isFinite(secs)||secs<0) return '0:00';
    const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=Math.floor(secs%60);
    if(h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }
  function timeAgo(ts) {
    const diff=(Date.now()-ts)/1000;
    if(diff<60) return 'только что';
    if(diff<3600) return Math.floor(diff/60)+' мин. назад';
    if(diff<86400) return Math.floor(diff/3600)+' ч. назад';
    if(diff<2592000) return Math.floor(diff/86400)+' дн. назад';
    if(diff<31536000) return Math.floor(diff/2592000)+' мес. назад';
    return Math.floor(diff/31536000)+' лет назад';
  }
  function sanitize(str) {
    const d=document.createElement('div');
    d.textContent=str;
    return d.innerHTML;
  }
  function initials(name) {
    if(!name) return '?';
    return name.slice(0,2).toUpperCase();
  }
  function randomColor(name) {
    const colors=['#c9000a','#7c3aed','#0891b2','#059669','#d97706','#db2777','#2563eb'];
    let h=0;for(const c of (name||'A')){h=((h<<5)-h+c.charCodeAt(0))|0;}
    return colors[Math.abs(h)%colors.length];
  }
  return {uid,fmtViews,fmtTime,timeAgo,sanitize,initials,randomColor};
})();

// =========================================================
// CONTENT FILTER
// =========================================================
const Filter = (() => {
  const BANNED=['хуй','пизда','ёбаный','блядь','еблан','залупа','пидор','мудак','ублюдок','сука','fuck','shit','bitch','nigger','nazi'];
  function clean(text) {
    let out = text;
    for(const w of BANNED) {
      const re = new RegExp(w.replace(/./g,'$&'),'gi');
      out = out.replace(re, m => m[0]+'*'.repeat(m.length-2)+m[m.length-1]);
    }
    return out;
  }
  function containsBanned(text) {
    return BANNED.some(w=>new RegExp(w,'i').test(text));
  }
  return {clean,containsBanned};
})();

// =========================================================
// IDB STORAGE
// =========================================================
const IDB = (() => {
  let db = null;
  function open() {
    return new Promise((res,rej)=>{
      const req = indexedDB.open('sonyatub_db',2);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if(!d.objectStoreNames.contains('videos')) {
          const vs = d.createObjectStore('videos',{keyPath:'id'});
          vs.createIndex('author','author',{unique:false});
          vs.createIndex('createdAt','createdAt',{unique:false});
        }
        if(!d.objectStoreNames.contains('thumbnails')) {
          d.createObjectStore('thumbnails',{keyPath:'id'});
        }
      };
      req.onsuccess = e => { db=e.target.result; res(db); };
      req.onerror = e => rej(e);
    });
  }
  function tx(store,mode='readonly') {
    return db.transaction(store,mode).objectStore(store);
  }
  function all(store) {
    return new Promise((res,rej)=>{
      const req = tx(store).getAll();
      req.onsuccess=()=>res(req.result);
      req.onerror=rej;
    });
  }
  function get(store,key) {
    return new Promise((res,rej)=>{
      const req=tx(store).get(key);
      req.onsuccess=()=>res(req.result);
      req.onerror=rej;
    });
  }
  function put(store,val) {
    return new Promise((res,rej)=>{
      const req=tx(store,'readwrite').put(val);
      req.onsuccess=()=>res(req.result);
      req.onerror=rej;
    });
  }
  function del(store,key) {
    return new Promise((res,rej)=>{
      const req=tx(store,'readwrite').delete(key);
      req.onsuccess=()=>res();
      req.onerror=rej;
    });
  }
  function byIndex(store,idx,val) {
    return new Promise((res,rej)=>{
      const req=tx(store).index(idx).getAll(val);
      req.onsuccess=()=>res(req.result);
      req.onerror=rej;
    });
  }
  return {open,all,get,put,del,byIndex};
})();

// =========================================================
// LOCAL STORAGE HELPERS
// =========================================================
const LS = (() => {
  function get(key,def=null){try{const v=localStorage.getItem(key);return v===null?def:JSON.parse(v);}catch{return def;}}
  function set(key,val){try{localStorage.setItem(key,JSON.stringify(val));}catch(e){console.warn('LS set error',e);}}
  function del(key){localStorage.removeItem(key);}
  return {get,set,del};
})();

// =========================================================
// AUTH
// =========================================================
const Auth = (() => {
  let _cb = null;

  async function hashPwd(pwd,salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt+pwd);
    const hash = await crypto.subtle.digest('SHA-256',data);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  function currentUser() {
    const s = LS.get('st_session');
    return s ? s.username : null;
  }

  function getUserData(username) {
    const users = LS.get('st_users',{});
    return users[username]||null;
  }

  function getUsers() { return LS.get('st_users',{}); }

  async function register(username,pwd,pwd2) {
    username = username.trim();
    if(!username||username.length<3) return {error:'Имя пользователя минимум 3 символа'};
    if(username.length>30) return {error:'Имя слишком длинное'};
    if(!/^[a-zA-Zа-яА-ЯёЁ0-9_]+$/.test(username)) return {error:'Только буквы, цифры и _'};
    if(!pwd||pwd.length<6) return {error:'Пароль минимум 6 символов'};
    if(pwd!==pwd2) return {error:'Пароли не совпадают'};
    const users = getUsers();
    if(users[username]) return {error:'Это имя уже занято'};
    const salt = Utils.uid()+Utils.uid();
    const hash = await hashPwd(pwd,salt);
    users[username] = {
      username, hash, salt,
      displayName: username,
      bio: '',
      avatar: null,
      avatarColor: Utils.randomColor(username),
      createdAt: Date.now(),
      subs: []
    };
    LS.set('st_users',users);
    _createSession(username);
    return {ok:true};
  }

  async function login(username,pwd) {
    username = username.trim();
    const users = getUsers();
    const u = users[username];
    if(!u) return {error:'Пользователь не найден'};
    const hash = await hashPwd(pwd,u.salt);
    if(hash!==u.hash) return {error:'Неверный пароль'};
    _createSession(username);
    return {ok:true};
  }

  function _createSession(username) {
    const token = Utils.uid()+Utils.uid();
    LS.set('st_session',{username,token,ts:Date.now()});
    _onLogin();
  }

  function logout() {
    LS.del('st_session');
    _onLogout();
    Router.go('/');
    UI.toast('Вы вышли из аккаунта','info');
  }

  function _onLogin() {
    closeModal();
    UI.updateAuthUI();
    UI.toast(`Добро пожаловать!`,'success');
    if(_cb){const c=_cb;_cb=null;c();}
  }

  function _onLogout() {
    UI.updateAuthUI();
  }

  function requireLogin(fn) {
    if(currentUser()) { fn(); }
    else { _cb=fn; openModal(); }
  }

  function openModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    switchTab('login', document.querySelector('#auth-modal .form-tab'));
  }

  function closeModal() {
    document.getElementById('auth-modal').classList.add('hidden');
  }

  function switchTab(tab, el) {
    document.querySelectorAll('#auth-modal .form-tab').forEach(t=>t.classList.remove('active'));
    if(el) el.classList.add('active');
    renderForm(tab);
  }

  function renderForm(tab) {
    const c = document.getElementById('auth-form-content');
    if(tab==='login') {
      c.innerHTML=`
        <div class="form-group">
          <label class="form-label" for="auth-username">Имя пользователя</label>
          <input class="form-input" id="auth-username" type="text" placeholder="username" autocomplete="username" aria-required="true">
          <div class="form-error" id="auth-err"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="auth-pwd">Пароль</label>
          <input class="form-input" id="auth-pwd" type="password" placeholder="••••••••" autocomplete="current-password" aria-required="true">
        </div>
        <button class="btn-primary" style="width:100%;justify-content:center;padding:12px" onclick="Auth.doLogin()">Войти</button>`;
      setTimeout(()=>document.getElementById('auth-username')?.focus(),50);
    } else {
      c.innerHTML=`
        <div class="form-group">
          <label class="form-label" for="reg-username">Имя пользователя</label>
          <input class="form-input" id="reg-username" type="text" placeholder="min. 3 символа" autocomplete="username" aria-required="true">
          <div class="form-error" id="auth-err"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="reg-pwd">Пароль</label>
          <input class="form-input" id="reg-pwd" type="password" placeholder="min. 6 символов" autocomplete="new-password" aria-required="true">
        </div>
        <div class="form-group">
          <label class="form-label" for="reg-pwd2">Повторите пароль</label>
          <input class="form-input" id="reg-pwd2" type="password" placeholder="повторите пароль" autocomplete="new-password" aria-required="true">
        </div>
        <button class="btn-primary" style="width:100%;justify-content:center;padding:12px" onclick="Auth.doRegister()">Создать аккаунт</button>`;
      setTimeout(()=>document.getElementById('reg-username')?.focus(),50);
    }
  }

  function showErr(msg) {
    const el = document.getElementById('auth-err');
    if(el){el.style.display='block';el.textContent=msg;}
  }

  async function doLogin() {
    const u=document.getElementById('auth-username')?.value||'';
    const p=document.getElementById('auth-pwd')?.value||'';
    const r=await login(u,p);
    if(r.error) showErr(r.error);
  }

  async function doRegister() {
    const u=document.getElementById('reg-username')?.value||'';
    const p=document.getElementById('reg-pwd')?.value||'';
    const p2=document.getElementById('reg-pwd2')?.value||'';
    const r=await register(u,p,p2);
    if(r.error) showErr(r.error);
  }

  function updateUserData(data) {
    const users=getUsers();
    const u=currentUser();
    if(!u||!users[u]) return;
    Object.assign(users[u],data);
    LS.set('st_users',users);
  }

  return {currentUser,getUserData,getUsers,register,login,logout,requireLogin,openModal,closeModal,switchTab,renderForm,doLogin,doRegister,updateUserData};
})();

// =========================================================
// ROUTER
// =========================================================
const Router = (() => {
  let current = '/';

  function go(path) {
    window.location.hash = '#' + path;
    UI.closeSidebar();
  }

  function parse(hash) {
    const h = hash.replace(/^#/,'');
    if(!h||h==='/') return {page:'home',params:{}};
    const parts = h.split('/').filter(Boolean);
    if(parts[0]==='watch'&&parts[1]) return {page:'watch',params:{id:parts[1]}};
    if(parts[0]==='channel'&&parts[1]) return {page:'channel',params:{username:parts[1]}};
    if(parts[0]==='search') return {page:'search',params:{q:decodeURIComponent(parts[1]||'')}};
    if(parts[0]==='subscriptions') return {page:'subscriptions',params:{}};
    if(parts[0]==='history') return {page:'history',params:{}};
    if(parts[0]==='playlists') return {page:'playlists',params:{}};
    if(parts[0]==='settings') return {page:'settings',params:{}};
    return {page:'home',params:{}};
  }

  function handle() {
    const {page,params} = parse(window.location.hash);
    current = page;
    Pages.show(page,params);
    _updateActiveNav(page);
  }

  function _updateActiveNav(page) {
    document.querySelectorAll('.sidebar-item').forEach(el=>{
      el.classList.remove('active');
      const r=el.dataset.route;
      if((page==='home'&&r==='/')||(r&&r.includes(page))) el.classList.add('active');
    });
    document.querySelectorAll('.mobile-nav-item').forEach(el=>{
      el.classList.remove('active');
      const r=el.dataset.mroute;
      if((page==='home'&&r==='/')||(r&&r.includes(page))) el.classList.add('active');
    });
  }

  function getCurrent(){return current;}

  return {go,parse,handle,getCurrent};
})();

// =========================================================
// UI
// =========================================================
const UI = (() => {
  function toast(msg,type='info',dur=3000) {
    const icons={success:'✓',error:'✕',info:'ℹ'};
    const el=document.createElement('div');
    el.className=`toast ${type}`;
    el.innerHTML=`<span>${icons[type]||'ℹ'}</span><span>${Utils.sanitize(msg)}</span>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(()=>{el.style.transition='opacity .4s,transform .4s';el.style.opacity='0';el.style.transform='translateX(100%)';setTimeout(()=>el.remove(),400);},dur);
  }

  function toggleTheme() {
    const html=document.documentElement;
    const dark=html.dataset.theme==='dark';
    html.dataset.theme = dark?'light':'dark';
    LS.set('st_theme',html.dataset.theme);
    const item=document.getElementById('dd-theme-item');
    if(item) item.querySelector('span')?.remove();
  }

  function initTheme() {
    const t=LS.get('st_theme','light');
    document.documentElement.dataset.theme=t;
  }

  function updateAuthUI() {
    const user=Auth.currentUser();
    const userData=user?Auth.getUserData(user):null;
    const av=document.getElementById('avatar-btn');
    const ddAv=document.getElementById('dd-av');
    const mav=document.getElementById('mobile-av');
    const ddName=document.getElementById('dd-name');
    const ddUser=document.getElementById('dd-username');
    const ddAuth=document.getElementById('dd-auth-items');
    const ddUser2=document.getElementById('dd-user-items');

    if(user&&userData) {
      _setAvEl(av,userData);
      _setAvEl(ddAv,userData,42);
      _setAvEl(mav,userData,24);
      ddName.textContent=userData.displayName||user;
      ddUser.textContent='@'+user;
      ddAuth.style.display='none';
      ddUser2.style.display='block';
    } else {
      av.textContent='?';
      av.style.background='var(--text3)';
      if(ddAv){ddAv.textContent='?';ddAv.style.background='var(--text3)';}
      if(mav){mav.textContent='?';mav.style.background='var(--text3)';}
      ddName.textContent='Гость';
      ddUser.textContent='Войдите в аккаунт';
      ddAuth.style.display='block';
      ddUser2.style.display='none';
    }
  }

  function _setAvEl(el,userData,size) {
    if(!el) return;
    if(userData.avatar) {
      el.innerHTML=`<img src="${userData.avatar}" alt="Аватар">`;
    } else {
      el.innerHTML='';
      el.textContent=Utils.initials(userData.displayName||userData.username);
      el.style.background=userData.avatarColor||'var(--accent)';
    }
  }

  function getAvatarEl(username, size=36) {
    const userData=Auth.getUserData(username);
    const div=document.createElement('div');
    div.style.cssText=`width:${size}px;height:${size}px;border-radius:50%;background:${userData?.avatarColor||Utils.randomColor(username)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.max(10,size*0.35)}px;overflow:hidden;flex-shrink:0;`;
    if(userData?.avatar) {
      div.innerHTML=`<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover" alt="">`;
    } else {
      div.textContent=Utils.initials(username);
    }
    return div;
  }

  function toggleProfileDropdown() {
    const dd=document.getElementById('profile-dropdown');
    const open=dd.style.display==='block';
    dd.style.display=open?'none':'block';
  }

  function closeProfileDropdown() {
    document.getElementById('profile-dropdown').style.display='none';
  }

  function toggleSidebar() {
    const sb=document.getElementById('sidebar');
    const ov=document.getElementById('sidebar-overlay');
    const open=sb.classList.contains('open');
    if(open){sb.classList.remove('open');ov.classList.remove('visible');}
    else{sb.classList.add('open');ov.classList.add('visible');}
  }

  function closeSidebar() {
    if(window.innerWidth>768) return;
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  }

  function skeletonGrid(n=8) {
    return Array(n).fill(0).map(()=>`
      <div class="skeleton-card">
        <div class="skeleton skeleton-thumb"></div>
        <div class="skeleton-info">
          <div class="skeleton skeleton-line" style="width:90%"></div>
          <div class="skeleton skeleton-line" style="width:60%"></div>
          <div class="skeleton skeleton-line" style="width:40%"></div>
        </div>
      </div>`).join('');
  }

  return {toast,toggleTheme,initTheme,updateAuthUI,getAvatarEl,toggleProfileDropdown,closeProfileDropdown,toggleSidebar,closeSidebar,skeletonGrid};
})();

// =========================================================
// VIDEO THUMBNAIL HELPERS
// =========================================================
const Thumb = (() => {
  const _cache={};

  async function getThumb(videoId) {
    if(_cache[videoId]) return _cache[videoId];
    const t=await IDB.get('thumbnails',videoId);
    if(t&&t.blob) {
      const url=URL.createObjectURL(t.blob);
      _cache[videoId]=url;
      return url;
    }
    return null;
  }

  async function captureFrame(videoBlob) {
    return new Promise(res=>{
      const v=document.createElement('video');
      v.muted=true;
      v.preload='metadata';
      const url=URL.createObjectURL(videoBlob);
      v.src=url;
      v.addEventListener('loadeddata',()=>{
        v.currentTime=Math.min(v.duration/4,5);
      });
      v.addEventListener('seeked',()=>{
        const c=document.createElement('canvas');
        c.width=480;c.height=270;
        const ctx=c.getContext('2d');
        ctx.drawImage(v,0,0,480,270);
        c.toBlob(blob=>{
          URL.revokeObjectURL(url);
          res(blob);
        },'image/jpeg',.7);
      },{once:true});
      v.addEventListener('error',()=>{URL.revokeObjectURL(url);res(null);});
    });
  }

  function renderThumb(videoId,container) {
    getThumb(videoId).then(url=>{
      if(url&&container) {
        container.innerHTML=`<img src="${url}" alt="Превью" loading="lazy">`;
      }
    });
  }

  return {getThumb,captureFrame,renderThumb};
})();

// =========================================================
// VIDEO DATA
// =========================================================
const VideoData = (() => {
  function getMeta(videoId) {
    const all=LS.get('st_videometa',{});
    return all[videoId]||null;
  }
  function getAllMeta() { return LS.get('st_videometa',{}); }
  function setMeta(videoId,data) {
    const all=LS.get('st_videometa',{});
    all[videoId]=data;
    LS.set('st_videometa',all);
  }
  function updateMeta(videoId,patch) {
    const all=LS.get('st_videometa',{});
    if(all[videoId]) Object.assign(all[videoId],patch);
    LS.set('st_videometa',all);
  }
  function deleteMeta(videoId) {
    const all=LS.get('st_videometa',{});
    delete all[videoId];
    LS.set('st_videometa',all);
  }
  function getAllSorted() {
    const meta=getAllMeta();
    return Object.values(meta).sort((a,b)=>b.createdAt-a.createdAt);
  }
  function getByAuthor(username) {
    return getAllSorted().filter(v=>v.author===username);
  }
  function search(q) {
    const lq=q.toLowerCase();
    return getAllSorted().filter(v=>
      v.title.toLowerCase().includes(lq)||
      v.description?.toLowerCase().includes(lq)||
      v.author.toLowerCase().includes(lq)||
      (v.tags||[]).some(t=>t.toLowerCase().includes(lq))
    );
  }
  return {getMeta,getAllMeta,setMeta,updateMeta,deleteMeta,getAllSorted,getByAuthor,search};
})();

// =========================================================
// VIDEO CARDS
// =========================================================
function renderVideoCard(v) {
  const el=document.createElement('div');
  el.className='video-card';
  el.setAttribute('role','article');
  el.onclick=()=>Router.go('/watch/'+v.id);
  el.innerHTML=`
    <div class="video-thumb" id="thumb-${v.id}">
      <div class="thumb-placeholder">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" opacity=".3"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
      <div class="thumb-play"><svg width="36" height="36" fill="white" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
      <div class="duration-badge">${Utils.fmtTime(v.duration||0)}</div>
    </div>
    <div class="video-info">
      <div class="video-channel">${Utils.sanitize(v.displayName||v.author)}</div>
      <div class="video-title">${Utils.sanitize(v.title)}</div>
      <div class="video-meta">
        <span>${Utils.fmtViews(v.views||0)} просмотров • ${Utils.timeAgo(v.createdAt)}</span>
      </div>
    </div>`;
  Thumb.renderThumb(v.id,el.querySelector(`#thumb-${v.id}`));
  return el;
}

function renderRecCard(v) {
  const el=document.createElement('div');
  el.className='rec-card';
  el.onclick=()=>Router.go('/watch/'+v.id);
  el.innerHTML=`
    <div class="rec-thumb" id="rthumb-${v.id}">
      <div class="thumb-placeholder"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" opacity=".3"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
    </div>
    <div class="rec-info">
      <div class="rec-title">${Utils.sanitize(v.title)}</div>
      <div class="rec-channel">${Utils.sanitize(v.displayName||v.author)}</div>
      <div class="rec-meta">${Utils.fmtViews(v.views||0)} просмотров</div>
    </div>`;
  Thumb.renderThumb(v.id,el.querySelector(`#rthumb-${v.id}`));
  return el;
}

function renderHistoryItem(v) {
  const el=document.createElement('div');
  el.className='history-item';
  el.onclick=()=>Router.go('/watch/'+v.id);
  el.innerHTML=`
    <div class="history-thumb" id="hthumb-${v.id}">
      <div class="thumb-placeholder"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" opacity=".3"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
    </div>
    <div class="history-info">
      <div class="history-title">${Utils.sanitize(v.title)}</div>
      <div class="history-meta">${Utils.sanitize(v.displayName||v.author)} • ${Utils.fmtViews(v.views||0)} просмотров</div>
    </div>`;
  Thumb.renderThumb(v.id,el.querySelector(`#hthumb-${v.id}`));
  return el;
}

// =========================================================
// COMMENTS
// =========================================================
const Comments = (() => {
  const RATE_LIMIT=10000; // 10 sec
  const _lastComment={};

  function getAll(videoId) {
    const all=LS.get('st_comments',{});
    return all[videoId]||[];
  }
  function saveAll(videoId,list) {
    const all=LS.get('st_comments',{});
    all[videoId]=list;
    LS.set('st_comments',all);
  }

  function add() {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    const inp=document.getElementById('comment-input');
    const text=inp?.value?.trim()||'';
    if(!text){UI.toast('Введите текст комментария','error');return;}
    if(text.length>2000){UI.toast('Комментарий слишком длинный','error');return;}
    const now=Date.now();
    if(_lastComment[user]&&now-_lastComment[user]<RATE_LIMIT){UI.toast('Подождите немного перед следующим комментарием','error');return;}
    _lastComment[user]=now;
    const vid=_currentVideo();
    if(!vid) return;
    const comments=getAll(vid);
    const c={
      id:Utils.uid(),
      author:user,
      text:Filter.clean(text),
      likes:[],
      createdAt:Date.now()
    };
    comments.unshift(c);
    saveAll(vid,comments);
    inp.value='';
    render(vid,document.getElementById('comment-sort-sel')?.value||'new');
    UI.toast('Комментарий добавлен','success');
  }

  function remove(id) {
    const vid=_currentVideo();
    if(!vid) return;
    const user=Auth.currentUser();
    let comments=getAll(vid);
    const c=comments.find(x=>x.id===id);
    if(!c) return;
    if(c.author!==user){UI.toast('Нельзя удалить чужой комментарий','error');return;}
    comments=comments.filter(x=>x.id!==id);
    saveAll(vid,comments);
    render(vid,document.getElementById('comment-sort-sel')?.value||'new');
    UI.toast('Комментарий удалён','info');
  }

  function toggleLike(id) {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    const vid=_currentVideo();
    if(!vid) return;
    const comments=getAll(vid);
    const c=comments.find(x=>x.id===id);
    if(!c) return;
    const idx=c.likes.indexOf(user);
    if(idx>=0) c.likes.splice(idx,1);
    else c.likes.push(user);
    saveAll(vid,comments);
    render(vid,document.getElementById('comment-sort-sel')?.value||'new');
  }

  function sort(val) {
    const vid=_currentVideo();
    if(!vid) return;
    render(vid,val);
  }

  function render(videoId,sortBy='new') {
    const user=Auth.currentUser();
    let comments=[...getAll(videoId)];
    if(sortBy==='top') comments.sort((a,b)=>b.likes.length-a.likes.length);
    const el=document.getElementById('comments-list');
    const header=document.getElementById('comments-header');
    if(!el) return;
    if(header) header.textContent=`Комментарии (${comments.length})`;
    if(!comments.length){
      el.innerHTML='<div class="empty-state" style="padding:30px 0"><p>Пока нет комментариев. Будьте первым!</p></div>';
      return;
    }
    el.innerHTML='';
    for(const c of comments) {
      const userData=Auth.getUserData(c.author);
      const div=document.createElement('div');
      div.className='comment-item';
      div.dataset.id=c.id;
      const liked=user&&c.likes.includes(user);
      div.innerHTML=`
        <div class="comment-av"></div>
        <div class="comment-body">
          <div class="comment-author">${Utils.sanitize(userData?.displayName||c.author)}<span class="comment-time">${Utils.timeAgo(c.createdAt)}</span></div>
          <div class="comment-text">${Utils.sanitize(c.text)}</div>
          <div class="comment-actions">
            <button class="comment-like-btn${liked?' liked':''}" onclick="Comments.toggleLike('${c.id}')" aria-label="Лайк">
              <svg width="13" height="13" fill="${liked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
              ${c.likes.length||''}
            </button>
            ${c.author===user?`<span class="comment-del" onclick="Comments.remove('${c.id}')" role="button" aria-label="Удалить">Удалить</span>`:''}
          </div>
        </div>`;
      const avContainer=div.querySelector('.comment-av');
      const avEl=UI.getAvatarEl(c.author,36);
      avEl.className='comment-av';
      div.replaceChild(avEl,avContainer);
      el.appendChild(div);
    }
  }

  function _currentVideo() {
    const h=window.location.hash.replace('#/watch/','');
    return h||null;
  }

  return {add,remove,toggleLike,sort,render};
})();

// =========================================================
// HISTORY MODULE
// =========================================================
const History = (() => {
  function add(videoId) {
    const user=Auth.currentUser();
    if(!user) return;
    const all=LS.get('st_history',{});
    const list=(all[user]||[]).filter(x=>x.videoId!==videoId);
    list.unshift({videoId,watchedAt:Date.now()});
    all[user]=list.slice(0,200);
    LS.set('st_history',all);
  }
  function get() {
    const user=Auth.currentUser();
    if(!user) return [];
    return (LS.get('st_history',{})[user]||[]);
  }
  function clear() {
    const user=Auth.currentUser();
    if(!user) return;
    const all=LS.get('st_history',{});
    all[user]=[];
    LS.set('st_history',all);
    Pages.show('history');
    UI.toast('История очищена','info');
  }
  return {add,get,clear};
})();

// =========================================================
// PLAYLISTS MODULE
// =========================================================
const Playlists = (() => {
  function getAll() {
    const user=Auth.currentUser();
    if(!user) return [];
    return (LS.get('st_playlists',{})[user]||[]);
  }
  function save(list) {
    const user=Auth.currentUser();
    if(!user) return;
    const all=LS.get('st_playlists',{});
    all[user]=list;
    LS.set('st_playlists',all);
  }
  function create(name) {
    const list=getAll();
    const p={id:Utils.uid(),name:name.trim(),videoIds:[],createdAt:Date.now()};
    list.push(p);
    save(list);
    return p;
  }
  function del(id) {
    save(getAll().filter(p=>p.id!==id));
  }
  function addVideo(playlistId,videoId) {
    const list=getAll();
    const p=list.find(x=>x.id===playlistId);
    if(p&&!p.videoIds.includes(videoId)) p.videoIds.push(videoId);
    save(list);
  }
  function removeVideo(playlistId,videoId) {
    const list=getAll();
    const p=list.find(x=>x.id===playlistId);
    if(p) p.videoIds=p.videoIds.filter(v=>v!==videoId);
    save(list);
  }
  function hasVideo(playlistId,videoId) {
    return (getAll().find(p=>p.id===playlistId)?.videoIds||[]).includes(videoId);
  }

  function openSaveModal(videoId) {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    const modal=document.getElementById('playlist-modal');
    const content=document.getElementById('playlist-modal-content');
    modal.classList.remove('hidden');
    const list=getAll();
    content.innerHTML=`
      <div id="pl-choices">${list.map(p=>`
        <div class="playlist-choice-item" onclick="Playlists.toggleVideo('${p.id}','${videoId}')">
          <div class="playlist-check${p.videoIds.includes(videoId)?' checked':''}" id="plc-${p.id}">
            ${p.videoIds.includes(videoId)?'✓':''}
          </div>
          <div>${Utils.sanitize(p.name)}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1.5px solid var(--border)">
        <input class="form-input" id="new-pl-name" placeholder="Новый плейлист..." style="width:100%;margin-bottom:8px">
        <button class="btn-secondary" style="width:100%;justify-content:center" onclick="Playlists.createAndAdd('${videoId}')">
          + Создать и добавить
        </button>
      </div>`;
  }

  function toggleVideo(playlistId,videoId) {
    const has=hasVideo(playlistId,videoId);
    if(has) removeVideo(playlistId,videoId);
    else addVideo(playlistId,videoId);
    const chk=document.getElementById('plc-'+playlistId);
    if(chk){chk.classList.toggle('checked');chk.textContent=has?'':'✓';}
    UI.toast(has?'Удалено из плейлиста':'Добавлено в плейлист','success');
  }

  function createAndAdd(videoId) {
    const name=document.getElementById('new-pl-name')?.value?.trim();
    if(!name){UI.toast('Введите название','error');return;}
    const p=create(name);
    addVideo(p.id,videoId);
    closeSaveModal();
    UI.toast('Плейлист создан и видео добавлено','success');
  }

  function closeSaveModal() {
    document.getElementById('playlist-modal').classList.add('hidden');
  }

  return {getAll,create,del,addVideo,removeVideo,hasVideo,openSaveModal,toggleVideo,createAndAdd,closeSaveModal};
})();

// =========================================================
// UPLOAD MODULE
// =========================================================
const Upload = (() => {
  let _selectedFile=null;
  let _thumbFile=null;

  function openModal() {
    document.getElementById('upload-modal').classList.remove('hidden');
    renderForm();
  }
  function closeModal() {
    document.getElementById('upload-modal').classList.add('hidden');
    _selectedFile=null;_thumbFile=null;
  }

  function renderForm() {
    const c=document.getElementById('upload-form-content');
    c.innerHTML=`
      <div class="form-group">
        <div class="file-drop-area" id="video-drop" aria-label="Выбрать видеофайл">
          <input type="file" accept="video/mp4,video/webm,video/*" onchange="Upload.onVideoSelect(this)" aria-label="Видеофайл">
          <div class="file-drop-icon">🎬</div>
          <div class="file-drop-text">Перетащите видео или нажмите для выбора<br><small style="color:var(--text3)">MP4, WebM до ~500МБ</small></div>
        </div>
        <div id="video-file-info" style="display:none" class="file-selected">
          <svg width="16" height="16" fill="none" stroke="var(--accent)" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="file-selected-name" id="video-file-name"></span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Обложка (необязательно)</label>
        <div class="file-drop-area" style="padding:16px" aria-label="Выбрать обложку">
          <input type="file" accept="image/*" onchange="Upload.onThumbSelect(this)" aria-label="Файл обложки">
          <div class="file-drop-text">Изображение-обложка (JPG/PNG)</div>
        </div>
        <div id="thumb-file-info" style="display:none" class="file-selected">
          <svg width="16" height="16" fill="none" stroke="var(--accent)" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="file-selected-name" id="thumb-file-name"></span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="upload-title">Название *</label>
        <input class="form-input" id="upload-title" placeholder="Название видео" maxlength="120" aria-required="true">
      </div>
      <div class="form-group">
        <label class="form-label" for="upload-desc">Описание</label>
        <textarea class="form-input" id="upload-desc" placeholder="Описание видео..." rows="3" style="resize:vertical;height:80px" maxlength="5000"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="upload-tags">Теги (через запятую)</label>
        <input class="form-input" id="upload-tags" placeholder="музыка, влог, обзор...">
      </div>
      <div class="progress-bar-wrap" id="upload-progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="upload-progress-fill"></div></div>
        <div class="progress-text" id="upload-progress-text">Подготовка...</div>
      </div>
      <button class="btn-primary" style="width:100%;justify-content:center;padding:12px;margin-top:8px" onclick="Upload.submit()">
        Загрузить видео
      </button>`;
  }

  function onVideoSelect(input) {
    const f=input.files[0];
    if(!f) return;
    _selectedFile=f;
    document.getElementById('video-file-info').style.display='flex';
    document.getElementById('video-file-name').textContent=f.name;
  }

  function onThumbSelect(input) {
    const f=input.files[0];
    if(!f) return;
    _thumbFile=f;
    document.getElementById('thumb-file-info').style.display='flex';
    document.getElementById('thumb-file-name').textContent=f.name;
  }

  async function submit() {
    const user=Auth.currentUser();
    if(!user) return;
    if(!_selectedFile){UI.toast('Выберите видеофайл','error');return;}
    const title=(document.getElementById('upload-title')?.value||'').trim();
    if(!title){UI.toast('Введите название','error');return;}
    if(title.length<2){UI.toast('Название слишком короткое','error');return;}
    const cleanTitle=Filter.clean(title);
    const desc=Filter.clean((document.getElementById('upload-desc')?.value||'').trim());
    const tags=(document.getElementById('upload-tags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);

    const pwWrap=document.getElementById('upload-progress-wrap');
    const fill=document.getElementById('upload-progress-fill');
    const text=document.getElementById('upload-progress-text');
    pwWrap.style.display='block';

    // Fake progress
    let progress=0;
    const interval=setInterval(()=>{
      progress=Math.min(progress+Math.random()*8,90);
      fill.style.width=progress+'%';
      text.textContent=`Обработка... ${Math.floor(progress)}%`;
    },200);

    try {
      // Get video duration
      const duration = await new Promise(res=>{
        const v=document.createElement('video');
        v.preload='metadata';
        const url=URL.createObjectURL(_selectedFile);
        v.onloadedmetadata=()=>{URL.revokeObjectURL(url);res(v.duration);};
        v.onerror=()=>{URL.revokeObjectURL(url);res(0);};
        v.src=url;
      });

      const id=Utils.uid();
      const userData=Auth.getUserData(user);

      // Store video blob in IDB
      await IDB.put('videos',{id,blob:_selectedFile});

      // Handle thumbnail
      let thumbBlob=_thumbFile;
      if(!thumbBlob) {
        text.textContent='Генерация превью...';
        thumbBlob=await Thumb.captureFrame(_selectedFile);
      }
      if(thumbBlob) await IDB.put('thumbnails',{id,blob:thumbBlob});

      // Save metadata
      VideoData.setMeta(id,{
        id,title:cleanTitle,description:desc,tags,
        author:user,
        displayName:userData?.displayName||user,
        duration:isFinite(duration)?duration:0,
        views:0,likes:[],dislikes:[],
        createdAt:Date.now()
      });

      clearInterval(interval);
      fill.style.width='100%';
      text.textContent='Готово!';
      setTimeout(()=>{
        closeModal();
        UI.toast('Видео загружено!','success');
        if(Router.getCurrent()==='home') Pages.show('home');
      },600);
    } catch(e) {
      clearInterval(interval);
      console.error(e);
      UI.toast('Ошибка загрузки: '+e.message,'error');
      pwWrap.style.display='none';
    }
  }

  return {openModal,closeModal,renderForm,onVideoSelect,onThumbSelect,submit};
})();

// =========================================================
// VIDEO PAGE
// =========================================================
const Video = (() => {
  let _current=null;

  async function load(videoId) {
    _current=null;
    const meta=VideoData.getMeta(videoId);
    if(!meta){UI.toast('Видео не найдено','error');Router.go('/');return;}

    _current=meta;

    // Load blob
    const vdata=await IDB.get('videos',videoId);
    const videoEl=document.getElementById('main-video');

    if(vdata?.blob) {
      const url=URL.createObjectURL(vdata.blob);
      videoEl.src=url;
      videoEl.onloadeddata=()=>{};
    } else {
      videoEl.src='';
      UI.toast('Видеофайл не найден','error');
    }

    // Title
    document.getElementById('watch-title').textContent=meta.title;

    // Meta
    VideoData.updateMeta(videoId,{views:(meta.views||0)+1});
    _current.views=(meta.views||0)+1;
    document.getElementById('watch-meta').textContent=`${Utils.fmtViews(_current.views)} просмотров • ${Utils.timeAgo(meta.createdAt)}`;

    // History
    History.add(videoId);

    // Likes
    _updateLikeUI();

    // Description
    const descEl=document.getElementById('watch-desc');
    const toggleEl=document.getElementById('desc-toggle');
    const fullDesc=meta.description||'';
    const short=fullDesc.length>200;
    descEl.textContent=short?fullDesc.slice(0,200)+'…':fullDesc;
    if(!fullDesc) document.getElementById('watch-desc-box').style.display='none';
    else document.getElementById('watch-desc-box').style.display='block';
    if(toggleEl){toggleEl.style.display=short?'inline':'none';toggleEl.dataset.expanded='0';}

    // Channel
    const userData=Auth.getUserData(meta.author);
    const chAv=document.getElementById('watch-ch-av');
    const chName=document.getElementById('watch-ch-name');
    const chSubs=document.getElementById('watch-ch-subs');
    const subBtn=document.getElementById('watch-sub-btn');

    if(userData?.avatar) chAv.innerHTML=`<img src="${userData.avatar}" alt="">`;
    else {chAv.textContent=Utils.initials(meta.displayName||meta.author);chAv.style.background=userData?.avatarColor||Utils.randomColor(meta.author);}
    chName.textContent=meta.displayName||meta.author;
    const subCount=_getSubCount(meta.author);
    chSubs.textContent=`${Utils.fmtViews(subCount)} подписчиков`;

    const user=Auth.currentUser();
    const isSubbed=user&&_isSubbed(meta.author);
    subBtn.textContent=isSubbed?'Отписаться':'Подписаться';
    subBtn.className='sub-btn'+(isSubbed?' subbed':'');

    // Comment avatar
    const caEl=document.getElementById('comment-user-av');
    if(caEl) {
      if(user) {
        const ud=Auth.getUserData(user);
        if(ud?.avatar) caEl.innerHTML=`<img src="${ud.avatar}" style="width:100%;height:100%;object-fit:cover" alt="">`;
        else {caEl.textContent=Utils.initials(ud?.displayName||user);caEl.style.background=ud?.avatarColor||Utils.randomColor(user);}
      } else { caEl.textContent='?'; }
    }

    // Comments
    Comments.render(videoId);

    // Recommendations
    const recList=document.getElementById('rec-list');
    if(recList) {
      recList.innerHTML='';
      const all=VideoData.getAllSorted().filter(v=>v.id!==videoId).slice(0,12);
      if(!all.length) recList.innerHTML='<div class="empty-state"><p>Нет других видео</p></div>';
      else all.forEach(v=>recList.appendChild(renderRecCard(v)));
    }
  }

  function _updateLikeUI() {
    if(!_current) return;
    const user=Auth.currentUser();
    const liked=user&&(_current.likes||[]).includes(user);
    const disliked=user&&(_current.dislikes||[]).includes(user);
    const lb=document.getElementById('like-btn');
    const db=document.getElementById('dislike-btn');
    const lc=document.getElementById('like-count');
    const dc=document.getElementById('dislike-count');
    if(lb) lb.classList.toggle('liked',liked);
    if(db) db.classList.toggle('liked',disliked);
    if(lc) lc.textContent=(_current.likes||[]).length||0;
    if(dc) dc.textContent=(_current.dislikes||[]).length||0;
  }

  function toggleLike() {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    if(!_current) return;
    const meta=VideoData.getMeta(_current.id);
    const likes=[...(meta.likes||[])];
    const dislikes=[...(meta.dislikes||[])];
    const li=likes.indexOf(user);
    const di=dislikes.indexOf(user);
    if(li>=0) likes.splice(li,1);
    else { likes.push(user); if(di>=0) dislikes.splice(di,1); }
    VideoData.updateMeta(_current.id,{likes,dislikes});
    _current.likes=likes;_current.dislikes=dislikes;
    _updateLikeUI();
  }

  function toggleDislike() {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    if(!_current) return;
    const meta=VideoData.getMeta(_current.id);
    const likes=[...(meta.likes||[])];
    const dislikes=[...(meta.dislikes||[])];
    const li=likes.indexOf(user);
    const di=dislikes.indexOf(user);
    if(di>=0) dislikes.splice(di,1);
    else { dislikes.push(user); if(li>=0) likes.splice(li,1); }
    VideoData.updateMeta(_current.id,{likes,dislikes});
    _current.likes=likes;_current.dislikes=dislikes;
    _updateLikeUI();
  }

  function toggleDesc() {
    if(!_current) return;
    const descEl=document.getElementById('watch-desc');
    const toggleEl=document.getElementById('desc-toggle');
    const expanded=toggleEl.dataset.expanded==='1';
    if(expanded){
      descEl.textContent=(_current.description||'').slice(0,200)+'…';
      toggleEl.textContent='Показать ещё';
      toggleEl.dataset.expanded='0';
    } else {
      descEl.textContent=_current.description||'';
      toggleEl.textContent='Скрыть';
      toggleEl.dataset.expanded='1';
    }
  }

  function share() {
    const url=window.location.href;
    if(navigator.clipboard){navigator.clipboard.writeText(url).then(()=>UI.toast('Ссылка скопирована','success')).catch(()=>UI.toast('Не удалось скопировать','error'));}
    else{UI.toast('Ссылка: '+url,'info',6000);}
  }

  function saveToPlaylist() {
    if(!_current) return;
    Auth.requireLogin(()=>Playlists.openSaveModal(_current.id));
  }

  function goToChannel() {
    if(!_current) return;
    Channel.open(_current.author);
  }

  function toggleSub() {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    if(!_current) return;
    _toggleSubTo(_current.author);
    const isSubbed=_isSubbed(_current.author);
    const btn=document.getElementById('watch-sub-btn');
    if(btn){btn.textContent=isSubbed?'Отписаться':'Подписаться';btn.className='sub-btn'+(isSubbed?' subbed':'');}
    UI.toast(isSubbed?'Вы подписались':'Вы отписались','success');
  }

  function _isSubbed(channel) {
    const user=Auth.currentUser();
    if(!user||user===channel) return false;
    const userData=Auth.getUserData(user);
    return (userData?.subs||[]).includes(channel);
  }

  function _toggleSubTo(channel) {
    const user=Auth.currentUser();
    if(!user||user===channel) return;
    const users=Auth.getUsers();
    const u=users[user];
    if(!u) return;
    if(!u.subs) u.subs=[];
    const idx=u.subs.indexOf(channel);
    if(idx>=0) u.subs.splice(idx,1);
    else u.subs.push(channel);
    LS.set('st_users',users);
  }

  function _getSubCount(channel) {
    const users=Auth.getUsers();
    return Object.values(users).filter(u=>(u.subs||[]).includes(channel)).length;
  }

  return {load,toggleLike,toggleDislike,toggleDesc,share,saveToPlaylist,goToChannel,toggleSub};
})();

// =========================================================
// CHANNEL PAGE
// =========================================================
const Channel = (() => {
  let _username=null;

  function open(username) {
    Router.go('/channel/'+username);
  }

  function load(username) {
    _username=username;
    const userData=Auth.getUserData(username);
    if(!userData){UI.toast('Канал не найден','error');Router.go('/');return;}

    // Avatar
    const bigAv=document.getElementById('channel-big-av');
    if(userData.avatar) bigAv.innerHTML=`<img src="${userData.avatar}" alt="">`;
    else {bigAv.textContent=Utils.initials(userData.displayName||username);bigAv.style.background=userData.avatarColor||Utils.randomColor(username);}

    document.getElementById('channel-big-name').textContent=userData.displayName||username;

    const subCount=Object.values(Auth.getUsers()).filter(u=>(u.subs||[]).includes(username)).length;
    const videoCount=VideoData.getByAuthor(username).length;
    document.getElementById('channel-stats').textContent=`${Utils.fmtViews(subCount)} подписчиков • ${videoCount} видео`;

    const user=Auth.currentUser();
    const isMe=user===username;
    const btn=document.getElementById('channel-sub-btn');
    if(isMe){btn.style.display='none';}
    else{
      btn.style.display='inline-flex';
      const isSubbed=(Auth.getUserData(user)?.subs||[]).includes(username);
      btn.textContent=isSubbed?'Отписаться':'Подписаться';
      btn.className='sub-btn btn-primary'+(isSubbed?' subbed':'');
    }

    setTab('videos',document.querySelector('.channel-tab'));
  }

  function setTab(tab,el) {
    document.querySelectorAll('.channel-tab').forEach(t=>t.classList.remove('active'));
    if(el) el.classList.add('active');
    const c=document.getElementById('channel-content');
    if(tab==='videos') {
      const vids=VideoData.getByAuthor(_username);
      c.innerHTML='';
      if(!vids.length){
        c.innerHTML='<div class="empty-state"><svg class="empty-icon" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10 9 15 12 10 15"/></svg><h3>Нет видео</h3><p>На этом канале пока нет видео.</p></div>';
        return;
      }
      const grid=document.createElement('div');
      grid.className='video-grid';
      vids.forEach(v=>grid.appendChild(renderVideoCard(v)));
      c.appendChild(grid);
    } else if(tab==='playlists') {
      c.innerHTML='<div class="empty-state"><p>Плейлисты канала недоступны</p></div>';
    } else {
      const userData=Auth.getUserData(_username);
      c.innerHTML=`<div class="channel-about">${Utils.sanitize(userData?.bio||'Автор не добавил описание канала.')}</div>`;
    }
  }

  function toggleSub() {
    const user=Auth.currentUser();
    if(!user){Auth.openModal();return;}
    if(user===_username) return;
    const users=Auth.getUsers();
    const u=users[user];
    if(!u) return;
    if(!u.subs) u.subs=[];
    const idx=u.subs.indexOf(_username);
    if(idx>=0) u.subs.splice(idx,1);
    else u.subs.push(_username);
    LS.set('st_users',users);
    const isSubbed=u.subs.includes(_username);
    const btn=document.getElementById('channel-sub-btn');
    if(btn){btn.textContent=isSubbed?'Отписаться':'Подписаться';btn.className='sub-btn btn-primary'+(isSubbed?' subbed':'');}
    const subCount=Object.values(Auth.getUsers()).filter(u2=>(u2.subs||[]).includes(_username)).length;
    const videoCount=VideoData.getByAuthor(_username).length;
    document.getElementById('channel-stats').textContent=`${Utils.fmtViews(subCount)} подписчиков • ${videoCount} видео`;
    UI.toast(isSubbed?'Вы подписались':'Вы отписались','success');
  }

  return {open,load,setTab,toggleSub};
})();

// =========================================================
// SEARCH MODULE
// =========================================================
const Search = (() => {
  let _filter='all';

  function execute() {
    const q=(document.getElementById('search-input')?.value||'').trim();
    if(!q) return;
    hideSuggestions();
    Router.go('/search/'+encodeURIComponent(q));
  }

  function live(q) {
    const box=document.getElementById('search-suggestions');
    if(!q.trim()){hideSuggestions();return;}
    const results=VideoData.search(q).slice(0,6);
    if(!results.length){hideSuggestions();return;}
    box.innerHTML=results.map(v=>`
      <div class="suggestion-item" onclick="document.getElementById('search-input').value='${v.title.replace(/'/g,"\\'")}';Search.execute()" role="option">
        <svg class="suggestion-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        ${Utils.sanitize(v.title)}
      </div>`).join('');
    box.style.display='block';
  }

  function hideSuggestions() {
    const box=document.getElementById('search-suggestions');
    if(box) box.style.display='none';
  }

  function setFilter(f,el) {
    _filter=f;
    document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
    if(el) el.classList.add('active');
    Pages.renderHome();
  }

  function getFilter(){return _filter;}

  function renderResults(q) {
    document.getElementById('search-result-title').textContent=`Результаты: "${q}"`;
    const grid=document.getElementById('search-results-grid');
    grid.innerHTML='';
    const results=VideoData.search(q);
    if(!results.length){
      grid.innerHTML=`<div class="empty-state"><svg class="empty-icon" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><h3>Ничего не найдено</h3><p>По запросу «${Utils.sanitize(q)}» ничего не нашлось.</p></div>`;
      return;
    }
    const g=document.createElement('div');g.className='video-grid';
    results.forEach(v=>g.appendChild(renderVideoCard(v)));
    grid.appendChild(g);
  }

  return {execute,live,hideSuggestions,setFilter,getFilter,renderResults};
})();

// =========================================================
// PAGES
// =========================================================
const Pages = (() => {
  function show(page,params={}) {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    const el=document.getElementById('page-'+page);
    if(el) el.classList.add('active');

    // Pause video when leaving watch page
    if(page!=='watch') {
      const v=document.getElementById('main-video');
      if(v) v.pause();
    }

    switch(page) {
      case 'home': renderHome(); break;
      case 'watch': Video.load(params.id); break;
      case 'channel': Channel.load(params.username); break;
      case 'subscriptions': renderSubscriptions(); break;
      case 'history': renderHistory(); break;
      case 'playlists': renderPlaylists(); break;
      case 'settings': renderSettings(); break;
      case 'search': Search.renderResults(params.q||''); break;
    }
  }

  function renderHome() {
    const grid=document.getElementById('home-grid');
    grid.innerHTML=UI.skeletonGrid(8);
    setTimeout(()=>{
      grid.innerHTML='';
      let vids=VideoData.getAllSorted();
      const f=Search.getFilter();
      if(f==='recent') vids=vids.slice(0,Math.min(20,vids.length));
      else if(f==='popular') vids=[...vids].sort((a,b)=>(b.views||0)-(a.views||0));

      if(!vids.length) {
        grid.innerHTML=`
          <div class="empty-state" style="grid-column:1/-1">
            <svg class="empty-icon" width="80" height="80" fill="none" stroke="currentColor" stroke-width="1.2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10 9 15 12 10 15"/></svg>
            <h3>Здесь пока пусто</h3>
            <p>Загрузите первое видео, чтобы оно появилось в ленте.</p>
            <button class="btn-primary" onclick="Auth.requireLogin(Upload.openModal)">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Загрузить видео
            </button>
          </div>`;
        return;
      }
      vids.forEach(v=>{
        const card=renderVideoCard(v);
        card.style.opacity='0';card.style.transform='translateY(10px)';
        grid.appendChild(card);
        requestAnimationFrame(()=>{card.style.transition='opacity .35s ease,transform .35s ease';card.style.opacity='1';card.style.transform='none';});
      });
    },400);
  }

  function renderSubscriptions() {
    const user=Auth.currentUser();
    const c=document.getElementById('subs-content');
    if(!user){c.innerHTML='<div class="empty-state"><h3>Войдите в аккаунт</h3><p>Чтобы видеть подписки.</p><button class="btn-primary" onclick="Auth.openModal()">Войти</button></div>';return;}
    const userData=Auth.getUserData(user);
    const subs=userData?.subs||[];
    if(!subs.length){c.innerHTML='<div class="empty-state"><h3>Нет подписок</h3><p>Подпишитесь на каналы, чтобы видеть их видео здесь.</p></div>';return;}
    const vids=VideoData.getAllSorted().filter(v=>subs.includes(v.author));
    if(!vids.length){c.innerHTML='<div class="empty-state"><h3>Нет видео от подписок</h3><p>Ваши подписки ещё не загрузили видео.</p></div>';return;}
    c.innerHTML='';
    const g=document.createElement('div');g.className='video-grid';
    vids.forEach(v=>g.appendChild(renderVideoCard(v)));
    c.appendChild(g);
  }

  function renderHistory() {
    const user=Auth.currentUser();
    const list=document.getElementById('history-list');
    if(!user){list.innerHTML='<div class="empty-state"><h3>Войдите в аккаунт</h3><p>Чтобы видеть историю просмотров.</p><button class="btn-primary" onclick="Auth.openModal()">Войти</button></div>';return;}
    const hist=History.get();
    if(!hist.length){list.innerHTML='<div class="empty-state"><h3>История пуста</h3><p>Просматривайте видео, и они появятся здесь.</p></div>';return;}
    list.innerHTML='';
    for(const entry of hist) {
      const meta=VideoData.getMeta(entry.videoId);
      if(!meta) continue;
      list.appendChild(renderHistoryItem(meta));
    }
  }

  function renderPlaylists() {
    const user=Auth.currentUser();
    const grid=document.getElementById('playlists-grid');
    if(!user){grid.innerHTML='<div class="empty-state" style="grid-column:1/-1"><h3>Войдите в аккаунт</h3><button class="btn-primary" onclick="Auth.openModal()">Войти</button></div>';return;}
    const pls=Playlists.getAll();
    grid.innerHTML='';
    // New playlist card
    const nc=document.createElement('div');
    nc.className='playlist-card new-playlist-card';
    nc.setAttribute('role','button');
    nc.setAttribute('aria-label','Создать плейлист');
    nc.onclick=()=>{const n=prompt('Название плейлиста:');if(n?.trim()){Playlists.create(n.trim());renderPlaylists();UI.toast('Плейлист создан','success');}};
    nc.innerHTML=`<svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Создать плейлист</span>`;
    grid.appendChild(nc);

    pls.forEach(p=>{
      const card=document.createElement('div');
      card.className='playlist-card';
      const firstVid=p.videoIds[0]?VideoData.getMeta(p.videoIds[0]):null;
      card.innerHTML=`
        <div class="playlist-thumb" id="plthumb-${p.id}">
          ${firstVid?`<span style="font-size:.8rem;position:absolute;inset:0;display:flex;align-items:center;justify-content:center"></span>`:`<span>🎵</span>`}
        </div>
        <div class="playlist-info">
          <div class="playlist-name">${Utils.sanitize(p.name)}</div>
          <div class="playlist-count">${p.videoIds.length} видео</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn-secondary" style="padding:4px 10px;font-size:.75rem" onclick="event.stopPropagation();Playlists.del('${p.id}');Pages.renderPlaylists()">Удалить</button>
          </div>
        </div>`;
      if(firstVid) {
        const thumbEl=card.querySelector(`#plthumb-${p.id}`);
        Thumb.renderThumb(firstVid.id,thumbEl);
      }
      grid.appendChild(card);
    });
  }

  function renderSettings() {
    const user=Auth.currentUser();
    const c=document.getElementById('settings-content');
    if(!user) {
      c.innerHTML='<div class="empty-state"><h3>Войдите в аккаунт</h3><p>Для доступа к настройкам.</p><button class="btn-primary" onclick="Auth.openModal()">Войти</button></div>';
      return;
    }
    const userData=Auth.getUserData(user);
    const isDark=document.documentElement.dataset.theme==='dark';

    c.innerHTML=`
      <div class="settings-section">
        <h3>Профиль</h3>
        <div class="settings-row" style="align-items:flex-start;flex-direction:column;gap:12px">
          <label style="font-size:.85rem;color:var(--text2);font-weight:600">Аватар</label>
          <div class="avatar-upload-area" id="avatar-area" onclick="document.getElementById('avatar-file').click()" style="background:${userData.avatarColor||'var(--accent)'}" aria-label="Загрузить аватар">
            ${userData.avatar?`<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover" alt="Аватар">`:`<span>${Utils.initials(userData.displayName||user)}</span>`}
            <div class="avatar-upload-overlay">📷<br>Изменить</div>
          </div>
          <input type="file" id="avatar-file" accept="image/*" style="display:none" onchange="Settings.onAvatarSelect(this)">
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label" for="s-displayname">Отображаемое имя</label>
          <input class="form-input" id="s-displayname" value="${Utils.sanitize(userData.displayName||user)}" maxlength="50">
        </div>
        <div class="form-group">
          <label class="form-label" for="s-bio">О себе / О канале</label>
          <textarea class="form-input" id="s-bio" rows="3" style="resize:vertical;height:80px" maxlength="500">${Utils.sanitize(userData.bio||'')}</textarea>
        </div>
        <button class="btn-primary" onclick="Settings.saveProfile()">Сохранить</button>
      </div>
      <div class="settings-section">
        <h3>Внешний вид</h3>
        <div class="settings-row">
          <span class="settings-label">Тёмная тема</span>
          <div class="toggle-switch${isDark?' on':''}" id="theme-toggle" onclick="Settings.toggleTheme(this)" role="switch" aria-checked="${isDark}" aria-label="Тёмная тема">
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h3>Аккаунт</h3>
        <div class="settings-row">
          <span class="settings-label">Имя пользователя: @${user}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Дата регистрации: ${new Date(userData.createdAt).toLocaleDateString('ru-RU')}</span>
        </div>
        <div style="margin-top:8px">
          <button class="btn-secondary btn-danger" onclick="if(confirm('Выйти из аккаунта?'))Auth.logout()">Выйти из аккаунта</button>
        </div>
      </div>`;
  }

  return {show,renderHome,renderSubscriptions,renderHistory,renderPlaylists,renderSettings};
})();

// =========================================================
// SETTINGS ACTIONS
// =========================================================
const Settings = (() => {
  function saveProfile() {
    const name=(document.getElementById('s-displayname')?.value||'').trim();
    const bio=(document.getElementById('s-bio')?.value||'').trim();
    if(!name){UI.toast('Имя не может быть пустым','error');return;}
    Auth.updateUserData({displayName:name,bio});
    UI.updateAuthUI();
    UI.toast('Профиль сохранён','success');
  }

  function onAvatarSelect(input) {
    const f=input.files[0];
    if(!f) return;
    const reader=new FileReader();
    reader.onload=e=>{
      Auth.updateUserData({avatar:e.target.result});
      const area=document.getElementById('avatar-area');
      if(area) area.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover" alt="Аватар"><div class="avatar-upload-overlay">📷<br>Изменить</div>`;
      UI.updateAuthUI();
      UI.toast('Аватар обновлён','success');
    };
    reader.readAsDataURL(f);
  }

  function toggleTheme(el) {
    UI.toggleTheme();
    el.classList.toggle('on');
    const isDark=document.documentElement.dataset.theme==='dark';
    el.setAttribute('aria-checked',isDark);
  }

  return {saveProfile,onAvatarSelect,toggleTheme};
})();

// =========================================================
// APP INIT
// =========================================================
async function init() {
  // Init theme
  UI.initTheme();

  // Open IDB
  try { await IDB.open(); }
  catch(e) { console.warn('IDB failed',e); UI.toast('IndexedDB недоступен. Видео не сохранятся.','error',6000); }

  // Auth UI
  UI.updateAuthUI();

  // Router
  window.addEventListener('hashchange', Router.handle);
  Router.handle();

  // Search
  const si=document.getElementById('search-input');
  if(si) {
    si.addEventListener('input',e=>Search.live(e.target.value));
    si.addEventListener('keydown',e=>{if(e.key==='Enter')Search.execute();if(e.key==='Escape')Search.hideSuggestions();});
  }

  // Close suggestions on outside click
  document.addEventListener('click',e=>{
    if(!document.getElementById('search-container')?.contains(e.target)) Search.hideSuggestions();
    if(!document.getElementById('profile-dropdown')?.contains(e.target)&&!document.getElementById('avatar-btn')?.contains(e.target)&&!document.getElementById('mobile-av')?.closest('.mobile-nav-item')?.contains(e.target)) {
      UI.closeProfileDropdown();
    }
  });

  // Hotkeys
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA') {
      e.preventDefault();document.getElementById('search-input')?.focus();
    }
    if(e.key==='Escape') {
      document.getElementById('auth-modal')?.classList.add('hidden');
      document.getElementById('upload-modal')?.classList.add('hidden');
      document.getElementById('playlist-modal')?.classList.add('hidden');
      UI.closeProfileDropdown();
      Search.hideSuggestions();
    }
  });

  // Close modals on overlay click
  document.getElementById('auth-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)Auth.closeModal();});
  document.getElementById('upload-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)Upload.closeModal();});
  document.getElementById('playlist-modal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)Playlists.closeSaveModal();});
}

init();
