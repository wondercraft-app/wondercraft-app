/* WonderCraft PWA WC-7.33.11 - 案件マッチングタイムアウト対策 */
const state={view:"home",candidates:[],progress:[],today:[],progressStatuses:[],selected:null,runtimeConfig:{},user:null};
const $=id=>document.getElementById(id);
const config=window.WONDERCRAFT_CONFIG||{};
let debounceTimer;
let loadRequestId=0;

const WC_API_TIMEOUT_MS = 45000;
const WC_STARTUP_VISIBLE_TIMEOUT_MS = 9000;

async function wcFetchWithTimeout_(url, options={}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), WC_API_TIMEOUT_MS);

  try{
    return await fetch(url,{
      ...options,
      signal:controller.signal
    });
  }catch(error){
    if(error?.name==="AbortError"){
      const timeoutError=new Error("通信がタイムアウトしました。");
      timeoutError.code="NETWORK_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  }finally{
    clearTimeout(timer);
  }
}

function forceHideWcLoader_(){
  wcLoadingDepth=0;
  const overlay=$("wcLoadingOverlay");
  if(overlay){
    overlay.hidden=true;
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden","true");
    overlay.setAttribute("aria-busy","false");
    overlay.style.display="none";
  }
  document.body.classList.remove("wc-loading-active");
}

function isAnyMainScreenVisible_(){
  return [
    $("appPanel"),
    $("loginPanel"),
    $("systemPanel")
  ].some(el=>el && !el.hidden);
}


window.addEventListener("load",async()=>{
  wcLoadingDepth=1;
  wcLoadingShownAt=Date.now();

  setTimeout(()=>{
    $("splash")?.classList.add("hide");
    setTimeout(()=>$("splash")?.remove(),450);
  },900);

  updateWcLoadingText_("読み込み中…");

  const watchdog=setTimeout(()=>{
    console.warn("WonderCraft startup watchdog fired");
    forceHideWcLoader_();

    if(!isAnyMainScreenVisible_()){
      try{
        showLogin("読み込みに時間がかかっています。もう一度ログインするか、右上の更新を押してください。");
      }catch(_error){}
    }
  },WC_STARTUP_VISIBLE_TIMEOUT_MS);

  try{
    registerWonderCraftServiceWorker_();
    bindEvents();

    if($("appVersion")){
      $("appVersion").textContent=config.VERSION||"WC-7.33.11";
    }

    await initialize();
  }catch(error){
    console.error("WonderCraft startup error:",error);

    try{
      const detail=error?.message ? `（${error.message}）` : "";
      showLogin(`起動処理を再読み込みしてください。${detail}`);
    }catch(fallbackError){
      console.error("WonderCraft startup fallback error:",fallbackError);
    }
  }finally{
    clearTimeout(watchdog);
    if(window.__wcLoaderFailSafe){
      clearTimeout(window.__wcLoaderFailSafe);
      window.__wcLoaderFailSafe = null;
    }
    await hideWcLoading_(true);
    forceHideWcLoader_();
  }
});


let wcReloading = false;
let wcSwRefreshing = false;

async function handleManualReload(){
  wcViewCacheClear_();
  if(wcReloading) return;
  const btn = $("reloadBtn");
  wcReloading = true;
  if(btn){
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.textContent = "↻";
    btn.setAttribute("aria-label","更新中");
    btn.title = "更新中…";
  }
  showWcLoading_("更新中…");
  setStatus("更新中…");
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try{
    if("serviceWorker" in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg){ try{ await reg.update(); }catch(_e){} }
    }
    await initialize(true);
    setStatus("最新情報に更新しました。");
  }catch(err){
    setStatus("更新に失敗しました。もう一度お試しください。");
    console.error("manual reload failed", err);
  }finally{
    await hideWcLoading_(true);
    if(btn){
      btn.disabled = false;
      btn.classList.remove("is-loading");
      btn.textContent = "↻";
      btn.setAttribute("aria-label","再読み込み");
      btn.title = "再読み込み";
    }
    wcReloading = false;
  }
}

