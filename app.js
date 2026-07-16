/* WonderCraft PWA WC-6.2 - 案件進捗プルダウン・LINE更新対応 */
const state={view:"home",candidates:[],progress:[],today:[],progressStatuses:[],selected:null,runtimeConfig:{}};
const $=id=>document.getElementById(id);
const config=window.WONDERCRAFT_CONFIG||{};
let debounceTimer;

window.addEventListener("load",()=>{
  setTimeout(()=>{$("splash")?.classList.add("hide");setTimeout(()=>$('splash')?.remove(),450)},900);
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  bindEvents();
  if($("appVersion")) $("appVersion").textContent=config.VERSION||"WC-6.2";
  initialize();
});

function bindEvents(){
  $("systemRetryBtn").onclick=()=>initialize(true);
  $("reloadBtn").onclick=()=>initialize(true);
  $("searchInput").addEventListener("input",()=>{clearTimeout(debounceTimer);debounceTimer=setTimeout(loadCurrent,350)});
  $("staffFilter").onchange=loadCurrent;
  $("regionFilter").onchange=loadCurrent;
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModal);
  $("editForm").onsubmit=saveEdit;
  $("copyProposalBtn").onclick=copyProposal;
}

async function initialize(force=false){
  try{
    if($("appPanel").hidden){
      $("systemPanel").hidden=false;
      $("systemTitle").textContent="接続確認中";
      $("systemMessage").textContent="システムへ接続しています。";
      $("systemRetryBtn").hidden=true;
    }else{
      hideSystemPanel();
    }
    const api=getApi();
    if(!api||api.includes("ここにGAS")){
      return showSystemError("管理者設定エラー","GASウェブアプリURLが設定されていません。管理者へ連絡してください。");
    }

    ensureDeviceId();
    let token=getToken();

    if(!token){
      const oldPin=localStorage.getItem("wc_pin")||"";
      try{
        const enrolled=await enrollDevice(oldPin);
        token=enrolled.token;
        localStorage.removeItem("wc_pin");
      }catch(error){
        return showEnrollmentError(error);
      }
    }

    state.runtimeConfig=await apiGet("config",{},api,token);
    if(state.runtimeConfig.maintenance){
      return showMaintenance(state.runtimeConfig.maintenanceMessage||"現在メンテナンス中です。");
    }

    $("appPanel").hidden=false;
    hideSystemPanel();
    if(force)setStatus("最新情報を読み込みました。");

    await loadFilters();
    await loadDashboard();
    applyViewState();
    await loadCurrent();
  }catch(error){
    if(isDeviceAuthError(error)){
      clearToken();
      try{
        await enrollDevice("");
        return initialize(force);
      }catch(enrollError){
        return showEnrollmentError(enrollError);
      }
    }
    showSystemError("接続エラー",error.message||"システムへ接続できませんでした。");
  }
}

