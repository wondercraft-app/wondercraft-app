const state={view:"candidates",candidates:[],progress:[],today:[],selected:null};
const $=id=>document.getElementById(id);
const config=window.WONDERCRAFT_CONFIG||{};
let debounceTimer;

window.addEventListener("load",()=>{
  setTimeout(()=>{$("splash")?.classList.add("hide");setTimeout(()=>$("splash")?.remove(),450)},900);
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  bindEvents();
  initialize();
});

function bindEvents(){
  $("saveSetupBtn").onclick=saveSetup;
  $("settingsBtn").onclick=showSetup;
  $("reloadBtn").onclick=loadCurrent;
  $("searchInput").addEventListener("input",()=>{clearTimeout(debounceTimer);debounceTimer=setTimeout(loadCurrent,350)});
  $("staffFilter").onchange=loadCurrent;
  $("regionFilter").onchange=loadCurrent;
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModal);
  $("editForm").onsubmit=saveEdit;
  $("copyProposalBtn").onclick=copyProposal;
}

function initialize(){
  const api=localStorage.getItem("wc_api_url")||config.GAS_API_URL||"";
  const pin=localStorage.getItem("wc_pin")||"";
  if(!api||!pin)return showSetup();
  $("appPanel").hidden=false;
  $("setupPanel").hidden=true;
  loadFilters();
  loadDashboard();
  loadCurrent();
}

function showSetup(){
  $("appPanel").hidden=true;$("setupPanel").hidden=false;
  $("apiUrlInput").value=localStorage.getItem("wc_api_url")||config.GAS_API_URL||"";
  $("pinInput").value=localStorage.getItem("wc_pin")||"";
}

async function saveSetup(){
  const api=$("apiUrlInput").value.trim().replace(/\/+$/,"");
  const pin=$("pinInput").value.trim();
  if(!api||!pin)return setMsg("setupMessage","URLとPINを入力してください。","error");
  setMsg("setupMessage","接続確認中...");
  try{
    const res=await apiGet("dashboard",{},api,pin);
    localStorage.setItem("wc_api_url",api);localStorage.setItem("wc_pin",pin);
    setMsg("setupMessage","接続できました。","success");
    $("appPanel").hidden=false;$("setupPanel").hidden=true;
    await loadFilters();renderDashboard(res);await loadCurrent();
  }catch(e){setMsg("setupMessage",e.message,"error")}
}

function getApi(){return localStorage.getItem("wc_api_url")||config.GAS_API_URL||""}
function getPin(){return localStorage.getItem("wc_pin")||""}

async function apiGet(action,params={},api=getApi(),pin=getPin()){
  const url=new URL(api);
  url.searchParams.set("api","1");url.searchParams.set("action",action);url.searchParams.set("pin",pin);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&String(v)!=="")url.searchParams.set(k,v)});
  const r=await fetch(url.toString(),{redirect:"follow",cache:"no-store"});
  const j=await r.json();
  if(!j.success)throw new Error(j.error||"APIエラー");
  return j.data;
}

async function apiPost(action,payload){
  const r=await fetch(getApi(),{
    method:"POST",redirect:"follow",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({wc_api:true,action,pin:getPin(),payload})
  });
  const j=await r.json();
  if(!j.success)throw new Error(j.error||"APIエラー");
  return j.data;
}

async function loadFilters(){
  try{
    const o=await apiGet("filters");
    fillSelect("staffFilter",o.staff||[],"担当者：全員");
    fillSelect("regionFilter",o.regions||[],"地域：すべて");
  }catch(e){showError(e)}
}

function fillSelect(id,items,first){
  const el=$(id),old=el.value;el.innerHTML=`<option value="">${first}</option>`;
  items.forEach(v=>el.insertAdjacentHTML("beforeend",`<option value="${esc(v)}">${esc(v)}</option>`));el.value=old;
}