async function registerWonderCraftServiceWorker_(){
  if(!("serviceWorker" in navigator)) return;

  try{
    const reg = await navigator.serviceWorker.register(
      "./service-worker.js?v=7.33.15-candidate-autocomplete",
      { updateViaCache:"none" }
    );

    await reg.update();

    if(reg.waiting){
      reg.waiting.postMessage({type:"SKIP_WAITING"});
    }

    reg.addEventListener("updatefound",()=>{
      const worker = reg.installing;
      if(!worker) return;

      worker.addEventListener("statechange",()=>{
        if(
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ){
          worker.postMessage({type:"SKIP_WAITING"});
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(wcSwRefreshing) return;
      wcSwRefreshing = true;
      sessionStorage.setItem("wc_sw_updated","1");
    });
  }catch(err){
    console.error("service worker update failed", err);
  }
}


let wcLoadingDepth = 0;
let wcLoadingShownAt = 0;
const WC_LOADING_MIN_MS = 800;
function showWcLoading_(message){
  const overlay = $("wcLoadingOverlay");
  const text = $("wcLoadingText");

  wcLoadingDepth++;

  if(wcLoadingDepth === 1){
    wcLoadingShownAt = Date.now();
  }

  if(text) text.textContent = message || "読み込み中…";

  if(overlay){
    overlay.style.removeProperty("display");
    overlay.hidden = false;
    overlay.setAttribute("aria-busy","true");
  }
}
function updateWcLoadingText_(message){
  const text = $("wcLoadingText");
  if(text) text.textContent = message || "読み込み中…";
}
async function hideWcLoading_(force=false){
  if(force) wcLoadingDepth = 0;
  else wcLoadingDepth = Math.max(0, wcLoadingDepth - 1);

  if(wcLoadingDepth > 0 && !force) return;

  const elapsed = Date.now() - wcLoadingShownAt;
  const wait = Math.max(0, WC_LOADING_MIN_MS - elapsed);

  if(wait){
    await new Promise(resolve => setTimeout(resolve, wait));
  }

  const overlay = $("wcLoadingOverlay");

  if(overlay){
    overlay.hidden = true;
    overlay.setAttribute("aria-busy","false");
  }
}


const WC_VIEW_CACHE_TTL = 60 * 1000;
const wcViewCache = new Map();

function wcViewCacheKey_(view, params){
  return view + ":" + JSON.stringify(params || {});
}
function wcViewCacheGet_(view, params){
  const key = wcViewCacheKey_(view, params);
  const item = wcViewCache.get(key);
  if(!item) return null;
  if(Date.now() - item.savedAt > WC_VIEW_CACHE_TTL){
    wcViewCache.delete(key);
    return null;
  }
  return item.data;
}
function wcViewCachePut_(view, params, data){
  wcViewCache.set(
    wcViewCacheKey_(view, params),
    {savedAt:Date.now(), data:data}
  );
}
function wcViewCacheClear_(){
  wcViewCache.clear();
}

function bindEvents(){
  $("systemRetryBtn")?.addEventListener("click",async()=>{showWcLoading_("再接続中…");try{await initialize(true)}finally{await hideWcLoading_(true)}});
  $("loginForm")?.addEventListener("submit",handleLogin);
  $("logoutBtn")?.addEventListener("click",logout);
  $("forgotPasswordBtn")?.addEventListener("click",()=>showLoginMessage("パスワード再発行申請は次の段階で追加します。現在は自社担当者へご連絡ください。",false));
  $("reloadBtn")?.addEventListener("click",handleManualReload);
  $("menuBtn")?.addEventListener("click",openAccountMenu_);
  $("userMenuBtn")?.addEventListener("click",openAccountMenu_);
  $("closeMenuBtn")?.addEventListener("click",closeAccountMenu_);
  $("menuLogoutBtn")?.addEventListener("click",()=>{closeAccountMenu_();logout();});
  document.addEventListener("click",event=>{const menu=$("accountMenu");if(!menu||menu.hidden)return;if(menu.contains(event.target)||$("menuBtn")?.contains(event.target)||$("userMenuBtn")?.contains(event.target))return;closeAccountMenu_();});
  $("searchInput").addEventListener("input",()=>{clearTimeout(debounceTimer);debounceTimer=setTimeout(loadCurrent,350)});
  $("staffFilter")?.addEventListener("change",loadCurrent);
  $("regionFilter")?.addEventListener("change",loadCurrent);
  $("experienceFilter")?.addEventListener("change",loadCurrent);
  $("careerFilter")?.addEventListener("change",loadCurrent);
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{closeAccountMenu_();switchView(b.dataset.view);});
  document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModal);
  $("editForm")?.addEventListener("submit",saveEdit);
  $("openSkillSheetBtn")?.addEventListener("click",openSkillSheet);
  $("runMatchingBtn")?.addEventListener("click",runCandidateMatching);
  $("matchingCandidateSearch")?.addEventListener("input",e=>{
    const hidden=$("matchingCandidateSelect");
    if(hidden)hidden.value="";
    renderMatchingCandidateOptions(e.target.value,true);
  });
  $("matchingCandidateSearch")?.addEventListener("focus",e=>renderMatchingCandidateOptions(e.target.value,true));
  $("matchingCandidateSearch")?.addEventListener("keydown",handleMatchingCandidateKeydown_);
  document.addEventListener("click",event=>{
    const wrap=document.querySelector(".matching-candidate-autocomplete");
    if(wrap&&!wrap.contains(event.target))closeMatchingCandidateSuggestions_();
  });
  $("runJobSearchBtn")?.addEventListener("click",runStationAwareJobSearch_);
  $("resetJobSearchBtn")?.addEventListener("click",resetJobSearch);
  ["jobDistanceRange","jobPayMin","jobPayMax"].forEach(id=>$(id)?.addEventListener("input",updateJobRangeLabels));
  $("jobPayDailyBtn")?.addEventListener("click",()=>setJobPayUnit_("daily"));
  $("jobPayHourlyBtn")?.addEventListener("click",()=>setJobPayUnit_("hourly"));
  $("jobOriginStation")?.addEventListener("input",event=>{
    const value=String(event.target.value||"");
    if(!jobOriginStationSelection ||
       normalizeStationLookup_(value)!==normalizeStationLookup_(jobOriginStationSelection.name)){
      jobOriginStationSelection=null;
      const message=$("jobOriginStationMessage");
      if(message){
        message.textContent="駅名を入力し、都道府県・住所を確認して候補から選択してください。";
        message.classList.remove("selected");
      }
    }
    jobStationSearchApplied=false;
    jobStationCommuteMap={};
    renderStationCandidates_(value);
    updateJobRangeLabels();
  });
  $("jobOriginStation")?.addEventListener("focus",event=>{
    if(String(event.target.value||"").trim())renderStationCandidates_(event.target.value);
  });
  $("jobOriginStation")?.addEventListener("blur",()=>setTimeout(closeStationCandidates_,180));
  $("jobOriginStation")?.addEventListener("keydown",event=>{
    if(event.key==="ArrowDown"){event.preventDefault();moveStationCandidate_(1);return;}
    if(event.key==="ArrowUp"){event.preventDefault();moveStationCandidate_(-1);return;}
    if(event.key==="Escape"){closeStationCandidates_();return;}
    if(event.key==="Enter"){
      event.preventDefault();
      const box=$("jobOriginStationCandidates");
      const candidates=box?box._wcCandidates:[];
      if(box&&!box.hidden&&jobOriginStationActiveIndex>=0&&candidates?.[jobOriginStationActiveIndex]){
        selectOriginStation_(candidates[jobOriginStationActiveIndex]);
      }else{
        runStationAwareJobSearch_();
      }
    }
  });
  $("jobModeLongBtn")?.addEventListener("click",()=>setJobSearchMode_("long"));
  $("jobModeSpotBtn")?.addEventListener("click",()=>setJobSearchMode_("spot"));
  $("jobRegionFilter")?.addEventListener("change",()=>{updateJobPrefectureOptions();renderJobSearchResults();});
  $("jobAreaFilter")?.addEventListener("change",renderJobSearchResults);
  $("jobTravelFilter")?.addEventListener("change",renderJobSearchResults);
  $("jobRemoteFilter")?.addEventListener("change",renderJobSearchResults);
  $("jobSpotDateFrom")?.addEventListener("change",renderJobSearchResults);
  $("jobSpotDateTo")?.addEventListener("change",renderJobSearchResults);
  $("jobSort")?.addEventListener("change",renderJobSearchResults);
  $("showEmployeeRegisterBtn")?.addEventListener("click",()=>{const box=$("employeeRegisterBox");if(box)box.hidden=!box.hidden;});
  $("employeeRegisterBtn")?.addEventListener("click",submitEmployeeRegistration);
  $("showPartnerRegisterBtn")?.addEventListener("click",()=>{const box=$("partnerRegisterBox");if(box)box.hidden=!box.hidden;});
  $("partnerRegisterBtn")?.addEventListener("click",submitPartnerRegistration);
  $("reloadEmployeeRequestsBtn")?.addEventListener("click",async()=>{showWcLoading_("読み込み中…");try{await loadEmployeeRequests()}finally{await hideWcLoading_()}});
  $("reloadUsersBtn")?.addEventListener("click",async()=>{showWcLoading_("読み込み中…");try{await loadUsers()}finally{await hideWcLoading_()}});
  $("reloadPartnerRequestsBtn")?.addEventListener("click",async()=>{showWcLoading_("読み込み中…");try{await loadPartnerRequests()}finally{await hideWcLoading_()}});
  $("reloadSkillRequestsBtn")?.addEventListener("click",async()=>{showWcLoading_("読み込み中…");try{await loadSkillSheetRequests()}finally{await hideWcLoading_()}});
  $("reloadPartnerPortalBtn")?.addEventListener("click",reloadPartnerPortal);
  $("partnerCandidatesTab")?.addEventListener("click",()=>showPartnerTab("candidates"));
  $("partnerRequestsTab")?.addEventListener("click",()=>showPartnerTab("requests"));
  $("partnerSearchInput")?.addEventListener("input",()=>{clearTimeout(partnerSearchTimer);partnerSearchTimer=setTimeout(reloadPartnerPortal,350);});
}


function openAccountMenu_(){
  const menu=$("accountMenu");
  if(!menu||!state.user)return;
  $("menuUserName").textContent=state.user.name||"WonderCraft";
  $("menuUserEmail").textContent=state.user.email||"";
  $("menuUsersBtn").hidden=state.user.role!=="admin";
  menu.hidden=false;
}
function closeAccountMenu_(){const menu=$("accountMenu");if(menu)menu.hidden=true;}

const WC_BOOT_CACHE_KEY="wc_boot_cache_v1";
const WC_BOOT_CACHE_TTL=6*60*60*1000;
function readBootCache(){try{const raw=localStorage.getItem(WC_BOOT_CACHE_KEY);if(!raw)return null;const obj=JSON.parse(raw);if(!obj||!obj.savedAt||Date.now()-obj.savedAt>WC_BOOT_CACHE_TTL)return null;return obj.data||null}catch(e){return null}}
function writeBootCache(data){try{localStorage.setItem(WC_BOOT_CACHE_KEY,JSON.stringify({savedAt:Date.now(),data}))}catch(e){}}
function applyBootstrapData(bootstrap){
  state.user=bootstrap.user||null;applyRoleUi();
  state.runtimeConfig=bootstrap.config||{};
  if(state.user?.role==="partner"){updateUserUi();$("appPanel").hidden=false;hideSystemPanel();showPartnerPortal(bootstrap);return "partner"}
  updateUserUi();const filters=bootstrap.filters||{};state.progressStatuses=filters.progressStatuses||[];
  fillSelect("staffFilter",filters.staff||[],"担当者：全員");fillSelect("regionFilter",filters.regions||[],"地域：すべて");
  renderDashboard(bootstrap.dashboard||{});state.today=bootstrap.today||[];$("appPanel").hidden=false;hideSystemPanel();applyViewState();if(state.view==="home")renderToday(state.today);return "internal";
}

async function initialize(force=false){
  let usedCache=false;
  try{
    hideLogin();
    const api=getApi();
    if(!api||api.includes("ここにGAS"))return showMaintenance("現在システムメンテナンス中です。しばらくしてから再度お試しください。");
    const token=getToken();
    if(!token)return showLogin();

    if(!force){
      const cached=readBootCache();
      if(cached){
        const role=applyBootstrapData(cached);
        usedCache=true;
        if(role==="internal"&&state.user&&["admin","staff"].includes(state.user.role))setTimeout(()=>{if(state.user?.role==="admin"){loadEmployeeRequests();loadUsers();}loadPartnerRequests();loadSkillSheetRequests();},1200);
      }
    }

    if(!usedCache&&$("appPanel").hidden){
      $("systemPanel").hidden=false;$("systemTitle").textContent="接続確認中";$("systemMessage").textContent="システムへ接続しています。";$("systemRetryBtn").hidden=true;
    }

    const bootstrap=await apiGet("bootstrap",{},api,token);
    if(bootstrap?.config?.maintenance)return showMaintenance(bootstrap.config.maintenanceMessage||"現在メンテナンス中です。");
    const role=applyBootstrapData(bootstrap);
    writeBootCache({user:bootstrap.user||null,config:bootstrap.config||{},filters:bootstrap.filters||{},dashboard:bootstrap.dashboard||{},today:bootstrap.today||[]});
    if(state.user&&["admin","staff"].includes(state.user.role))setTimeout(()=>{if(state.user?.role==="admin"){loadEmployeeRequests();loadUsers();}loadPartnerRequests();loadSkillSheetRequests();},1200);
    if(force)setStatus("最新情報を読み込みました。");
    if(role==="internal"&&state.view!=="home")await loadCurrent();
  }catch(error){
    console.error("WonderCraft bootstrap error:", error);

    if(isAuthError(error)){
      clearToken();
      state.user=null;
      updateUserUi();
      return showLogin("ログインの有効期限が切れました。もう一度ログインしてください。");
    }

    /*
     * 起動時bootstrap失敗時に「メンテナンス中」で固定しない。
     * 古い/不整合なセッションが残っている場合は一度ログイン画面へ戻し、
     * 新しいセッションを作り直せるようにする。
     */
    if(!usedCache){
      clearToken();
      state.user=null;
      updateUserUi();

      const detail = error?.message
        ? "（" + error.message + "）"
        : "";

      return showLogin(
        "接続情報を更新しました。もう一度ログインしてください。" + detail
      );
    }

    setStatus("最新情報の同期に失敗しました。前回データを表示しています。");
  }
}

async function handleLogin(event){
  event.preventDefault();
  const email=$("loginEmail").value.trim();
  const password=$("loginPassword").value;
  if(!email||!password)return showLoginMessage("メールアドレスとパスワードを入力してください。",true);
  const button=$("loginBtn");button.disabled=true;button.textContent="ログイン中...";showLoginMessage("",false);
  try{
    const data=await publicPost("login",{email,password,deviceName:getDeviceName()});
    saveToken(data.token);state.user=data.user||null;$("loginPassword").value="";await initialize(true);
  }catch(error){showLoginMessage(error.message||"ログインできませんでした。",true)}finally{button.disabled=false;button.textContent="ログイン"}
}

async function logout(){
  try{if(getToken())await apiPost("logout",{})}catch(_e){}
  clearToken();state.user=null;updateUserUi();$("appPanel").hidden=true;showLogin("ログアウトしました。");
}
function showLogin(message=""){$("systemPanel").hidden=true;$("appPanel").hidden=true;$("loginPanel").hidden=false;if($("logoutBtn"))$("logoutBtn").hidden=true;if($("userMenuBtn"))$("userMenuBtn").hidden=true;if($("currentUserName"))$("currentUserName").hidden=true;if(message)showLoginMessage(message,false);setTimeout(()=>$("loginEmail")?.focus(),50)}
function hideLogin(){$("loginPanel").hidden=true}
function showLoginMessage(message,isError){const el=$("loginMessage");el.textContent=message||"";el.className=`message${message?(isError?" error":" success"):""}`}

function applyRoleUi(){
  const role=state.user?.role||"";
  document.body.dataset.role=role;
  const internal=["admin","staff"].includes(role);
  if($("internalApprovalArea")) $("internalApprovalArea").hidden=!internal;
  if($("managementMenuGroup")) $("managementMenuGroup").hidden=!internal;
  if($("employeeRequestsPanel")) $("employeeRequestsPanel").hidden=role!=="admin";
  if($("userManagementPanel")) $("userManagementPanel").hidden=role!=="admin";
  document.querySelector(".bottom-nav")?.toggleAttribute("hidden", role==="partner");
  if($("partnerPortal")) $("partnerPortal").hidden=role!=="partner";
  if(role==="partner"){
    ["dashboardSection","homeHeader","listHeader","filterSection","cards","status"].forEach(id=>{const el=$(id);if(el)el.hidden=true;});
  }
  // admin / staff は既存の社内画面を利用。partner は専用ポータルへ分岐。
  if(role==="admin"){
    document.title="WonderCraft 管理";
  }else if(role==="staff"){
    document.title="WonderCraft";
  }else if(role==="partner"){
    document.title="WonderCraft Partner Portal";
  }
}

function updateUserUi(){const logged=!!state.user;if($("logoutBtn"))$("logoutBtn").hidden=true;if($("userMenuBtn"))$("userMenuBtn").hidden=!logged;if($("currentUserName")){$("currentUserName").hidden=!logged;$("currentUserName").textContent=logged?`${state.user.name||state.user.email}（${roleLabel(state.user.role)}）`:""}if(logged){if($("menuUserName"))$("menuUserName").textContent=state.user.name||state.user.email;if($("menuUserEmail"))$("menuUserEmail").textContent=state.user.email||"";}}
function roleLabel(role){return role==="admin"?"管理者":role==="staff"?"自社社員":"他企業"}
function isAuthError(error){return ["AUTH_REQUIRED","SESSION_INVALID","SESSION_EXPIRED","USER_DISABLED","ROLE_DENIED"].includes(error.code)}

function getApi(){return String(config.GAS_API_URL||"").trim().replace(/\/+$/,"")}
function getDeviceName(){const platform=navigator.userAgentData?.platform||navigator.platform||"端末";const mobile=/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)?"スマホ":"PC";return `${mobile} / ${platform}`.slice(0,100)}
function getToken(){return localStorage.getItem("wc_session_token")||""}
function saveToken(token){localStorage.setItem("wc_session_token",token)}
function clearToken(){localStorage.removeItem("wc_session_token")}

async function publicPost(action,payload){
  const response=await wcFetchWithTimeout_(getApi(),{method:"POST",redirect:"follow",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({wc_api:true,action,payload})});
  const json=await response.json();if(!json.success){const error=new Error(json.error||"処理に失敗しました。");error.code=json.code||"API_ERROR";throw error}return json.data;
}

function hideSystemPanel(){if($("systemPanel"))$("systemPanel").hidden=true}
function showSystemError(title,message){hideLogin();$("appPanel").hidden=true;$("systemPanel").hidden=false;$("systemTitle").textContent=title||"エラー";$("systemMessage").textContent=message||"システムへ接続できませんでした。";$("systemRetryBtn").hidden=false}
function normalizeUserFacingError(err){
  const code=String(err?.code||"");
  if(["SESSION_INVALID","SESSION_EXPIRED","AUTH_REQUIRED","API_ERROR"].includes(code)){
    return "現在システムメンテナンス中です。";
  }
  return err?.message||"エラーが発生しました。";
}

function showMaintenance(message){hideLogin();$("appPanel").hidden=true;$("systemPanel").hidden=false;$("systemTitle").textContent="メンテナンス中";$("systemMessage").textContent=message||"現在メンテナンス中です。";$("systemRetryBtn").hidden=true}

async function apiGet(action,params={},api=getApi(),token=getToken()){
  const url=new URL(api);url.searchParams.set("api","1");url.searchParams.set("action",action);url.searchParams.set("token",token);
  Object.entries(params).forEach(([key,value])=>{if(value!==undefined&&value!==null&&String(value)!=="")url.searchParams.set(key,value)});
  const response=await wcFetchWithTimeout_(url.toString(),{redirect:"follow",cache:"no-store"});
  const json=await response.json();
  if(!json.success){const error=new Error(json.error||"APIエラー");error.code=json.code||"API_ERROR";throw error}
  return json.data;
}

async function apiPost(action,payload){
  const response=await wcFetchWithTimeout_(getApi(),{method:"POST",redirect:"follow",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({wc_api:true,action,token:getToken(),payload})});
  const json=await response.json();
  if(!json.success){const error=new Error(json.error||"APIエラー");error.code=json.code||"API_ERROR";throw error}
  return json.data;
}

async function loadFilters(){try{const o=await apiGet("filters");state.progressStatuses=o.progressStatuses||[];fillSelect("staffFilter",o.staff||[],"担当者：全員");fillSelect("regionFilter",o.regions||[],"地域：すべて")}catch(e){showError(e)}}
function fillSelect(id,items,first){const el=$(id),old=el.value;el.innerHTML=`<option value="">${first}</option>`;items.forEach(v=>el.insertAdjacentHTML("beforeend",`<option value="${esc(v)}">${esc(v)}</option>`));el.value=old}
async function loadDashboard(){try{renderDashboard(await apiGet("dashboard"))}catch(e){showError(e)}}
function renderDashboard(d){$("countCandidates").textContent=d.candidates??"-";$("countProgress").textContent=d.progress??"-";$("countToday").textContent=d.todayInterviews??"-";$("countWaiting").textContent=d.waitingCandidates??"-"}