function getApi(){return String(config.GAS_API_URL||"").trim().replace(/\/+$/,"")}
function ensureDeviceId(){let id=localStorage.getItem("wc_device_id");if(!id){id=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`);localStorage.setItem("wc_device_id",id)}return id}
function getDeviceName(){const platform=navigator.userAgentData?.platform||navigator.platform||"端末";const mobile=/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)?"スマホ":"PC";return `${mobile} / ${platform}`.slice(0,100)}
function getToken(){return localStorage.getItem("wc_device_token")||""}
function saveToken(token){localStorage.setItem("wc_device_token",token)}
function clearToken(){localStorage.removeItem("wc_device_token")}

async function enrollDevice(pin=""){
  const url=new URL(getApi());
  url.searchParams.set("api","1");
  url.searchParams.set("action","enroll");
  url.searchParams.set("deviceId",ensureDeviceId());
  url.searchParams.set("deviceName",getDeviceName());
  if(pin)url.searchParams.set("pin",pin);
  const response=await fetch(url.toString(),{redirect:"follow",cache:"no-store"});
  const json=await response.json();
  if(!json.success){const error=new Error(json.error||"端末登録に失敗しました。");error.code=json.code||"ENROLL_ERROR";throw error}
  saveToken(json.data.token);state.runtimeConfig=json.data.config||{};return json.data;
}

function hideSystemPanel(){if($("systemPanel"))$("systemPanel").hidden=true}
function showSystemError(title,message){$("appPanel").hidden=true;$("systemPanel").hidden=false;$("systemTitle").textContent=title||"エラー";$("systemMessage").textContent=message||"システムへ接続できませんでした。";$("systemRetryBtn").hidden=false}
function showEnrollmentError(error){const code=error&&error.code?error.code:"";let message=error&&error.message?error.message:"端末の自動登録に失敗しました。";if(code==="ENROLL_ERROR"||message.includes("PIN"))message="端末の自動登録が許可されていません。管理者に PWA_AUTO_ENROLL の設定確認を依頼してください。";showSystemError("端末登録エラー",message)}
function showMaintenance(message){$("appPanel").hidden=true;$("systemPanel").hidden=false;$("systemTitle").textContent="メンテナンス中";$("systemMessage").textContent=message||"現在メンテナンス中です。";$("systemRetryBtn").hidden=true}
function isDeviceAuthError(error){return ["DEVICE_ENROLL_REQUIRED","DEVICE_TOKEN_INVALID","DEVICE_TOKEN_EXPIRED","DEVICE_DISABLED"].includes(error.code)}

async function apiGet(action,params={},api=getApi(),token=getToken()){
  const url=new URL(api);url.searchParams.set("api","1");url.searchParams.set("action",action);url.searchParams.set("token",token);
  Object.entries(params).forEach(([key,value])=>{if(value!==undefined&&value!==null&&String(value)!=="")url.searchParams.set(key,value)});
  const response=await fetch(url.toString(),{redirect:"follow",cache:"no-store"});
  const json=await response.json();
  if(!json.success){const error=new Error(json.error||"APIエラー");error.code=json.code||"API_ERROR";throw error}
  return json.data;
}

async function apiPost(action,payload){
  const response=await fetch(getApi(),{method:"POST",redirect:"follow",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({wc_api:true,action,token:getToken(),payload})});
  const json=await response.json();
  if(!json.success){const error=new Error(json.error||"APIエラー");error.code=json.code||"API_ERROR";throw error}
  return json.data;
}

async function loadFilters(){try{const o=await apiGet("filters");state.progressStatuses=o.progressStatuses||[];fillSelect("staffFilter",o.staff||[],"担当者：全員");fillSelect("regionFilter",o.regions||[],"地域：すべて")}catch(e){showError(e)}}
function fillSelect(id,items,first){const el=$(id),old=el.value;el.innerHTML=`<option value="">${first}</option>`;items.forEach(v=>el.insertAdjacentHTML("beforeend",`<option value="${esc(v)}">${esc(v)}</option>`));el.value=old}
async function loadDashboard(){try{renderDashboard(await apiGet("dashboard"))}catch(e){showError(e)}}
function renderDashboard(d){$("countCandidates").textContent=d.candidates??"-";$("countProgress").textContent=d.progress??"-";$("countToday").textContent=d.todayInterviews??"-";$("countWaiting").textContent=d.waitingCandidates??"-"}

function switchView(view){
  if(!["home","candidates","progress"].includes(view))view="home";
  state.view=view;
  applyViewState();
  loadCurrent();
}

function applyViewState(){
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));
  const isHome=state.view==="home";
  $("dashboardSection").hidden=!isHome;
  $("homeHeader").hidden=!isHome;
  $("listHeader").hidden=isHome;
  $("filterSection").hidden=isHome;

  if(state.view==="candidates"){
    $("viewTitle").textContent="求職者";
    $("viewDescription").textContent="求職者を検索・編集できます。";
    $("searchInput").placeholder="名前・駅・会社・進捗を検索";
    $("regionFilter").disabled=false;
  }else if(state.view==="progress"){
    $("viewTitle").textContent="案件進捗";
    $("viewDescription").textContent="案件状況を検索・編集できます。";
    $("searchInput").placeholder="氏名・会社・案件進捗を検索";
    $("regionFilter").disabled=true;
  }
}

async function loadCurrent(){
  if($("appPanel").hidden)return;
  showLoading();
  try{
    const p={q:$("searchInput").value,staff:$("staffFilter").value};
    if(state.view==="home"){
      state.today=await apiGet("today");
      renderToday(state.today);
    }else if(state.view==="candidates"){
      p.region=$("regionFilter").value;
      state.candidates=await apiGet("candidates",p);
      renderCandidates(state.candidates);
    }else{
      state.progress=await apiGet("progress",p);
      renderProgress(state.progress);
    }
    loadDashboard();
  }catch(e){showError(e)}
}

function renderCandidates(items){
  setStatus(`${items.length}件`);if(!items.length)return showEmpty();
  $("cards").innerHTML=items.map((x,i)=>`<article class="card clickable" onclick="openCandidate(${i})"><h3>${esc(x.name)}</h3><span class="badge">${esc(x.region)}</span><span class="badge">${esc(x.progress||"進捗未設定")}</span><div class="details">${rows([["担当者",x.staff],["最寄駅",`${x.station||""}${x.prefecture?`（${x.prefecture}）`:""}`],["提案元会社",x.company],["希望単価",x.price],["キャリア",x.career],["経験値",x.experience],["開始希望",x.startDate],["更新日",x.updateDate]])}</div>${x.remarks?`<div class="remarks">${esc(x.remarks)}</div>`:""}<div class="hint">タップして編集</div></article>`).join("");
}

function renderProgress(items){
  setStatus(`${items.length}件`);if(!items.length)return showEmpty();
  $("cards").innerHTML=items.map((x,i)=>`<article class="card clickable" onclick="openProgress(${i})"><h3>${esc(x.name||"名前未入力")}</h3><span class="badge">${esc(x.status||"進捗未設定")}</span><div class="details">${rows([["人員担当者",x.staff],["所属会社",x.company],["案件担当者",x.projectStaff],["上位会社",x.upperCompany],["エリア",x.area],["エントリー月",x.entryMonth]])}</div>${x.remarks?`<div class="remarks">${esc(x.remarks)}</div>`:""}<div class="hint">タップして編集</div></article>`).join("");
}

function renderToday(items){
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
function openCandidate(i){state.selected={type:"candidate",item:state.candidates[i]};$("modalTitle").textContent="求職者を編集";$("copyProposalBtn").hidden=false;buildCandidateForm(state.selected.item);openModal()}
function openProgress(i){state.selected={type:"progress",item:state.progress[i]};$("modalTitle").textContent="案件進捗を編集";$("copyProposalBtn").hidden=true;buildProgressForm(state.selected.item);openModal()}

function field(id,label,value,type="text",options=null,full=false){
  const cls=full?' class="full"':"";
  if(options)return `<label${cls}>${label}<select id="${id}">${options.map(v=>`<option value="${esc(v)}"${v===value?" selected":""}>${esc(v)}</option>`).join("")}</select></label>`;
  if(type==="textarea")return `<label${cls}>${label}<textarea id="${id}">${esc(value||"")}</textarea></label>`;
  return `<label${cls}>${label}<input id="${id}" type="${type}" value="${esc(value||"")}"></label>`;
}

function buildCandidateForm(x){
  $("formFields").innerHTML=
    field("fStaff","担当者",x.staff,"text",["","山本","白木","吉本","荒井","森田","長崎","上澤","山田"])+
    field("fName","名前",x.name)+field("fPref","都道府県",x.prefecture)+field("fStation","最寄駅",x.station)+
    field("fCompany","提案元会社",x.company)+field("fPrice","希望単価",x.price)+
    field("fCareer","キャリア",x.career,"text",["","SB/Y","au/UQ","docomo","楽天"])+
    field("fExp","経験値",x.experience,"text",["","通信経験者","通信未経験","通信微経験","コール経験者","コール未経験"])+
    field("fStart","開始希望",x.startDate)+field("fProg","進捗",x.progress)+
    field("fMove","移動型可否",x.moveType,"text",["","○","×","距離次第"])+field("fRemarks","備考",x.remarks,"textarea",null,true);
}

function progressStatusOptions(current){
  const values=["",...(state.progressStatuses||[])];
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
  e.preventDefault();setMsg("modalMessage","保存中...");
  try{
    if(state.selected.type==="candidate"){
      const x=state.selected.item;
      await apiPost("updateCandidate",{sheetName:x.sheetName,rowNumber:x.rowNumber,originalName:x.name,staff:v("fStaff"),name:v("fName"),prefecture:v("fPref"),station:v("fStation"),company:v("fCompany"),price:v("fPrice"),career:v("fCareer"),experience:v("fExp"),startDate:v("fStart"),progress:v("fProg"),moveType:v("fMove"),remarks:v("fRemarks")});
    }else{
      const x=state.selected.item;
      await apiPost("updateProgress",{rowNumber:x.rowNumber,originalName:x.name,entryMonth:v("fEntry"),staff:v("fStaff"),company:v("fCompany"),name:v("fName"),projectStaff:v("fProjectStaff"),upperCompany:v("fUpper"),status:v("fStatus"),area:v("fArea"),remarks:v("fRemarks")});
    }
    setMsg("modalMessage","更新しました。","success");setTimeout(()=>{closeModal();loadCurrent()},500);
  }catch(err){setMsg("modalMessage",err.message,"error")}
}

async function copyProposal(){try{const p={station:v("fStation"),prefecture:v("fPref"),career:v("fCareer"),experience:v("fExp"),remarks:v("fRemarks"),startDate:v("fStart"),price:v("fPrice")};const text=await apiPost("proposalText",p);await navigator.clipboard.writeText(text);setMsg("modalMessage","紹介文をコピーしました。","success")}catch(e){setMsg("modalMessage",e.message,"error")}}
function v(id){return $(id)?.value||""}
function openModal(){$("modal").hidden=false;document.body.style.overflow="hidden";setMsg("modalMessage","")}
function closeModal(){$("modal").hidden=true;document.body.style.overflow=""}
function showLoading(){setStatus("");$("cards").innerHTML='<div class="loading">読み込み中です...</div>'}
function showEmpty(t="該当するデータはありません。"){$("cards").innerHTML=`<div class="empty">${esc(t)}</div>`}
function showError(e){$("cards").innerHTML=`<div class="error">${esc(e.message||String(e))}</div>`}
function setStatus(t){$("status").textContent=t||""}
function setMsg(id,t,type=""){$(id).textContent=t||"";$(id).className="message"+(type?" "+type:"")}
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