async function loadDashboard(){try{renderDashboard(await apiGet("dashboard"))}catch(e){showError(e)}}
function renderDashboard(d){$("countCandidates").textContent=d.candidates??"-";$("countProgress").textContent=d.progress??"-";$("countToday").textContent=d.todayInterviews??"-";$("countWaiting").textContent=d.waitingCandidates??"-"}

function switchView(view){
  state.view=view;
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("regionFilter").disabled=view!=="candidates";
  loadCurrent();
}

async function loadCurrent(){
  if($("appPanel").hidden)return;
  showLoading();
  try{
    const p={q:$("searchInput").value,staff:$("staffFilter").value};
    if(state.view==="candidates"){p.region=$("regionFilter").value;state.candidates=await apiGet("candidates",p);renderCandidates(state.candidates)}
    else if(state.view==="progress"){state.progress=await apiGet("progress",p);renderProgress(state.progress)}
    else{state.today=await apiGet("today");renderToday(state.today)}
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
  setStatus(`${items.length}件`);if(!items.length)return showEmpty("本日の面談はありません。");
  $("cards").innerHTML=items.map(x=>`<article class="card"><h3>${esc(x.name||"名前未入力")}</h3><span class="badge">${esc(x.interviewDate)}</span><span class="badge">${esc(x.status||"進捗未設定")}</span><div class="details">${rows([["担当者",x.staff],["案件担当者",x.projectStaff],["会社",x.company]])}</div>${x.remarks?`<div class="remarks">${esc(x.remarks)}</div>`:""}</article>`).join("");
}

function rows(arr){return arr.map(([a,b])=>`<div class="label">${esc(a)}</div><div>${esc(b||"")}</div>`).join("")}
function openCandidate(i){state.selected={type:"candidate",item:state.candidates[i]};$("modalTitle").textContent="求職者を編集";$("copyProposalBtn").hidden=false;buildCandidateForm(state.selected.item);openModal()}
function openProgress(i){state.selected={type:"progress",item:state.progress[i]};$("modalTitle").textContent="案件進捗を編集";$("copyProposalBtn").hidden=true;buildProgressForm(state.selected.item);openModal()}

function field(id,label,value,type="text",options=null,full=false){
  const cls=full?" class=\"full\"":"";
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

function buildProgressForm(x){
  $("formFields").innerHTML=field("fEntry","エントリー月",x.entryMonth)+
  field("fStaff","人員担当者",x.staff,"text",["","山本","白木","吉本","荒井","森田","長崎","上澤","山田"])+
  field("fCompany","所属会社",x.company)+field("fName","名前",x.name)+
  field("fProjectStaff","案件担当者",x.projectStaff,"text",["","山本","白木","吉本","荒井","森田","長崎","上澤","山田"])+
  field("fUpper","上位会社",x.upperCompany)+field("fStatus","案件進捗",x.status)+field("fArea","エリア",x.area)+field("fRemarks","備考",x.remarks,"textarea",null,true);
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

async function copyProposal(){
  try{
    const p={station:v("fStation"),prefecture:v("fPref"),career:v("fCareer"),experience:v("fExp"),remarks:v("fRemarks"),startDate:v("fStart"),price:v("fPrice")};
    const text=await apiPost("proposalText",p);await navigator.clipboard.writeText(text);setMsg("modalMessage","紹介文をコピーしました。","success");
  }catch(e){setMsg("modalMessage",e.message,"error")}
}

function v(id){return $(id)?.value||""}
function openModal(){$("modal").hidden=false;document.body.style.overflow="hidden";setMsg("modalMessage","")}
function closeModal(){$("modal").hidden=true;document.body.style.overflow=""}
function showLoading(){setStatus("");$("cards").innerHTML='<div class="loading">読み込み中です...</div>'}
function showEmpty(t="該当するデータはありません。"){$("cards").innerHTML=`<div class="empty">${esc(t)}</div>`}
function showError(e){$("cards").innerHTML=`<div class="error">${esc(e.message||String(e))}</div>`}
function setStatus(t){$("status").textContent=t||""}
function setMsg(id,t,type=""){$(id).textContent=t||"";$(id).className="message"+(type?" "+type:"")}
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