function switchView(view){
  if(!["home","candidates","progress","jobsearch","matching","management"].includes(view))view="home";
  state.view=view;
  applyViewState();
  loadCurrent();
}

function applyViewState(){
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));
  const isHome=state.view==="home", isMatching=state.view==="matching", isJobSearch=state.view==="jobsearch", isManagement=state.view==="management";
  $("homeVisualSection").hidden=!isHome; $("dashboardSection").hidden=!isHome; $("homeHeader").hidden=!isHome; $("matchingSection").hidden=!isMatching;
  $("jobSearchSection").hidden=!isJobSearch; $("managementSection").hidden=!isManagement;
  $("listHeader").hidden=isHome||isMatching||isJobSearch||isManagement;
  $("filterSection").hidden=isHome||isMatching||isJobSearch||isManagement;
  $("cards").hidden=isMatching||isJobSearch||isManagement;
  if(state.view==="candidates"){$("viewTitle").textContent="求職者";$("viewDescription").textContent="求職者を検索・編集できます。";$("searchInput").placeholder="名前・駅・会社・進捗を検索";$("regionFilter").disabled=false;$("experienceFilter").hidden=false;$("careerFilter").hidden=false;}
  else if(state.view==="progress"){$("viewTitle").textContent="案件進捗";$("viewDescription").textContent="案件状況を検索・編集できます。";$("searchInput").placeholder="氏名・会社・案件進捗を検索";$("regionFilter").disabled=true;$("experienceFilter").hidden=true;$("careerFilter").hidden=true;}
  if(isManagement){const admin=state.user?.role==="admin";$("employeeRequestsPanel").hidden=!admin;$("userManagementPanel").hidden=!admin;$("partnerRequestsPanel").hidden=false;$("skillRequestsPanel").hidden=false;$("managementDescription").textContent=admin?"社員登録・ユーザー・パートナー企業・スキルシート申請を管理できます。":"パートナー企業とスキルシートの申請を承認できます。";}
}

async function loadCurrent(){
  if($("appPanel").hidden) return;

  const requestId = ++loadRequestId;
  const p = {
    q: $("searchInput").value,
    staff: $("staffFilter").value
  };

  if(state.view==="jobsearch"){
    await loadJobSearchOnce();
    return;
  }
  if(state.view==="management"){
    showWcLoading_("読み込み中…");
    try{const tasks=[loadPartnerRequests(),loadSkillSheetRequests()];if(state.user?.role==="admin")tasks.push(loadEmployeeRequests(),loadUsers());await Promise.all(tasks);}finally{await hideWcLoading_();}
    return;
  }

  if(state.view==="matching"){
    showWcLoading_("読み込み中…");
    try{
      setStatus("");
      $("cards").innerHTML="";
      await loadMatchingCandidatesOnce();
    }finally{
      await hideWcLoading_();
    }
    return;
  }

  if(state.view==="home"){
    showWcLoading_("読み込み中…");
    try{
      const items=await apiGet("today");
      if(requestId!==loadRequestId) return;
      state.today=items;
      renderToday(items);
    }finally{
      await hideWcLoading_();
    }
    return;
  }

  if(state.view==="candidates"){
    p.region=$("regionFilter").value;
    p.experienceType=$("experienceFilter").value;
    p.careerType=$("careerFilter").value;
  }

  const cacheView = state.view==="candidates" ? "candidates" : "progress";
  const cached = wcViewCacheGet_(cacheView,p);

  if(cached){
    if(cacheView==="candidates"){
      state.candidates=cached;
      renderCandidates(cached);
    }else{
      state.progress=cached;
      renderProgress(cached);
    }
    return;
  }

  showWcLoading_("読み込み中…");
  try{
    const items = cacheView==="candidates"
      ? await apiGet("candidates",p)
      : await apiGet("progress",p);

    if(requestId!==loadRequestId) return;

    wcViewCachePut_(cacheView,p,items);

    if(cacheView==="candidates"){
      state.candidates=items;
      renderCandidates(items);
    }else{
      state.progress=items;
      renderProgress(items);
    }
  }catch(e){
    if(requestId===loadRequestId) showError(e);
  }finally{
    await hideWcLoading_();
  }
}

function renderCandidates(items){
  setStatus(`${items.length}件`);if(!items.length)return showEmpty();
  $("cards").innerHTML=items.map((x,i)=>`<article class="card clickable" onclick="openCandidate(${i})"><h3>${esc(x.name)}</h3><span class="badge">${esc(x.region)}</span><span class="badge">${esc(x.progress||"進捗未設定")}</span><div class="details">${rows([["担当者",x.staff],["最寄駅",`${x.station||""}${x.prefecture?`（${x.prefecture}）`:""}`],["提案元会社",x.company],["希望単価",x.price],["キャリア",x.career],["経験値",x.experience],["開始希望",x.startDate],["更新日",x.updateDate]])}</div>${x.remarks?`<div class="remarks">${esc(x.remarks)}</div>`:""}<div class="hint">タップして編集</div></article>`).join("");
}

function renderProgress(items){
  setStatus(`${items.length}件`);if(!items.length)return showEmpty();
  $("cards").innerHTML=items.map((x,i)=>`<article class="card clickable" onclick="openProgress(${i})"><h3>${esc(x.name||"名前未入力")}</h3><span class="badge">${esc(x.status||"進捗未設定")}</span><div class="details">${rows([["人員担当者",x.staff],["所属会社",x.company],["案件担当者",x.projectStaff],["上位会社",x.upperCompany],["エリア",x.area],["エントリー月",x.entryMonth]])}</div>${x.remarks?`<div class="remarks">${esc(x.remarks)}</div>`:""}<div class="hint">タップして編集</div></article>`).join("");
}

function renderHomeTodayPreview_(items){
  const box=$("homeTodayPreview");if(!box)return;
  const list=(items||[]).slice(0,2);
  if(!list.length){box.innerHTML='<p class="muted-preview">本日の面談予定はありません。</p>';return;}
  box.innerHTML=list.map(x=>`<div class="home-today-row"><time>${esc(x.time||x.interviewTime||"時間未定")}</time><div><strong>${esc(x.name||x.candidateName||"面談")}</strong><small>${esc(x.company||x.projectCompany||x.shopName||"")}</small></div></div>`).join('');
}

function renderToday(items){renderHomeTodayPreview_(items);
  const sorted=[...(items||[])].sort((a,b)=>String(a.interviewTime||"99:99").localeCompare(String(b.interviewTime||"99:99"),"ja"));
  setStatus(`${sorted.length}件`);
  if(!sorted.length)return showEmpty("本日の面談はありません。");

  $("cards").innerHTML=sorted.map(x=>{
    const time=normalizeInterviewTime(x.interviewTime||x.interviewDate);
    return `<article class="card interview-card">
      <div class="interview-time"><strong>${esc(time||"時間未定")}</strong><span>面談</span></div>
      <div class="interview-body">
        <h3>${esc(x.name||"名前未入力")}</h3>
        <span class="badge">${esc(x.status||"進捗未設定")}</span>
        <div class="details interview-details">${rows([
          ["人員担当者",x.staff],
          ["案件担当者",x.projectStaff],
          ["所属会社",x.company],
          ["上位会社",x.upperCompany],
          ["案件進捗",x.status]
        ])}</div>
      </div>
    </article>`;
  }).join("");
}

function normalizeInterviewTime(value){
  const text=String(value||"").normalize("NFKC");
  const match=text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
  if(match)return `${String(match[1]).padStart(2,"0")}:${match[2]}`;
  const jp=text.match(/([01]?\d|2[0-3])時(?:\s*([0-5]?\d)分?)?/);
  if(jp)return `${String(jp[1]).padStart(2,"0")}:${String(jp[2]||"00").padStart(2,"0")}`;
  return text.trim();
}

function rows(arr){return arr.map(([a,b])=>`<div class="label">${esc(a)}</div><div>${esc(b||"")}</div>`).join("")}
function openCandidate(i){state.selected={type:"candidate",item:state.candidates[i]};$("modalTitle").textContent="求職者を編集";buildCandidateForm(state.selected.item);updateSkillSheetButton();openModal()}
function openProgress(i){state.selected={type:"progress",item:state.progress[i]};$("modalTitle").textContent="案件進捗を編集";$("openSkillSheetBtn").hidden=true;buildProgressForm(state.selected.item);openModal()}

function field(id,label,value,type="text",options=null,full=false){
  const cls=full?' class="full"':"";
  if(options)return `<label${cls}>${label}<select id="${id}">${options.map(v=>`<option value="${esc(v)}"${v===value?" selected":""}>${esc(v)}</option>`).join("")}</select></label>`;
  if(type==="textarea")return `<label${cls}>${label}<textarea id="${id}">${esc(value||"")}</textarea></label>`;
  return `<label${cls}>${label}<input id="${id}" type="${type}" value="${esc(value||"")}"></label>`;
}

function careerChecks(value){
  const selected=normalizeCareerSelections(value);
  const options=[["docomo","ドコモ"],["sb","SB"],["au","au"],["rakuten","楽天"]];
  return `<fieldset class="full check-group"><legend>経験キャリア（複数選択可）</legend><div>${options.map(([key,label])=>`<label><input type="checkbox" name="careerExperience" value="${key}"${selected.includes(key)?" checked":""}>${label}</label>`).join("")}</div></fieldset>`;
}
function normalizeCareerSelections(value){
  const text=String(value||"").normalize("NFKC").toLowerCase();
  const out=[];
  if(/docomo|ドコモ|d経験/.test(text))out.push("docomo");
  if(/softbank|ソフトバンク|sb|s経験|ym|y!mobile|ymobile|ワイモバ|yモバ/.test(text))out.push("sb");
  if(/(?:^|[^a-z])au(?:[^a-z]|$)|uq|uｑ|au経験/.test(text))out.push("au");
  if(/rakuten|楽天|r経験/.test(text))out.push("rakuten");
  return [...new Set(out)];
}
function selectedCareerValue(){
  const labels={docomo:"ドコモ",sb:"SB",au:"au",rakuten:"楽天"};
  return [...document.querySelectorAll('input[name="careerExperience"]:checked')].map(el=>labels[el.value]).filter(Boolean).join(",");
}

function buildCandidateForm(x){
  $("formFields").innerHTML=
    field("fStaff","担当者",x.staff,"text",["","山本","白木","吉本","荒井","森田","長崎","上澤","山田"])+
    field("fName","名前",x.name)+field("fPref","都道府県",x.prefecture)+field("fStation","最寄駅",x.station)+
    field("fCompany","提案元会社",x.company)+field("fPrice","希望単価",x.price)+
    careerChecks(x.career)+
    field("fExp","経験値",x.experience,"text",["","通信経験者","通信未経験","通信微経験","コール経験者","コール未経験"])+
    field("fStart","開始希望",x.startDate)+field("fProg","進捗",x.progress,"text",progressStatusOptions(x.progress))+
    field("fMove","移動型可否",x.moveType,"text",["","○","×","距離次第"])+
    field("fSkillSheetUrl","スキルシートURL",x.skillSheetUrl||"","url",null,true)+
    field("fRemarks","備考",x.remarks,"textarea",null,true);
  $("fSkillSheetUrl")?.addEventListener("input",updateSkillSheetButton);
}

function progressStatusOptions(current){
  const values=["","案件待ち","案件提案中","面談待ち","合否待ち","完了","取り下げ","他社面談予定"];
  if(current&&!values.includes(current))values.push(current);
  return [...new Set(values)];
}

function buildProgressForm(x){
  $("formFields").innerHTML=field("fEntry","エントリー月",x.entryMonth)+
    field("fStaff","人員担当者",x.staff,"text",["","山本","白木","吉本","荒井","森田","長崎","上澤","山田"])+
    field("fCompany","所属会社",x.company)+field("fName","名前",x.name)+
    field("fProjectStaff","案件担当者",x.projectStaff,"text",["","山本","白木","吉本","荒井","森田","長崎","上澤","山田"])+
    field("fUpper","上位会社",x.upperCompany)+field("fStatus","案件進捗",x.status,"text",progressStatusOptions(x.status))+field("fArea","エリア",x.area)+field("fRemarks","備考",x.remarks,"textarea",null,true);
}

async function saveEdit(e){
  wcViewCacheClear_();
  e.preventDefault();setMsg("modalMessage","保存中...");showWcLoading_("保存中…");
  try{
    if(state.selected.type==="candidate"){
      const x=state.selected.item;
      await apiPost("updateCandidate",{sheetName:x.sheetName,rowNumber:x.rowNumber,originalName:x.name,staff:v("fStaff"),name:v("fName"),prefecture:v("fPref"),station:v("fStation"),company:v("fCompany"),price:v("fPrice"),career:selectedCareerValue(),experience:v("fExp"),startDate:v("fStart"),progress:v("fProg"),moveType:v("fMove"),skillSheetUrl:v("fSkillSheetUrl"),remarks:v("fRemarks")});
    }else{
      const x=state.selected.item;
      await apiPost("updateProgress",{rowNumber:x.rowNumber,originalName:x.name,entryMonth:v("fEntry"),staff:v("fStaff"),company:v("fCompany"),name:v("fName"),projectStaff:v("fProjectStaff"),upperCompany:v("fUpper"),status:v("fStatus"),area:v("fArea"),remarks:v("fRemarks")});
    }
    // 保存成功後は編集画面に留まらず、すぐ元の一覧へ戻して最新データを再読込する。
    closeModal();
    await Promise.allSettled([loadDashboard(), loadCurrent()]);
    setStatus("保存しました。");
  }catch(err){setMsg("modalMessage",err.message,"error")}finally{await hideWcLoading_();}
}

function updateSkillSheetButton(){const btn=$("openSkillSheetBtn");if(!btn)return;btn.hidden=!isSafeSkillSheetUrl(v("fSkillSheetUrl"))}
function isSafeSkillSheetUrl(value){try{const url=new URL(String(value||"").trim());return url.protocol==="https:"&&(url.hostname==="drive.google.com"||url.hostname==="docs.google.com")}catch(_){return false}}
function openSkillSheet(){const url=v("fSkillSheetUrl");if(!isSafeSkillSheetUrl(url)){setMsg("modalMessage","Google DriveまたはGoogleドキュメントのURLを入力してください。","error");return}window.open(url,"_blank","noopener,noreferrer")}
function v(id){return $(id)?.value||""}
function openModal(){$("modal").hidden=false;document.body.style.overflow="hidden";setMsg("modalMessage","")}
function closeModal(){$("modal").hidden=true;document.body.style.overflow=""}
function showLoading(){setStatus("");$("cards").innerHTML='<div class="loading">読み込み中です...</div>'}
function showEmpty(t="該当するデータはありません。"){$("cards").innerHTML=`<div class="empty">${esc(t)}</div>`}
function showError(e){$("cards").innerHTML=`<div class="error">${esc(e.message||String(e))}</div>`}
function setStatus(t){const el=$("status");if(el)el.textContent=t||""}
function showToast(message,type=""){
  const text=String(message||"");
  const status=$("status");
  if(status){
    status.textContent=text;
    status.className=type==="error"?"error":"";
  }
  const summary=$("matchingSummary");
  if(state.view==="matching"&&summary&&text){
    summary.textContent=text;
    summary.className="matching-summary"+(type==="error"?" error":"");
  }
  if(text){
    clearTimeout(showToast._timer);
    showToast._timer=setTimeout(()=>{
      if(status&&status.textContent===text){status.textContent="";status.className="";}
      if(summary&&summary.textContent===text){summary.textContent="";summary.className="matching-summary";}
    },4500);
  }
}
function setMsg(id,t,type=""){$(id).textContent=t||"";$(id).className="message"+(type?" "+type:"")}
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

async function submitEmployeeRegistration(){
  const name=$("employeeRegName")?.value.trim()||"",email=$("employeeRegEmail")?.value.trim()||"",password=$("employeeRegPassword")?.value||"",btn=$("employeeRegisterBtn"),message=$("employeeRegisterMessage");
  if(!name||!email||password.length<8){message.textContent="氏名・メールアドレス・8文字以上のパスワードを入力してください。";message.className="message error";return;}
  btn.disabled=true;btn.textContent="申請中…";message.textContent="";
  try{const result=await publicPost("employeeRegister",{name,email,password});message.textContent=result?.message||"社員登録申請を受け付けました。";message.className="message success";$("employeeRegPassword").value="";}
  catch(err){message.textContent=err?.message||"登録申請に失敗しました。";message.className="message error";}
  finally{btn.disabled=false;btn.textContent="社員登録を申請";}
}

async function submitPartnerRegistration(){
  const company=document.getElementById("regCompany")?.value.trim()||"";
  const person=document.getElementById("regPerson")?.value.trim()||"";
  const email=document.getElementById("regEmail")?.value.trim()||"";
  const password=document.getElementById("regPassword")?.value||"";
  const box=document.getElementById("partnerRegisterMessage");
  if(box) box.textContent="";
  try{
    const res=await publicPost("partnerRegister",{company,person,email,password});
    if(box){box.textContent=res?.message||"登録申請を受け付けました。";box.className="auth-message success";}
    ["regCompany","regPerson","regEmail","regPassword"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
  }catch(err){
    if(box){box.textContent=err?.message||"申請に失敗しました。";box.className="auth-message error";}
  }
}

async function loadPartnerRequests(){
  setRequestPanelVisible_("partnerRequestsList", false);
  if(!state.user || !["admin","staff"].includes(state.user.role)) return;
  const panel=document.getElementById("partnerApprovalPanel");
  const list=document.getElementById("partnerRequestsList");
  if(panel) panel.hidden=false;
  if(!list) return;
  list.innerHTML='<div class="empty">読み込み中...</div>';
  try{
    const rows=await apiPost("partnerRequests",{});
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="empty">登録申請はありません。</div>';
      setRequestPanelVisible_("partnerRequestsList", false);
      return;
    }
    setRequestPanelVisible_("partnerRequestsList", true);
    list.innerHTML=rows.map(r=>`
      <div class="partner-request-card">
        <div class="partner-request-main">
          <strong>${escapeHtml(r.company||"")}</strong>
          <div>${escapeHtml(r.person||"")} / ${escapeHtml(r.email||"")}</div>
          <small>${escapeHtml(r.status||"")} ${escapeHtml(r.requestedAt||"")}</small>
        </div>
        ${r.status==="申請中"?`
        <div class="partner-request-actions">
          <button class="btn primary" onclick="approvePartnerRequest('${r.requestId}')">承認</button>
          <button class="btn danger" onclick="rejectPartnerRequest('${r.requestId}')">却下</button>
        </div>`:""}
      </div>`).join("");
  }catch(err){
    setRequestPanelVisible_("partnerRequestsList", false);
    list.innerHTML='<div class="empty">申請一覧を取得できませんでした。</div>';
  }
}

async function approvePartnerRequest(requestId){
  if(!confirm("この企業アカウントを承認しますか？")) return;
  try{
    await apiPost("approvePartner",{requestId});
    await loadPartnerRequests();
    showToast("承認しました。");
  }catch(err){showToast(err?.message||"承認に失敗しました。","error");}
}

async function rejectPartnerRequest(requestId){
  const reason=prompt("却下理由（任意）","")??null;
  if(reason===null) return;
  try{
    await apiPost("rejectPartner",{requestId,reason});
    await loadPartnerRequests();
    showToast("却下しました。");
  }catch(err){showToast(err?.message||"却下に失敗しました。","error");}
}

document.addEventListener("DOMContentLoaded",()=>{
  const showBtn=document.getElementById("showPartnerRegisterBtn");
  const box=document.getElementById("partnerRegisterBox");
  if(showBtn&&box) showBtn.addEventListener("click",()=>{box.hidden=!box.hidden;});
  document.getElementById("partnerRegisterBtn")?.addEventListener("click",submitPartnerRegistration);
  document.getElementById("reloadPartnerRequestsBtn")?.addEventListener("click",loadPartnerRequests);
});


let partnerSearchTimer=null;

function showPartnerPortal(bootstrap){
  const portal=$("partnerPortal");
  if(portal) portal.hidden=false;
  state.partnerCandidates=bootstrap?.partnerCandidates||[];
  state.mySkillRequests=bootstrap?.mySkillRequests||[];
  renderPartnerCandidates(state.partnerCandidates);
  renderMySkillRequests(state.mySkillRequests);
}

async function reloadPartnerPortal(){
  try{
    const [candidates,requests]=await Promise.all([
      apiGet("partnerCandidates",{q:$("partnerSearchInput")?.value||""}),
      apiGet("mySkillRequests")
    ]);
    state.partnerCandidates=candidates||[];
    state.mySkillRequests=requests||[];
    renderPartnerCandidates(state.partnerCandidates);
    renderMySkillRequests(state.mySkillRequests);
  }catch(err){showToast(err?.message||"読み込みに失敗しました。","error");}
}

function skillRequestStatusFor(candidateKey){
  const list=state.mySkillRequests||[];
  return list.find(x=>x.candidateKey===candidateKey && ["申請中","承認済み"].includes(x.status))||null;
}

function renderPartnerCandidates(items){
  const box=$("partnerCandidatesList"); if(!box)return;
  if(!Array.isArray(items)||!items.length){box.innerHTML='<div class="empty">該当する求職者はいません。</div>';return;}
  box.innerHTML=items.map((x,i)=>{
    const req=skillRequestStatusFor(x.candidateKey);
    let action='';
    if(req?.status==="承認済み" && req.skillSheetUrl){
      action=`<button class="primary" onclick="openApprovedSkillSheet('${esc(req.requestId)}','${esc(req.skillSheetUrl)}')">スキルシートを見る</button>`;
    }else if(req?.status==="申請中"){
      action=`<button class="secondary" disabled>申請中</button>`;
    }else{
      action=`<button class="primary" onclick="requestCandidateSkillSheet(${i})">スキルシートを申請</button>`;
    }
    return `<article class="card partner-candidate-card">
      <div class="card-head"><div><h3>${esc(x.name||"名前未入力")}</h3><span class="badge">${esc(x.region||"")}</span></div></div>
      <div class="details">${rows([
        ["都道府県",x.prefecture],["最寄駅",x.station],["経験",x.experience],
        ["経験キャリア",x.career],["開始希望",x.startDate]
      ])}</div>
      <div class="partner-card-actions">${action}</div>
    </article>`;
  }).join("");
}

async function requestCandidateSkillSheet(index){
  const x=(state.partnerCandidates||[])[index]; if(!x)return;
  if(!confirm(`${x.name}さんのスキルシートを申請しますか？`))return;
  try{
    const res=await apiPost("requestSkillSheet",{sheetName:x.sheetName,rowNumber:x.rowNumber});
    showToast(res?.message||"申請しました。");
    await reloadPartnerPortal();
  }catch(err){showToast(err?.message||"申請に失敗しました。","error");}
}

function renderMySkillRequests(items){
  const box=$("mySkillRequestsList"); if(!box)return;
  if(!Array.isArray(items)||!items.length){box.innerHTML='<div class="empty">申請履歴はありません。</div>';return;}
  box.innerHTML=items.map(x=>{
    const open=x.status==="承認済み"&&x.skillSheetUrl
      ? `<button class="primary" onclick="openApprovedSkillSheet('${esc(x.requestId)}','${esc(x.skillSheetUrl)}')">スキルシートを見る</button>`:"";
    return `<article class="card">
      <h3>${esc(x.candidateName||"")}</h3>
      <div class="details">${rows([["状態",x.status],["申請日時",x.requestedAt],["承認日時",x.approvedAt],["却下理由",x.rejectReason]])}</div>
      <div class="partner-card-actions">${open}</div>
    </article>`;
  }).join("");
}

async function openApprovedSkillSheet(requestId,url){
  if(!url)return;
  try{await apiPost("markSkillSheetViewed",{requestId});}catch(_e){}
  window.open(url,"_blank","noopener");
}

function showPartnerTab(tab){
  const candidates=tab==="candidates";
  $("partnerCandidatesView").hidden=!candidates;
  $("partnerRequestsView").hidden=candidates;
  $("partnerCandidatesTab").classList.toggle("active",candidates);
  $("partnerRequestsTab").classList.toggle("active",!candidates);
}


async function loadEmployeeRequests(){if(!state.user||state.user.role!=="admin")return;const panel=$("employeeRequestsPanel"),list=$("employeeRequestsList");if(!panel||!list)return;panel.hidden=true;try{const rows=await apiPost("employeeRequests",{}),pending=(rows||[]).filter(r=>r.status==="申請中");if(!pending.length){list.innerHTML="";return;}panel.hidden=false;list.innerHTML=pending.map(r=>`<div class="partner-request-card"><div class="partner-request-main"><strong>${esc(r.name||"")}</strong><div>${esc(r.email||"")}</div><small>申請日時：${esc(r.requestedAt||"")}</small></div><div class="partner-request-actions"><button class="primary" onclick="approveEmployeeRequest('${esc(r.requestId)}')">承認</button><button class="secondary" onclick="rejectEmployeeRequest('${esc(r.requestId)}')">却下</button></div></div>`).join("");}catch(err){panel.hidden=true;}}
async function approveEmployeeRequest(requestId){if(!confirm("この社員登録を承認しますか？"))return;try{await apiPost("approveEmployee",{requestId});showToast("社員登録を承認しました。");await Promise.all([loadEmployeeRequests(),loadUsers()]);}catch(err){showToast(err?.message||"承認に失敗しました。","error");}}
async function rejectEmployeeRequest(requestId){const reason=prompt("却下理由（任意）","");if(reason===null)return;try{await apiPost("rejectEmployee",{requestId,reason});showToast("社員登録申請を却下しました。");await loadEmployeeRequests();}catch(err){showToast(err?.message||"却下に失敗しました。","error");}}
async function loadUsers(){if(!state.user||state.user.role!=="admin")return;const panel=$("userManagementPanel"),list=$("usersList");if(!panel||!list)return;try{const rows=await apiPost("users",{});panel.hidden=false;list.innerHTML=(rows||[]).map(u=>{const isCurrent=u.userId===state.user.userId;const action=u.status==="有効"?`<button class="secondary" ${isCurrent?"disabled":""} onclick="changeUserStatus('${esc(u.userId)}','利用停止')">利用停止</button>`:`<button class="primary" onclick="changeUserStatus('${esc(u.userId)}','有効')">利用再開</button>`;return `<div class="partner-request-card"><div class="partner-request-main"><strong>${esc(u.name||u.email||"")}</strong><div>${esc(u.email||"")} / ${esc(roleLabel(u.role))}</div><small>状態：${esc(u.status||"")}　最終ログイン：${esc(u.lastLoginAt||"-")}</small></div><div class="partner-request-actions">${action}</div></div>`;}).join("");}catch(err){panel.hidden=true;}}
async function changeUserStatus(userId,status){const label=status==="有効"?"利用を再開":"利用停止";if(!confirm(`${label}しますか？`))return;try{await apiPost("setUserStatus",{userId,status});showToast(status==="有効"?"利用を再開しました。":"利用停止にしました。");await loadUsers();}catch(err){showToast(err?.message||"更新に失敗しました。","error");}}

function setRequestPanelVisible_(listId, visible){
  const panelId =
    listId === "partnerRequestsList"
      ? "partnerRequestsPanel"
      : listId === "skillRequestsList"
        ? "skillRequestsPanel"
        : "";

  const panel =
    panelId
      ? document.getElementById(panelId)
      : null;

  if(!panel) return;

  panel.hidden = !visible;
  panel.style.display = visible ? "" : "none";
}

async function loadSkillSheetRequests(){
  setRequestPanelVisible_("skillRequestsList", false);
  if(!state.user||!["admin","staff"].includes(state.user.role))return;
  const list=$("skillRequestsList"); if(!list)return;
  list.innerHTML='<div class="empty">読み込み中...</div>';
  try{
    const rows=await apiPost("skillSheetRequests",{});
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="empty">スキルシート申請はありません。</div>';
      setRequestPanelVisible_("skillRequestsList", false);
      return;
    }
    setRequestPanelVisible_("skillRequestsList", true);
    list.innerHTML=rows.map(r=>`<div class="partner-request-card">
      <div class="partner-request-main">
        <strong>${esc(r.candidateName||"")}</strong>
        <div>${esc(r.company||"")} / ${esc(r.person||"")} / ${esc(r.email||"")}</div>
        <small>${esc(r.status||"")} ${esc(r.requestedAt||"")}</small>
      </div>
      ${r.status==="申請中"?`<div class="partner-request-actions">
        <button class="primary" onclick="approveSkillRequest('${esc(r.requestId)}')">承認</button>
        <button class="secondary" onclick="rejectSkillRequest('${esc(r.requestId)}')">却下</button>
      </div>`:(r.status==="承認済み"&&r.skillSheetUrl?`<a class="secondary link-button" href="${esc(r.skillSheetUrl)}" target="_blank" rel="noopener">確認</a>`:"")}
    </div>`).join("");
  }catch(err){
    setRequestPanelVisible_("skillRequestsList", false);
    list.innerHTML='<div class="empty">申請一覧を取得できませんでした。</div>';
  }
}

async function approveSkillRequest(requestId){
  if(!confirm("このスキルシート申請を承認しますか？"))return;
  try{await apiPost("approveSkillSheetRequest",{requestId});showToast("承認しました。");await loadSkillSheetRequests();}
  catch(err){showToast(err?.message||"承認に失敗しました。","error");}
}
async function rejectSkillRequest(requestId){
  const reason=prompt("却下理由（任意）",""); if(reason===null)return;
  try{await apiPost("rejectSkillSheetRequest",{requestId,reason});showToast("却下しました。");await loadSkillSheetRequests();}
  catch(err){showToast(err?.message||"却下に失敗しました。","error");}
}



let jobSearchLoaded=false;
let jobSearchItems=[];
function normalizeJobText(v){return String(v||"").normalize("NFKC").toLowerCase();}
function extractJobDailyPay(v){
  const text=String(v||"").normalize("NFKC").replace(/,/g,"");
  const nums=(text.match(/\d{3,7}/g)||[]).map(Number);
  if(!nums.length)return 0;
  let n=Math.max(...nums);
  if(/時給|\/h|hour/i.test(text)||n<=5000)return Math.round(n*8);
  if(/月給|月額|万円/.test(text)||n>=100000)return Math.round(n/20);
  return n;
}
function extractJobHourlyPay(v){
  const daily=extractJobDailyPay(v);
  return daily?Math.round(daily/8/10)*10:0;
}
function extractJobPay(v){
  return jobPayUnit==="hourly"?extractJobHourlyPay(v):extractJobDailyPay(v);
}
function formatJobConvertedPay_(v){
  const amount=extractJobPay(v);
  if(!amount)return "";
  return jobPayUnit==="hourly"
    ? `時給換算 約${amount.toLocaleString()}円`
    : `日当換算 約${amount.toLocaleString()}円`;
}
function setJobPayUnit_(unit){
  jobPayUnit=unit==="hourly"?"hourly":"daily";
  $("jobPayDailyBtn")?.classList.toggle("active",jobPayUnit==="daily");
  $("jobPayHourlyBtn")?.classList.toggle("active",jobPayUnit==="hourly");

  const minEl=$("jobPayMin");
  const maxEl=$("jobPayMax");
  if(!minEl||!maxEl)return;

  if(jobPayUnit==="hourly"){
    minEl.min="1000"; minEl.max="5000"; minEl.step="100";
    maxEl.min="1000"; maxEl.max="5000"; maxEl.step="100";
    minEl.value="1000"; maxEl.value="5000";
  }else{
    minEl.min="10000"; minEl.max="50000"; minEl.step="1000";
    maxEl.min="10000"; maxEl.max="50000"; maxEl.step="1000";
    minEl.value="10000"; maxEl.value="50000";
  }

  updateJobRangeLabels();
  renderJobSearchResults();
}
function inferCareer(x){const t=normalizeJobText([x.shopName,x.originalText,x.sourceCompany].join(" "));if(/docomo|ドコモ/.test(t))return "docomo";if(/softbank|ソフトバンク|\bsb\b/.test(t))return "SB";if(/\bau\b|エーユー/.test(t))return "au";if(/楽天|rakuten/.test(t))return "楽天";return "その他";}
async function loadJobSearchOnce(){if(jobSearchLoaded){renderJobSearchResults();return;}showWcLoading_("案件を読み込み中…");try{jobSearchItems=await apiGet("matchingJobs")||[];jobSearchLoaded=true;fillJobSearchFilters();updateJobRangeLabels();renderJobSearchResults();}catch(e){$("jobSearchResults").innerHTML=`<div class="error">${esc(e.message||"案件を取得できませんでした。")}</div>`;}finally{await hideWcLoading_();}}
const WC_JOB_REGION_MAP={"北海道": ["北海道"], "東北": ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"], "関東": ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"], "甲信越": ["新潟県", "山梨県", "長野県"], "北陸": ["富山県", "石川県", "福井県"], "東海": ["岐阜県", "静岡県", "愛知県", "三重県"], "関西": ["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"], "中国": ["鳥取県", "島根県", "岡山県", "広島県", "山口県"], "四国": ["徳島県", "香川県", "愛媛県", "高知県"], "九州": ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"], "沖縄": ["沖縄県"]};

function updateJobPrefectureOptions(){
  const region=$("jobRegionFilter")?.value||"";
  const select=$("jobAreaFilter");
  if(!select)return;

  if(!region){
    select.innerHTML='<option value="">エリアを選択してください</option>';
    select.disabled=true;
    return;
  }

  const prefectures=WC_JOB_REGION_MAP[region]||[];
  select.disabled=false;
  select.innerHTML=
    `<option value="${region}">${region}全域</option>`+
    prefectures.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
}

function normalizeStationLookup_(value){
  return String(value||"").normalize("NFKC").toLowerCase()
    .replace(/\s+/g,"").replace(/駅$/,"");
}
function getStationMaster_(){
  return Array.isArray(window.WC_STATIONS)?window.WC_STATIONS:[];
}
function findStationCandidates_(query){
  const q=normalizeStationLookup_(query);
  if(!q)return [];
  const exact=[],starts=[],includes=[];
  for(const station of getStationMaster_()){
    const name=normalizeStationLookup_(station.n);
    const address=normalizeStationLookup_(station.a);
    const prefecture=normalizeStationLookup_(station.p);
    if(name===q)exact.push(station);
    else if(name.startsWith(q))starts.push(station);
    else if(name.includes(q)||address.includes(q)||prefecture.includes(q))includes.push(station);
  }
  const out=[],seen=new Set();
  for(const station of [...exact,...starts,...includes]){
    const key=`${station.i}:${station.n}:${station.p}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push(station);
    if(out.length>=12)break;
  }
  return out;
}
function closeStationCandidates_(){
  const box=$("jobOriginStationCandidates");
  if(box)box.hidden=true;
  jobOriginStationActiveIndex=-1;
}
function selectOriginStation_(station){
  if(!station)return;
  jobOriginStationSelection={
    id:String(station.i||""),
    stationCodes:Array.isArray(station.c)?station.c:[],
    name:String(station.n||""),
    prefecture:String(station.p||""),
    address:String(station.a||""),
    longitude:Number(station.x),
    latitude:Number(station.y),
    lineCodes:Array.isArray(station.l)?station.l:[]
  };
  const input=$("jobOriginStation");
  if(input)input.value=`${jobOriginStationSelection.name}駅`;
  const message=$("jobOriginStationMessage");
  if(message){
    message.textContent=`選択中：${jobOriginStationSelection.name}駅（${jobOriginStationSelection.prefecture}） ${jobOriginStationSelection.address}`;
    message.classList.add("selected");
  }
  jobStationSearchApplied=false;
  jobStationCommuteMap={};
  closeStationCandidates_();
  updateJobRangeLabels();
}
function renderStationCandidates_(query){
  const box=$("jobOriginStationCandidates");
  if(!box)return;
  const candidates=findStationCandidates_(query);
  jobOriginStationActiveIndex=-1;
  box._wcCandidates=candidates;
  if(!candidates.length){
    box.innerHTML='<div class="station-candidate-empty">該当する駅がありません</div>';
    box.hidden=false;
    return;
  }
  box.innerHTML=candidates.map((station,index)=>`
    <button type="button" class="station-candidate" role="option" data-station-index="${index}">
      <span class="station-candidate-main">${esc(station.n)}駅</span>
      <span class="station-candidate-pref">${esc(station.p||"都道府県不明")}</span>
      <span class="station-candidate-address">${esc(station.a||"住所不明")}</span>
    </button>`).join("");
  box.hidden=false;
  box.querySelectorAll("[data-station-index]").forEach(button=>{
    button.addEventListener("mousedown",event=>event.preventDefault());
    button.addEventListener("click",()=>selectOriginStation_(candidates[Number(button.dataset.stationIndex)]));
  });
}
function moveStationCandidate_(direction){
  const box=$("jobOriginStationCandidates");
  if(!box||box.hidden)return false;
  const buttons=[...box.querySelectorAll(".station-candidate")];
  if(!buttons.length)return false;
  jobOriginStationActiveIndex+=direction;
  if(jobOriginStationActiveIndex<0)jobOriginStationActiveIndex=buttons.length-1;
  if(jobOriginStationActiveIndex>=buttons.length)jobOriginStationActiveIndex=0;
  buttons.forEach((button,index)=>{
    button.classList.toggle("active",index===jobOriginStationActiveIndex);
    button.setAttribute("aria-selected",index===jobOriginStationActiveIndex?"true":"false");
  });
  buttons[jobOriginStationActiveIndex].scrollIntoView({block:"nearest"});
  return true;
}
function resolveOriginStationSelection_(){
  const input=String($("jobOriginStation")?.value||"").trim();
  if(!input)return null;
  if(jobOriginStationSelection &&
     normalizeStationLookup_(input)===normalizeStationLookup_(jobOriginStationSelection.name)){
    return jobOriginStationSelection;
  }
  const exact=findStationCandidates_(input).filter(station=>
    normalizeStationLookup_(station.n)===normalizeStationLookup_(input)
  );
  if(exact.length===1){
    selectOriginStation_(exact[0]);
    return jobOriginStationSelection;
  }
  renderStationCandidates_(input);
  const message=$("jobOriginStationMessage");
  if(message){
    message.textContent=exact.length>1
      ?"同じ駅名が複数あります。都道府県・住所を確認して候補から選択してください。"
      :"候補から起点駅を選択してください。";
    message.classList.remove("selected");
  }
  $("jobOriginStation")?.focus();
  return null;
}

function fillJobSearchFilters(){
  const companies=[...new Set(jobSearchItems.map(x=>String(x.sourceCompany||"").trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"ja"));

  updateJobPrefectureOptions();
  $("jobCompanyFilter").innerHTML='<option value="">すべて</option>'+
    companies.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
function updateJobRangeLabels(){
  const d=Number($("jobDistanceRange").value);
  const origin=String($("jobOriginStation")?.value||"").trim();
  const originLabel=jobOriginStationSelection?`${jobOriginStationSelection.name}駅`:origin;
  $("jobDistanceValue").textContent=origin?`${d}分以内`:"指定なし";
  if($("jobOriginStationLabel")){
    $("jobOriginStationLabel").textContent=originLabel||"起点駅";
  }

  let lo=Number($("jobPayMin").value);
  let hi=Number($("jobPayMax").value);

  if(lo>hi){
    [$("jobPayMin").value,$("jobPayMax").value]=[hi,lo];
    lo=Number($("jobPayMin").value);
    hi=Number($("jobPayMax").value);
  }

  const isDefault=jobPayUnit==="hourly"
    ? lo===1000&&hi===5000
    : lo===10000&&hi===50000;

  $("jobPayValue").textContent=isDefault
    ?"指定なし"
    :`${lo.toLocaleString()}円 ～ ${hi.toLocaleString()}円`;
}
function resetJobSearch(){
  ["jobRegionFilter","jobCompanyFilter","jobCareerFilter","jobBeginnerFilter"].forEach(id=>{
    if($(id))$(id).value="";
  });

  $("jobKeywordFilter").value="";
  if($("jobOriginStation"))$("jobOriginStation").value="";
  jobOriginStationSelection=null;
  closeStationCandidates_();
  const stationMessage=$("jobOriginStationMessage");
  if(stationMessage){
    stationMessage.textContent="駅名を入力し、都道府県・住所を確認して候補から選択してください。";
    stationMessage.classList.remove("selected");
  }
  $("jobDistanceRange").value=60;
  jobStationCommuteMap={};
  jobStationSearchApplied=false;
  jobStationSearchOrigin="";
  jobStationApiUnavailable=false;
  setJobPayUnit_("daily");
  if($("jobTravelFilter"))$("jobTravelFilter").checked=false;
  if($("jobRemoteFilter"))$("jobRemoteFilter").value="exclude";
  if($("jobSpotDateFrom"))$("jobSpotDateFrom").value="";
  if($("jobSpotDateTo"))$("jobSpotDateTo").value="";
  setJobSearchMode_("long");

  updateJobPrefectureOptions();
  updateJobRangeLabels();
  renderJobSearchResults();
}
async function runStationAwareJobSearch_(){
  const origin=String($("jobOriginStation")?.value||"").trim();
  if(origin&&!resolveOriginStationSelection_())return;
  const selectedOrigin=jobOriginStationSelection;
  const originDisplay=selectedOrigin
    ? `${selectedOrigin.name}駅（${selectedOrigin.prefecture}）`
    : origin;
  jobStationSearchApplied=false;
  jobStationCommuteMap={};
  jobStationSearchOrigin=originDisplay;
  jobStationApiUnavailable=false;

  renderJobSearchResults();

  if(!origin){
    updateJobRangeLabels();
    return;
  }

  const candidates=(jobSearchCurrentItems||[])
    .filter(job=>Number(job.rowNumber)>0)
    .slice(0,24);

  if(!candidates.length)return;

  const batchSize=4;
  const batches=[];
  for(let i=0;i<candidates.length;i+=batchSize){
    batches.push(candidates.slice(i,i+batchSize));
  }

  let successCount=0;
  let failedBatchCount=0;
  jobStationCommuteMap={};

  showWcLoading_(`${originDisplay}からの通勤時間を確認中…`);

  try{
    for(let index=0;index<batches.length;index++){
      const batch=batches[index];

      updateWcLoadingText_?.(
        `${originDisplay}からの通勤時間を確認中… ${index+1}/${batches.length}`
      );

      try{
        const result=await apiPost("stationJobCommutes",{
          station:originDisplay,
          stationData:selectedOrigin,
          rowNumbers:batch.map(job=>Number(job.rowNumber))
        });

        const rows=Array.isArray(result?.results)?result.results:[];
        rows.forEach(row=>{
          jobStationCommuteMap[String(row.rowNumber)]=row;
          if(row?.ok&&Number.isFinite(Number(row.minutes)))successCount++;
        });

        // 取得できた分から画面へ反映
        jobStationSearchApplied=true;
        renderJobSearchResults();
      }catch(batchError){
        failedBatchCount++;
        const message=String(batchError?.message||"");
        if(/未対応のAPI action|stationJobCommutes/i.test(message)){
          jobStationApiUnavailable=true;
          throw batchError;
        }
        // タイムアウトしたバッチだけ飛ばして次を続行
        batch.forEach(job=>{
          jobStationCommuteMap[String(job.rowNumber)]={
            rowNumber:Number(job.rowNumber),
            ok:false,
            minutes:null,
            reason:"BATCH_TIMEOUT"
          };
        });
      }
    }

    jobStationSearchApplied=true;
    renderJobSearchResults();

    if(failedBatchCount>0){
      const box=$("jobSearchResults");
      box?.insertAdjacentHTML(
        "afterbegin",
        `<div class="job-search-notice compact">通勤時間内の案件と、起点駅と同一都道府県の「最寄り駅から選定」案件を表示しています。</div>`
      );
    }else if(successCount===0){
      const box=$("jobSearchResults");
      box?.insertAdjacentHTML(
        "afterbegin",
        `<div class="job-search-notice compact">通勤時間を取得できませんでした。起点駅と同一都道府県の「最寄り駅から選定」案件のみ表示しています。</div>`
      );
    }
  }catch(error){
    jobStationSearchApplied=false;
    const message=String(error?.message||"");
    jobStationApiUnavailable=/未対応のAPI action|stationJobCommutes/i.test(message);

    renderJobSearchResults();

    const box=$("jobSearchResults");
    if(box){
      const notice=jobStationApiUnavailable
        ? "通勤時間検索を利用するには、最新GASの再デプロイが必要です。"
        : "通勤時間だけ取得できませんでした。その他の条件で検索結果を表示しています。";

      box.insertAdjacentHTML(
        "afterbegin",
        `<div class="job-search-notice compact">${notice}</div>`
      );
    }
  }finally{
    await hideWcLoading_(true);
  }
}

function getJobCommuteMinutes_(x){
  const direct=[
    x.commuteMinutes,x.travelMinutes,x.accessMinutes,x.routeMinutes,
    x.commuteTime,x.travelTime,x.accessTime
  ];

  for(const value of direct){
    const n=Number(String(value==null?"":value).replace(/[^\d.]/g,""));
    if(Number.isFinite(n)&&n>=0)return n;
  }

  const text=[x.access,x.station,x.originalText,x.remarks].join(" ");
  const m=text.match(/(?:徒歩|通勤|所要|アクセス)[^\d]{0,8}(\d{1,3})\s*分/);
  return m?Number(m[1]):null;
}

function isTravelJob_(x){
  const text=normalizeJobText([
    x.shopName,x.area,x.prefecture,x.originalText,x.remarks,x.workStyle
  ].join(" "));
  return /出張|全国対応|全国案件|遠方対応|宿泊/.test(text);
}

function getJobRegion_(x){
  const pref=String(x.prefecture||"").trim();
  for(const [region,prefs] of Object.entries(WC_JOB_REGION_MAP)){
    if(prefs.includes(pref))return region;
  }
  const area=String(x.area||"").trim();
  return WC_JOB_REGION_MAP[area]?area:"";
}

function getValidJobCommuteMinutes_(routeInfo){
  if(!routeInfo)return null;
  const minutes=Number(routeInfo.minutes);
  return Number.isFinite(minutes)&&minutes>0?minutes:null;
}

function normalizePrefectureForJobSearch_(value){
  const text=String(value||"").normalize("NFKC").replace(/[\s　]/g,"");
  if(!text)return "";

  const prefectures=[
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
    "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
    "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
    "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
    "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
    "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
    "熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];

  const exact=prefectures.find(pref=>text===pref);
  if(exact)return exact;

  const contained=prefectures.filter(pref=>text.includes(pref));
  return contained.length===1?contained[0]:"";
}

function getJobPrefectureForStationSearch_(job){
  const direct=normalizePrefectureForJobSearch_(job?.prefecture);
  if(direct)return direct;

  const text=[
    job?.area,job?.shopName,job?.originalText,job?.remarks,job?.location
  ].join(" ");
  return normalizePrefectureForJobSearch_(text);
}

function isSamePrefectureAsSelectedOrigin_(job){
  const originPref=normalizePrefectureForJobSearch_(jobOriginStationSelection?.prefecture);
  const jobPref=getJobPrefectureForStationSearch_(job);
  return !!originPref&&!!jobPref&&originPref===jobPref;
}

function isNearestSelectionJob_(job){
  const text=normalizeJobText([
    job?.shopName,
    job?.area,
    job?.prefecture,
    job?.originalText,
    job?.remarks
  ].join(" "));
  return [
    "最寄りから選定",
    "最寄駅から選定",
    "最寄り駅から選定",
    "店舗未定",
    "店舗不明",
    "勤務地未定",
    "勤務地要確認"
  ].some(word=>text.includes(normalizeJobText(word)));
}

function normalizeStationNameForCandidate_(value){
  return normalizeJobText(String(value||""))
    .replace(/駅$/,"")
    .replace(/\s+/g,"");
}

function getOriginAreaRule_(originStation){
  const origin=normalizeStationNameForCandidate_(originStation);

  const rules={
    "名古屋":{
      prefectures:["愛知県"],
      broadAreas:["名古屋市","尾張","愛知"],
      localWords:[
        "名古屋市","名駅","名古屋駅","栄","金山","伏見","丸の内","大曽根",
        "千種","今池","本山","星ヶ丘","藤が丘","八事","新瑞橋","名古屋港",
        "中区","中村区","東区","西区","北区","昭和区","瑞穂区",
        "熱田区","中川区","港区","南区","守山区","緑区","名東区","天白区",
        "清須","北名古屋","春日井","小牧","一宮","稲沢","岩倉","日進",
        "長久手","豊明","大府","刈谷","東海市"
      ]
    }
  };

  return rules[origin]||null;
}

function getJobAllSearchText_(job){
  return normalizeJobText([
    job?.shopName,
    job?.prefecture,
    job?.area,
    job?.originalText,
    job?.remarks,
    job?.location,
    job?.nearestStation
  ].join(" "));
}

function hasConflictingPrefecture_(job,originStation){
  const rule=getOriginAreaRule_(originStation);
  if(!rule)return false;

  const text=getJobAllSearchText_(job);
  const allPrefs=[
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
    "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
    "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
    "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
    "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
    "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
    "熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];

  const found=allPrefs.filter(pref=>text.includes(normalizeJobText(pref)));
  if(!found.length)return false;

  return found.some(pref=>!rule.prefectures.includes(pref));
}

function isOriginAreaCompatible_(job,originStation){
  if(hasConflictingPrefecture_(job,originStation))return false;

  const rule=getOriginAreaRule_(originStation);
  if(!rule)return true;

  const text=getJobAllSearchText_(job);

  // 都道府県が明記されていれば起点県のみ許可
  const hasAnyPrefecture=[
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
    "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
    "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
    "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
    "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
    "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
    "熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ].some(pref=>text.includes(normalizeJobText(pref)));

  if(hasAnyPrefecture){
    return rule.prefectures.some(pref=>text.includes(normalizeJobText(pref)));
  }

  // 県名がない案件は、具体的な起点周辺地名があるか、店舗未定系のみ許可
  return rule.localWords.some(word=>text.includes(normalizeJobText(word))) ||
         isNearestSelectionJob_(job);
}

function getJobTextCandidateReason_(job,originStation,maxMinutes){
  const origin=normalizeStationNameForCandidate_(originStation);
  if(!origin)return "";

  if(!isOriginAreaCompatible_(job,originStation))return "";

  const text=getJobAllSearchText_(job);
  if(!text)return "";

  const rule=getOriginAreaRule_(originStation);

  // 起点駅そのもの、または周辺表現
  const directWords=[
    origin+"駅",
    origin+"周辺",
    origin+"近郊",
    origin+"エリア",
    origin+"市内"
  ];
  if(directWords.some(word=>text.includes(normalizeJobText(word)))){
    return "起点駅周辺の記載あり";
  }

  // 名古屋起点など、具体的な周辺地名だけ候補にする
  if(rule){
    const hit=rule.localWords.find(word=>text.includes(normalizeJobText(word)));
    if(hit){
      return `${hit}の記載あり`;
    }
  }

  // 「60分圏内」だけの一般文言は起点との関連が不明なため採用しない
  return "";
}


function getJobDisplayName_(job){
  const name=String(job?.shopName||"").trim();
  if(name&&name!=="案件名未設定")return name;
  if(isNearestSelectionJob_(job))return "最寄りから選定（店舗未定）";
  return "案件名未設定";
}

function renderJobSearchResults(){
  if(!jobSearchLoaded)return;

  const region=$("jobRegionFilter")?.value||"";
  const area=$("jobAreaFilter")?.value||"";
  const company=$("jobCompanyFilter")?.value||"";
  const career=$("jobCareerFilter")?.value||"";
  const beginner=$("jobBeginnerFilter")?.value||"";
  const q=normalizeJobText($("jobKeywordFilter")?.value||"");
  const min=Number($("jobPayMin")?.value||(jobPayUnit==="hourly"?1000:10000));
  const max=Number($("jobPayMax")?.value||(jobPayUnit==="hourly"?5000:50000));
  const maxMinutes=Number($("jobDistanceRange")?.value||60);
  const originStation=jobOriginStationSelection
    ? `${jobOriginStationSelection.name}駅`
    : String($("jobOriginStation")?.value||"").trim();
  const includeTravel=$("jobTravelFilter")?.checked===true;
  const remoteMode=$("jobRemoteFilter")?.value||"exclude";
  const dateFrom=$("jobSpotDateFrom")?.value||"";
  const dateTo=$("jobSpotDateTo")?.value||"";

  let items=jobSearchItems.filter(x=>{
    const text=normalizeJobText([x.shopName,x.prefecture,x.area,x.sourceCompany,x.price,x.originalText,x.beginnerAvailability,x.remarks].join(" "));
    const pay=extractJobPay(x.price);
    const routeInfo=jobStationCommuteMap[String(x.rowNumber)]||null;
    const commute=originStation
      ? getValidJobCommuteMinutes_(routeInfo)
      : (()=>{const m=Number(getJobCommuteMinutes_(x));return Number.isFinite(m)&&m>0?m:null;})();
    const jobRegion=getJobRegion_(x);
    const travel=isTravelJob_(x);
    const spot=isSpotJob_(x);
    const remote=isRemoteJob_(x);
    const jobDate=getJobDate_(x);

    const modeOk=jobSearchMode==="spot"?spot:!spot;
    const remoteOk=remoteMode==="include"||(remoteMode==="only"?remote:!remote);
    const spotDateOk=jobSearchMode!=="spot"||((!dateFrom||!jobDate||jobDate>=dateFrom)&&(!dateTo||!jobDate||jobDate<=dateTo));
    const regionOk=!region||jobRegion===region;
    const areaOk=!area||(area===region?jobRegion===region:String(x.prefecture||"").trim()===area);
    const travelOk=includeTravel||!travel;
    // 起点駅検索の完了後は、
    // 1. 指定時間以内と確認できた案件
    // 2. 「最寄りから選定」「店舗未定」など勤務地を後決めする案件
    // だけを残す。未確認の全案件は表示しない。
    const textCandidateReason=getJobTextCandidateReason_(x,originStation,maxMinutes);
    const areaCompatible=isOriginAreaCompatible_(x,originStation);

    // 実測時間がある場合は時間だけで厳密判定する。
    // 149分など上限超過は、文言候補があっても除外する。
    // 実測できない場合は、起点駅と案件が同一都道府県であることを必須にする。
    // そのうえで「最寄りから選定」または具体的地名候補だけを残す。
    // WC-7.33.10: 店舗未定・最寄り駅から選定案件は、実測値がない場合、
    // 起点駅と案件の都道府県が完全一致しなければ必ず除外する。
    const isUndecidedLocationJob=isNearestSelectionJob_(x);
    const samePrefecture=isSamePrefectureAsSelectedOrigin_(x);
    const forceExcludeUndecidedOtherPrefecture=
      !!originStation &&
      jobStationSearchApplied &&
      commute===null &&
      isUndecidedLocationJob &&
      !samePrefecture;

    if(forceExcludeUndecidedOtherPrefecture){
      return false;
    }

    const commuteOk=!originStation
      ? true
      : (
          !jobStationSearchApplied
            ? true
            : (
                commute!==null
                  ? commute<=maxMinutes
                  : (
                      samePrefecture &&
                      areaCompatible &&
                      (isUndecidedLocationJob || !!textCandidateReason)
                    )
              )
        );
    const payOk=!pay||(pay>=min&&pay<=max);

    return modeOk&&remoteOk&&spotDateOk&&regionOk&&areaOk&&travelOk&&commuteOk&&payOk&&
      (!company||x.sourceCompany===company)&&
      (!career||inferCareer(x)===career)&&
      (!beginner||normalizeJobText(x.beginnerAvailability).includes(normalizeJobText(beginner)))&&
      (!q||text.includes(q));
  });

  jobSearchCurrentItems=items.slice();

  const sort=$("jobSort")?.value||"new";
  if(sort==="payHigh")items.sort((a,b)=>extractJobPay(b.price)-extractJobPay(a.price));
  else if(sort==="name")items.sort((a,b)=>String(a.shopName||"").localeCompare(String(b.shopName||""),"ja"));

  $("jobResultCount").textContent=`${items.length}件`;
  const box=$("jobSearchResults");
  if(!items.length){box.innerHTML='<div class="empty job-empty">条件に合う案件がありません。</div>';return;}

  box.innerHTML=items.slice(0,20).map(x=>{
    const routeInfo=jobStationCommuteMap[String(x.rowNumber)]||null;
    const commute=originStation
      ? getValidJobCommuteMinutes_(routeInfo)
      : (()=>{const m=Number(getJobCommuteMinutes_(x));return Number.isFinite(m)&&m>0?m:null;})();
    const textCandidateReason=getJobTextCandidateReason_(x,originStation,maxMinutes);
    const areaCompatible=isOriginAreaCompatible_(x,originStation);
    const spot=isSpotJob_(x);
    const remote=isRemoteJob_(x);
    const travel=isTravelJob_(x);
    const date=getJobDate_(x);
    return `<article class="job-result-card">
      <div class="job-card-main">
        <div class="job-card-title-row">
          <span class="job-kind-badge ${spot?'spot':'long'}">${spot?'スポット':'長期案件'}</span>
          <h3>${esc(getJobDisplayName_(x))}</h3>
        </div>
        <div class="job-card-meta">
          <span>📍 ${esc(x.prefecture||x.area||"勤務地要確認")}</span>
          ${date?`<span>📅 ${esc(date)}</span>`:""}
          ${commute!==null
            ? `<span>🚃 約${commute}分</span>`
            : (originStation&&jobStationSearchApplied&&areaCompatible&&isNearestSelectionJob_(x)
                ? `<span class="job-commute-pending">🚃 最寄り駅から選定</span>`
                : (originStation&&jobStationSearchApplied&&areaCompatible&&textCandidateReason
                    ? `<span class="job-text-candidate">📍 ${esc(textCandidateReason)}・候補</span>`
                    : ""))}
          <span>💴 ${esc(x.price||"単価要確認")}</span>
          ${formatJobConvertedPay_(x.price)?`<span class="job-pay-converted">${esc(formatJobConvertedPay_(x.price))}</span>`:""}
        </div>
        <div class="job-card-sub">
          <span>🏢 ${esc(x.sourceCompany||"案件元要確認")}</span>
          <span class="job-mini-tag">${esc(inferCareer(x))}</span>
          ${remote?'<span class="job-mini-tag">リモート</span>':""}
          ${travel?'<span class="job-mini-tag">出張あり</span>':""}
          ${x.beginnerAvailability?`<span class="job-mini-tag">未経験:${esc(x.beginnerAvailability)}</span>`:""}
        </div>
      </div>
      <details class="job-card-details"><summary>詳細を見る</summary><div class="remarks">${esc(x.originalText||x.remarks||"詳細情報はありません。")}</div></details>
    </article>`;
  }).join("");
}

let jobSearchMode="long";
let jobSearchCurrentItems=[];
let jobStationCommuteMap={};
let jobStationSearchApplied=false;
let jobStationSearchOrigin="";
let jobOriginStationSelection=null;
let jobOriginStationActiveIndex=-1;
let jobStationApiUnavailable=false;
let jobPayUnit="daily";


function setJobSearchMode_(mode){
  jobSearchMode=mode==="spot"?"spot":"long";

  $("jobModeLongBtn")?.classList.toggle("active",jobSearchMode==="long");
  $("jobModeSpotBtn")?.classList.toggle("active",jobSearchMode==="spot");

  document.querySelectorAll(".spot-only-filter").forEach(el=>{
    el.hidden=jobSearchMode!=="spot";
  });

  const note=$("jobResultModeNote");
  if(note){
    note.textContent=jobSearchMode==="long"
      ?"スポット案件は表示していません。"
      :"スポット案件のみ表示しています。";
  }

  renderJobSearchResults();
}

function normalizeSpotDate_(value){
  if(!value)return "";

  const text=String(value).trim();

  const full=text.match(
    /(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/
  );
  if(full){
    return `${full[1]}-${String(full[2]).padStart(2,"0")}-${String(full[3]).padStart(2,"0")}`;
  }

  const monthDay=text.match(
    /(?:^|\D)(\d{1,2})[\/\-.月](\d{1,2})(?:日|\D|$)/
  );
  if(monthDay){
    const year=new Date().getFullYear();
    return `${year}-${String(monthDay[1]).padStart(2,"0")}-${String(monthDay[2]).padStart(2,"0")}`;
  }

  return "";
}

function getJobDate_(job){
  for(const value of [
    job.workDate,
    job.startDate,
    job.date,
    job.eventDate,
    job.updatedAt,
    job.updateDate
  ]){
    const date=normalizeSpotDate_(value);
    if(date)return date;
  }

  return normalizeSpotDate_(
    [job.originalText,job.remarks,job.shopName].join(" ")
  );
}

function isSpotJob_(job){
  if(job.isSpot===true||job.spot===true)return true;

  const explicitWorkDateFields=[
    job.workDate,
    job.eventDate,
    job.date,
    job.eventDates,
    job.workDates,
    job.shiftDate,
    job.scheduleDate
  ].filter(value=>String(value||"").trim()!=="");

  if(explicitWorkDateFields.length>0){
    return true;
  }

  const text=normalizeJobText([
    job.shopName,
    job.area,
    job.prefecture,
    job.price,
    job.originalText,
    job.remarks,
    job.workDate,
    job.eventDate,
    job.date,
    job.period,
    job.workDays,
    job.schedule,
    job.category,
    job.jobType
  ].join(" "));

  const explicit=
    /スポット|単発|単日|短期|イベント|催事|応援販売|ヘルプ案件|週末枠|土日枠|平日枠|週末案件|土日案件|イベント人員|クローザー募集|キャッチャー募集|\b4w\b|\b3w\b|\b2w\b|\b1w\b/i
      .test(text);

  if(explicit)return true;

  const dated=
    /(?:^|\D)(?:20\d{2}[\/\-.年])?\d{1,2}[\/月]\d{1,2}(?:日)?(?:\D|$)/
      .test(text);

  const limited=
    /\d+日間|期間限定|のみ勤務|限定勤務|連勤|稼働日[:：]?\s*\d+[\/・,]|日程[:：]|開催日[:：]|実施日[:：]/
      .test(text);

  const spotRatePattern=
    /キャッチャー|クローザー|平日\s*\d+(?:\.\d+)?|土日祝?\s*\d+(?:\.\d+)?|各店\s*\d+名|店舗別/
      .test(text);

  const multiStorePattern=
    /.+\/.+/.test(String(job.shopName||"")) ||
    /店舗[:：]?.+\/.+/.test(text);

  return (dated&&limited)||(dated&&spotRatePattern)||(dated&&multiStorePattern);
}

function isRemoteJob_(job){
  const text=normalizeJobText([
    job.shopName,
    job.area,
    job.prefecture,
    job.originalText,
    job.remarks,
    job.workStyle,
    job.location
  ].join(" "));

  return /リモート|在宅|テレワーク|在宅勤務|フルリモート/.test(text);
}


let matchingCandidatesLoaded=false;
let matchingJobsLoaded=false;
let matchingCandidateItems=[];
let matchingJobItems=[];
let matchingMode="candidate";

let matchingCandidateActiveIndex=-1;

async function loadMatchingCandidatesOnce(){
  if(matchingCandidatesLoaded)return;
  const input=$("matchingCandidateSearch"),summary=$("matchingSummary");
  if(!input)return;
  input.disabled=true;
  input.placeholder="求職者を読み込み中...";
  try{
    const items=await apiGet("matchingCandidates");
    matchingCandidateItems=Array.isArray(items)?items:[];
    matchingCandidatesLoaded=true;
    input.placeholder="名前・都道府県・駅・経験を入力";
    if(summary)summary.textContent=`求職者 ${matchingCandidateItems.length}名を読み込みました。`;
  }catch(err){
    input.placeholder="求職者を取得できませんでした";
    if(summary)summary.textContent=err?.message||"求職者一覧を取得できませんでした。";
  }finally{input.disabled=false;}
}

function matchingCandidateDisplayText_(x){
  return [x.name||"",[x.prefecture||"",x.station||""].filter(Boolean).join(" "),x.experience||""].filter(Boolean).join("｜");
}

function closeMatchingCandidateSuggestions_(){
  const box=$("matchingCandidateSuggestions"),input=$("matchingCandidateSearch");
  if(box)box.hidden=true;
  if(input)input.setAttribute("aria-expanded","false");
  matchingCandidateActiveIndex=-1;
}

function selectMatchingCandidate_(index){
  const candidate=matchingCandidateItems[Number(index)];
  if(!candidate)return;
  const hidden=$("matchingCandidateSelect"),input=$("matchingCandidateSearch");
  if(hidden)hidden.value=String(index);
  if(input)input.value=matchingCandidateDisplayText_(candidate);
  closeMatchingCandidateSuggestions_();
}

function renderMatchingCandidateOptions(query,forceOpen=false){
  const box=$("matchingCandidateSuggestions"),input=$("matchingCandidateSearch");
  if(!box||!input)return;
  const q=String(query||"").normalize("NFKC").toLowerCase().replace(/\s+/g,"").trim();
  const filtered=matchingCandidateItems.map((x,i)=>({x,i})).filter(({x})=>{
    if(!q)return true;
    const text=[x.name,x.prefecture,x.station,x.experience,x.career,x.company].join(" ")
      .normalize("NFKC").toLowerCase().replace(/\s+/g,"");
    return text.includes(q);
  }).slice(0,30);

  if(!forceOpen){closeMatchingCandidateSuggestions_();return;}
  matchingCandidateActiveIndex=-1;
  if(!filtered.length){
    box.innerHTML='<div class="matching-candidate-empty">該当する求職者がいません</div>';
  }else{
    box.innerHTML=filtered.map(({x,i},position)=>`
      <button type="button" class="matching-candidate-option" role="option" data-candidate-index="${i}" data-position="${position}">
        <strong>${esc(x.name||"")}</strong>
        <span>${esc([x.prefecture||"",x.station||""].filter(Boolean).join(" "))}</span>
        <small>${esc([x.experience||"",x.career||""].filter(Boolean).join("｜"))}</small>
      </button>`).join("");
    box.querySelectorAll(".matching-candidate-option").forEach(button=>{
      button.addEventListener("mousedown",event=>event.preventDefault());
      button.addEventListener("click",()=>selectMatchingCandidate_(button.dataset.candidateIndex));
    });
  }
  box.hidden=false;
  input.setAttribute("aria-expanded","true");
}

function handleMatchingCandidateKeydown_(event){
  const box=$("matchingCandidateSuggestions");
  if(!box||box.hidden)return;
  const buttons=[...box.querySelectorAll(".matching-candidate-option")];
  if(!buttons.length)return;
  if(event.key==="ArrowDown"){
    event.preventDefault();
    matchingCandidateActiveIndex=Math.min(buttons.length-1,matchingCandidateActiveIndex+1);
  }else if(event.key==="ArrowUp"){
    event.preventDefault();
    matchingCandidateActiveIndex=Math.max(0,matchingCandidateActiveIndex-1);
  }else if(event.key==="Enter"&&matchingCandidateActiveIndex>=0){
    event.preventDefault();
    selectMatchingCandidate_(buttons[matchingCandidateActiveIndex].dataset.candidateIndex);
    return;
  }else if(event.key==="Escape"){
    closeMatchingCandidateSuggestions_();
    return;
  }else{return;}
  buttons.forEach((button,index)=>button.classList.toggle("active",index===matchingCandidateActiveIndex));
  buttons[matchingCandidateActiveIndex]?.scrollIntoView({block:"nearest"});
}

async function loadMatchingJobsOnce(){
  if(matchingJobsLoaded)return;
  const select=$("matchingJobSelect"),summary=$("matchingSummary");
  if(!select)return;
  select.disabled=true; select.innerHTML='<option value="">案件を読み込み中...</option>';
  try{
    const items=await apiGet("matchingJobs");
    matchingJobItems=Array.isArray(items)?items:[];
    matchingJobsLoaded=true; renderMatchingJobOptions("");
    if(summary)summary.textContent=`案件 ${matchingJobItems.length}件を読み込みました。`;
  }catch(err){
    select.innerHTML='<option value="">案件を取得できませんでした</option>';
    if(summary)summary.textContent=err?.message||"案件一覧を取得できませんでした。";
  }finally{select.disabled=false;}
}

function renderMatchingJobOptions(query){
  const select=$("matchingJobSelect");if(!select)return;
  const q=String(query||"").normalize("NFKC").toLowerCase().trim();
  const filtered=matchingJobItems.map((x,i)=>({x,i})).filter(({x})=>{
    if(!q)return true;
    return [x.shopName,x.prefecture,x.area,x.sourceCompany,x.price].join(" ").normalize("NFKC").toLowerCase().includes(q);
  }).slice(0,300);
  select.innerHTML='<option value="">案件を選択</option>'+filtered.map(({x,i})=>
    `<option value="${i}">${esc(x.shopName||"案件名未設定")}｜${esc(x.prefecture||x.area||"")}｜${esc(x.price||"")}</option>`).join("");
}

async function setMatchingMode(mode){
  matchingMode=mode==="job"?"job":"candidate";
  $("matchModeCandidateBtn")?.classList.toggle("active",matchingMode==="candidate");
  $("matchModeJobBtn")?.classList.toggle("active",matchingMode==="job");
  $("matchingCandidateLabel").hidden=matchingMode!=="candidate";
  $("matchingJobLabel").hidden=matchingMode!=="job";
  $("runMatchingBtn").textContent=matchingMode==="candidate"?"おすすめ案件を探す":"おすすめ求職者を探す";
  $("matchingResults").innerHTML=""; $("matchingSummary").textContent="";
  if(matchingMode==="candidate")await loadMatchingCandidatesOnce(); else await loadMatchingJobsOnce();
}

async function runCandidateMatching(){
  showWcLoading_("マッチング中…");
  const raw=$("matchingCandidateSelect")?.value??"";
  if(raw===""){showToast("求職者を選択してください。","error");return;}
  const c=matchingCandidateItems[Number(raw)];
  if(!c){showToast("求職者の選択情報が正しくありません。","error");return;}
  const results=$("matchingResults"),summary=$("matchingSummary");
  results.innerHTML='<div class="loading">案件を比較中...</div>'; summary.textContent="";
  try{
    const data=await apiPost("candidateJobMatches",{sheetName:c.sheetName,rowNumber:c.rowNumber,commuteCheckLimit:4});
    summary.textContent=`${data.candidate.name}さん｜全${data.totalJobs}件 → 条件絞込${data.filteredJobs ?? data.totalJobs}件 → 重複整理${data.dedupedJobs ?? data.filteredJobs ?? data.totalJobs}件｜おすすめ上位${(data.results||[]).length}件`;
    renderJobMatchResults(data.results||[]);
  }catch(err){
    const message=err?.message||"マッチングに失敗しました。";
    results.innerHTML=`<div class="error">${esc(message)}</div>`; summary.textContent=message;
  }
  await hideWcLoading_();
}

async function runJobMatching(){
  showWcLoading_("マッチング中…");
  const raw=$("matchingJobSelect")?.value??"";
  if(raw===""){showToast("案件を選択してください。","error");return;}
  const job=matchingJobItems[Number(raw)];
  if(!job){showToast("案件の選択情報が正しくありません。","error");return;}
  const results=$("matchingResults"),summary=$("matchingSummary");
  results.innerHTML='<div class="loading">求職者を比較中...</div>'; summary.textContent="";
  try{
    const data=await apiPost("jobCandidateMatches",{rowNumber:job.rowNumber});
    summary.textContent=`${data.job.shopName||"選択案件"}｜求職者${data.totalCandidates}名 → 条件絞込${data.filteredCandidates ?? data.totalCandidates}名｜おすすめ上位${(data.results||[]).length}名`;
    renderCandidateMatchResults(data.results||[]);
  }catch(err){
    const message=err?.message||"マッチングに失敗しました。";
    results.innerHTML=`<div class="error">${esc(message)}</div>`; summary.textContent=message;
  }
  await hideWcLoading_();
}

function matchBadges(x){
  return `<div class="match-meta"><span class="match-grade">${esc(x.grade||"")}</span>`+
    (x.reasons||[]).filter(v=>!v.includes("通勤条件補正")).map(v=>`<span class="match-reason">${esc(v)}</span>`).join("")+
    (x.cautions||[]).map(v=>`<span class="match-caution">${esc(v)}</span>`).join("")+`</div>`;
}

function renderJobMatchResults(items){
  const box=$("matchingResults");if(!box)return;
  if(!items.length){box.innerHTML='<div class="empty">マッチする案件がありません。</div>';return;}
  box.innerHTML=items.map(x=>`<article class="card match-card">
    <div class="match-score">${Number(x.percent||0)}%</div>
    <h3>${esc(x.shopName||"案件名未設定")}</h3>${matchBadges(x)}
    <div class="details">${rows([
      ["案件元",x.sourceCompany],["エリア",x.area],["都道府県",x.prefecture],
      ["通勤条件",x.commuteLimitExplicit
        ? `本人上限${x.commuteLimitMinutes||"-"}分（+10分まで△表示）`
        : "未記載：60分以内◎／61〜90分△"],
      ["通勤判定",x.commuteLabel||x.commuteStatus||"要確認"],
      ["通勤時間",x.commuteMinutes!=null?`約${x.commuteMinutes}分`:"要確認"],
      ["通勤補正",Number(x.commutePenalty||0)>0?`-${Number(x.commutePenalty)}点`:"なし"],
      ["単価",x.price],["未経験",x.beginnerAvailability],["稼働日数",x.workDays],
      ["勤務時間",x.workTime],["休日",x.holiday]
    ])}</div>${x.originalText?`<div class="remarks">${esc(x.originalText)}</div>`:""}
  </article>`).join("");
}

function renderCandidateMatchResults(items){
  const box=$("matchingResults");if(!box)return;
  if(!items.length){box.innerHTML='<div class="empty">マッチする求職者がいません。</div>';return;}
  box.innerHTML=items.map(x=>`<article class="card match-card">
    <div class="match-score">${Number(x.percent||0)}%</div>
    <h3>${esc(x.name||"名前未設定")}</h3>${matchBadges(x)}
    <div class="details">${rows([
      ["都道府県",x.prefecture],["最寄駅",x.station],["希望単価",x.price],
      ["キャリア",x.career],["経験",x.experience],["開始希望",x.startDate],["地域",x.region]
    ])}</div>${x.remarks?`<div class="remarks">${esc(x.remarks)}</div>`:""}
  </article>`).join("");
}












