const CPM = [
  .094,.135137432,.16639787,.192650919,.21573247,.236572661,.25572005,.273530381,.29024988,.306057377,
  .3210876,.335445036,.34921268,.362457751,.3752356,.387592406,.39956728,.411193551,.4225,.432926419,
  .44310755,.453059958,.4627984,.472336083,.48168495,.4908558,.49985844,.508701765,.51739395,.525942511,
  .5343543,.542635767,.5507927,.558830576,.5667545,.574569153,.5822789,.589887917,.5974,.604818814,
  .6121573,.619404122,.6265671,.633649143,.64065295,.647580967,.65443563,.661219252,.667934,.674581896,
  .6811649,.687684904,.69414365,.70054287,.7068842,.713169109,.7193991,.725575614,.7317,.734741009,
  .7377695,.740785574,.74378943,.746781211,.74976104,.752729087,.7556855,.758630378,.76156384,.764486065,
  .76739717,.770297266,.7731865,.776064962,.77893275,.781790055,.784637,.787473578,.7903,.792803968,
  .79530001,.797803921,.8003,.802799995,.8053,.8078,.81029999,.812799985,.81529999,.81779999,
  .82029999,.82279999,.82529999,.82779999,.83029999,.83279999,.83529999,.83779999,.84029999
];

const TYPE_ORDER = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
const TYPE_KO = {normal:'노말',fire:'불꽃',water:'물',electric:'전기',grass:'풀',ice:'얼음',fighting:'격투',poison:'독',ground:'땅',flying:'비행',psychic:'에스퍼',bug:'벌레',rock:'바위',ghost:'고스트',dragon:'드래곤',dark:'악',steel:'강철',fairy:'페어리'};
const LEAGUES = {great:{name:'슈퍼리그',cap:1500,key:'great'},ultra:{name:'하이퍼리그',cap:2500,key:'ultra'},master:{name:'마스터리그',cap:Infinity,key:'master'}};
const FORM_LABEL_KO = {normal:'기본',alola:'알로라',galarian:'가라르',hisuian:'히스이',paldea:'팔데아',male:'수컷',female:'암컷',attack:'어택폼',defense:'디펜스폼',speed:'스피드폼',altered:'어나더폼',origin:'오리진폼',incarnate:'화신폼',therian:'영물폼',plant:'초목도롱',sandy:'모래땅도롱',trash:'슈레도롱',meteor:'유성폼',core:'코어폼',ice_rider:'백마 탄 모습'};

const state = {pokemon:[],byKey:new Map(),byDex:new Map(),defaultByDex:new Map(),pvp:null,selected:null,query:'',type:'',generation:'',feature:'',limit:36,mode:'great',ivs:{attack:10,defense:10,stamina:10},level:20,maxEligible:false,ivCache:new Map(),dataDate:''};
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const els = {search:$('#searchInput'),type:$('#typeFilter'),generation:$('#generationFilter'),feature:$('#featureFilter'),list:$('#pokemonList'),count:$('#resultCount'),loadMore:$('#loadMore'),detail:$('#detailPanel')};

function esc(value='') { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function normalize(value='') { return String(value).toLocaleLowerCase('ko').replace(/[\s._'’\-♀♂:()]/g,''); }
function padDex(value) { return `#${String(value).padStart(4,'0')}`; }
function typeAttrs(type) { return `data-type="${esc(type.id || type)}"`; }
function typePills(pokemon) { return pokemon.types.map(type => `<span class="type-pill" ${typeAttrs(type)}>${esc(type.ko)}</span>`).join(''); }
function isMaxCapable(pokemon) { return pokemon.maxCapable ?? (pokemon.dynamax || pokemon.gigantamax); }
function featurePills(pokemon) {
  const output=[];
  if (pokemon.mega.length) output.push('<span class="capability-pill">MEGA</span>');
  if (pokemon.dynamax) output.push('<span class="capability-pill max">DYNAMAX</span>');
  if (pokemon.gigantamax) output.push('<span class="capability-pill max">GIGANTAMAX</span>');
  return output.join('');
}
function formLabel(pokemon) {
  if(pokemon.formSlug==='normal'&&(state.byDex.get(pokemon.dex)||[]).some(form=>form.formSlug==='female'))return FORM_LABEL_KO.male;
  const suffix=pokemon.name.replace(pokemon.baseName,'').replace(/[()]/g,'').trim();
  return FORM_LABEL_KO[pokemon.formSlug]||suffix||pokemon.formSlug.replaceAll('_',' ');
}
function displayName(pokemon) {
  if(pokemon.isDefault&&pokemon.formSlug==='normal'&&formLabel(pokemon)==='기본')return pokemon.name;
  return pokemon.name===pokemon.baseName?`${pokemon.name} (${formLabel(pokemon)})`:pokemon.name;
}
function formSwitcherHtml(pokemon) {
  const forms=state.byDex.get(pokemon.dex)||[];
  if(forms.length<2)return'';
  return `<div class="form-switch" aria-label="${esc(pokemon.baseName)} 폼 선택">${forms.map(form=>`<button type="button" class="form-chip ${form.speciesKey===pokemon.speciesKey?'active':''}" data-select-key="${esc(form.speciesKey)}" aria-pressed="${form.speciesKey===pokemon.speciesKey}">${esc(formLabel(form))}</button>`).join('')}</div>`;
}

async function init() {
  try {
    const [pokemonResponse,pvpResponse] = await Promise.all([fetch('data/pokemon.json'),fetch('data/pvp.json')]);
    if (!pokemonResponse.ok || !pvpResponse.ok) throw new Error('도감 데이터 응답을 받지 못했습니다.');
    const pokemonData=await pokemonResponse.json(); state.pvp=await pvpResponse.json();
    state.pokemon=pokemonData.pokemon.sort((a,b)=>a.dex-b.dex||Number(b.isDefault)-Number(a.isDefault)||a.name.localeCompare(b.name,'ko')); state.dataDate=pokemonData.updated;
    state.byKey=new Map(state.pokemon.map(pokemon=>[pokemon.speciesKey,pokemon]));
    for(const pokemon of state.pokemon){if(!state.byDex.has(pokemon.dex))state.byDex.set(pokemon.dex,[]);state.byDex.get(pokemon.dex).push(pokemon);if(pokemon.isDefault)state.defaultByDex.set(pokemon.dex,pokemon);}
    buildMoveIndex(); populateFilters(); bindGlobalEvents(); renderList();
    const route=new URLSearchParams(location.hash.slice(1)).get('pokemon'),key=resolvePokemonKey(route),hasRoute=Boolean(key);
    selectPokemon(key||state.defaultByDex.get(1)?.speciesKey,false);
    if(!hasRoute)document.body.classList.remove('show-detail');
  } catch (error) {
    console.error(error.stack || error);
    els.detail.innerHTML=`<div class="detail-loading"><div class="loader-ball"></div><p>${esc(error.message)}<br>GitHub Pages 또는 로컬 웹 서버에서 다시 열어주세요.</p></div>`;
    els.count.textContent='데이터 로드 실패';
  }
}

function buildMoveIndex() {
  state.moveById=new Map();
  for (const pokemon of state.pokemon) for (const kind of ['fast','charged']) for (const move of pokemon.moves[kind]) {
    const current=state.moveById.get(move.id);
    if (!current || (current.elite && !move.elite)) state.moveById.set(move.id,move);
  }
}

function populateFilters() {
  els.type.insertAdjacentHTML('beforeend',TYPE_ORDER.map(type=>`<option value="${type}">${TYPE_KO[type]}</option>`).join(''));
  const generations=[...new Set(state.pokemon.map(p=>p.generation).filter(Boolean))].sort((a,b)=>a-b);
  els.generation.insertAdjacentHTML('beforeend',generations.map(gen=>`<option value="${gen}">${gen}세대</option>`).join(''));
}

function bindGlobalEvents() {
  els.search.addEventListener('input',()=>{state.query=els.search.value;state.limit=36;renderList();});
  els.type.addEventListener('change',()=>{state.type=els.type.value;state.limit=36;renderList();});
  els.generation.addEventListener('change',()=>{state.generation=els.generation.value;state.limit=36;renderList();});
  els.feature.addEventListener('change',()=>{state.feature=els.feature.value;state.limit=36;renderList();});
  $('#clearFilters').addEventListener('click',()=>{state.query=state.type=state.generation=state.feature='';els.search.value=els.type.value=els.generation.value=els.feature.value='';state.limit=36;renderList();});
  els.loadMore.addEventListener('click',()=>{state.limit+=36;renderList();});
  els.list.addEventListener('click',event=>{const button=event.target.closest('[data-select-key]');if(button)navigateTo(button.dataset.selectKey);});
  els.detail.addEventListener('click',handleDetailClick);
  $('#openGuide').addEventListener('click',()=>$('#guideDialog').showModal());
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!/input|select|textarea/i.test(document.activeElement.tagName)){event.preventDefault();els.search.focus();}});
  window.addEventListener('hashchange',()=>{const key=resolvePokemonKey(new URLSearchParams(location.hash.slice(1)).get('pokemon'));if(key)selectPokemon(key,false);else document.body.classList.remove('show-detail');});
}

function filteredPokemon() {
  const query=normalize(state.query); const numeric=state.query.trim().replace(/^#/,'');
  return state.pokemon.filter(pokemon=>{
    const matchesQuery=!query||normalize(displayName(pokemon)).includes(query)||normalize(formLabel(pokemon)).includes(query)||normalize(pokemon.name).includes(query)||normalize(pokemon.en).includes(query)||normalize(pokemon.baseName).includes(query)||normalize(pokemon.baseEn).includes(query)||normalize(pokemon.formId).includes(query)||(numeric&&String(pokemon.dex).startsWith(numeric));
    const matchesType=!state.type||pokemon.types.some(type=>type.id===state.type);
    const matchesGeneration=!state.generation||String(pokemon.generation)===state.generation;
    const matchesFeature=!state.feature||(state.feature==='mega'&&pokemon.mega.length)||(state.feature==='dynamax'&&pokemon.dynamax)||(state.feature==='gigantamax'&&pokemon.gigantamax)||(state.feature==='legendary'&&['legendary','mythic'].includes(pokemon.class));
    return matchesQuery&&matchesType&&matchesGeneration&&matchesFeature;
  });
}

function renderList() {
  const results=filteredPokemon(),visible=results.slice(0,state.limit);
  els.count.textContent=`${results.length.toLocaleString('ko-KR')}개 폼`;
  els.loadMore.hidden=visible.length>=results.length;
  els.list.innerHTML=visible.length?visible.map(pokemon=>{
    const dots=pokemon.types.map(type=>`<i class="mini-type" ${typeAttrs(type)} title="${esc(type.ko)}"></i>`).join('');
    return `<button type="button" class="pokemon-row ${state.selected?.speciesKey===pokemon.speciesKey?'active':''}" data-select-key="${esc(pokemon.speciesKey)}" role="option" aria-selected="${state.selected?.speciesKey===pokemon.speciesKey}">
      <img class="pokemon-thumb" src="${esc(pokemon.image||'')}" alt="" loading="lazy"><span><strong>${esc(displayName(pokemon))}</strong><small>${padDex(pokemon.dex)} · ${esc(pokemon.en)}</small><span class="mini-types">${dots}</span></span>
      <span class="row-features">${pokemon.mega.length?'<i class="feature-dot">M</i>':''}${pokemon.gigantamax?'<i class="feature-dot max">GMAX</i>':pokemon.dynamax?'<i class="feature-dot max">MAX</i>':''}</span></button>`;
  }).join(''):'<p class="role-summary">조건에 맞는 포켓몬이 없습니다. 이름이나 필터를 바꿔보세요.</p>';
}

function resolvePokemonKey(value) {
  if(value&&state.byKey.has(value))return value;
  const dex=Number(value);return Number.isInteger(dex)?state.defaultByDex.get(dex)?.speciesKey:null;
}
function navigateTo(value) { const key=resolvePokemonKey(value);if(!key)return;const current=new URLSearchParams(location.hash.slice(1)).get('pokemon');if(current===key)selectPokemon(key,false);else location.hash=`pokemon=${encodeURIComponent(key)}`; }
function selectPokemon(value,updateHash=true) {
  const key=resolvePokemonKey(value),pokemon=state.byKey.get(key); if(!pokemon)return;
  state.selected=pokemon; state.maxEligible=false; state.mode='great';
  if(updateHash) history.pushState(null,'',`#pokemon=${encodeURIComponent(key)}`);
  renderList(); renderDetail(); document.body.classList.add('show-detail');
  if(innerWidth<=760) scrollTo({top:0,behavior:'auto'});
}

function getFamilyLevels(pokemon) {
  const parents=new Map();
  for(const item of state.pokemon) for(const evolution of item.evolutions) {
    if(!parents.has(evolution.speciesKey))parents.set(evolution.speciesKey,[]); parents.get(evolution.speciesKey).push(item.speciesKey);
  }
  const family=new Set([pokemon.speciesKey]),queue=[pokemon.speciesKey];
  while(queue.length){const key=queue.shift(),item=state.byKey.get(key);for(const next of [...(item?.evolutions.map(e=>e.speciesKey)||[]),...(parents.get(key)||[])])if(!family.has(next)){family.add(next);queue.push(next);}}
  const roots=[...family].filter(key=>!(parents.get(key)||[]).some(parent=>family.has(parent)));
  const levels=[],seen=new Set(),frontier=[...roots];
  while(frontier.length){const keyLevel=[...new Set(frontier)].filter(key=>!seen.has(key));if(!keyLevel.length)break;const level=keyLevel.map(key=>state.byKey.get(key)).filter(Boolean);levels.push(level);level.forEach(item=>seen.add(item.speciesKey));frontier.splice(0,frontier.length,...level.flatMap(item=>item.evolutions.map(e=>e.speciesKey).filter(key=>family.has(key))));}
  return levels;
}

function finalEvolutions(pokemon) {
  const finals=[],seen=new Set();
  function walk(item){if(!item||seen.has(item.speciesKey))return;seen.add(item.speciesKey);const next=item.evolutions.map(e=>state.byKey.get(e.speciesKey)).filter(Boolean);if(!next.length)finals.push(item);else next.forEach(walk);}
  walk(pokemon); return finals.length?finals:[pokemon];
}

function archetype(pokemon) {
  const {attack,defense,stamina}=pokemon.stats;
  if(attack>=defense*1.2&&attack>=stamina*1.08)return{key:'attack',name:'공격형',text:'높은 공격 종족값을 살리는 포켓몬입니다. PvE와 맥스 공격수에서는 공격 IV와 기술 타입을 먼저 보세요.'};
  if(defense>=attack*1.16)return{key:'defense',name:'방어형',text:'방어 종족값이 강점입니다. 제한 리그와 맥스 탱커에서 방어·HP를 확보할수록 오래 역할을 수행합니다.'};
  if(stamina>=attack*1.35&&stamina>=defense*1.25)return{key:'stamina',name:'체력형',text:'큰 HP 풀이 강점입니다. PvP의 능력치 곱과 맥스 스피릿을 활용하는 서포터 역할을 함께 확인하세요.'};
  return{key:'balanced',name:'균형형',text:'공격과 내구가 비교적 고르게 분배되어 있습니다. 용도별 추천 기술과 리그별 IV 순위를 함께 보는 것이 중요합니다.'};
}

function evolutionHtml(pokemon) {
  const levels=getFamilyLevels(pokemon);
  return levels.map((level,index)=>`${index?'<span class="evo-arrow">→</span>':''}<span class="evo-stage">${level.map(item=>`<button type="button" class="evo-link ${item.speciesKey===pokemon.speciesKey?'current':''}" data-select-key="${esc(item.speciesKey)}"><img src="${esc(item.image||'')}" alt=""><strong>${esc(displayName(item))}</strong></button>`).join('')}</span>`).join('');
}

function renderDetail() {
  const p=state.selected,role=archetype(p),maxStat=Math.max(p.stats.attack,p.stats.defense,p.stats.stamina,300);
  const stat=(label,key)=>`<div class="stat-box"><span>${label}</span><strong>${p.stats[key]}</strong><div class="stat-bar"><i style="width:${Math.round(p.stats[key]/maxStat*100)}%"></i></div></div>`;
  els.detail.innerHTML=`
    <button type="button" class="mobile-back" data-mobile-back>← 도감으로</button>
    <article class="hero-card"><div class="hero-copy"><span class="dex-number">${padDex(p.dex)} · GENERATION ${p.generation||'–'}</span><h2>${esc(displayName(p))}</h2><p class="english-name">${esc(p.en)}</p><div class="type-row">${typePills(p)}</div><div class="capability-row">${featurePills(p)}</div>${formSwitcherHtml(p)}</div><img class="hero-art" src="${esc(p.image||'')}" alt="${esc(displayName(p))}"></article>
    <div class="detail-grid">
      <section class="panel panel-pad"><div class="section-label"><div><h3>기본 능력치</h3><p>IV를 더하기 전 Pokémon GO 종족값</p></div><span class="score-pill">${role.name}</span></div><div class="stats-grid">${stat('공격','attack')}${stat('방어','defense')}${stat('체력','stamina')}</div><p class="role-summary">${role.text}</p></section>
      <section class="panel panel-pad"><div class="section-label"><div><h3>진화 계보</h3><p>같은 IV와 강화 레벨을 유지해 각각 다시 계산합니다</p></div></div><div class="evolution-chain">${evolutionHtml(p)}</div></section>
      <section class="panel iv-lab">
        <div class="iv-head"><div><h3>내 개체의 가치</h3><p>공격·방어·체력 슬라이더를 움직이면 즉시 다시 계산합니다.</p></div><div class="appraisal"><b id="appraisalStars">–</b><span id="appraisalPercent">–</span></div></div>
        <div class="mode-tabs" role="tablist"><button class="mode-tab active" data-mode="great">슈퍼리그</button><button class="mode-tab" data-mode="ultra">하이퍼리그</button><button class="mode-tab" data-mode="master">마스터리그</button><button class="mode-tab" data-mode="pve">레이드 PvE</button><button class="mode-tab" data-mode="max">맥스배틀</button></div>
        <div class="iv-content"><div class="slider-panel">
          ${ivSlider('공격','attack')}${ivSlider('방어','defense')}${ivSlider('체력','stamina')}
          <div class="level-row"><p class="level-hint">현재 강화 레벨을 알면 진화 후 즉시 사용 가능 여부도 확인할 수 있어요.</p>${levelSlider()}</div>
          <label class="max-toggle" id="maxToggle" hidden><input id="maxEligible" type="checkbox"><span><strong>이 개체는 맥스 포켓몬입니다</strong><span>같은 종이라도 맥스배틀/특별 리서치 출신 개체만 입장할 수 있어요.</span></span></label>
        </div><div class="result-card" id="ivResult"></div></div>
        <div class="projection"><h4>같은 IV로 진화하면</h4><div class="projection-grid" id="projectionGrid"></div></div>
      </section>
      <section class="panel panel-pad full-panel"><div class="section-label"><div><h3>추천 기술 구성</h3><p>PvP는 현재 메타, PvE는 중립 대상 이론 사이클 기준</p></div></div><div class="moves-grid">${moveSetsHtml(p)}</div></section>
      <section class="panel panel-pad full-panel"><div class="section-label"><div><h3>메가진화와 맥스배틀 영향</h3><p>일반 진화와 구분되는 일시적·개체별 전투 형태</p></div></div><div class="transform-grid">${transformationHtml(p)}</div><span class="data-date">도감 ${esc(state.dataDate)} · PvP ${esc(String(state.pvp.updated||'').slice(0,10))} 기준</span></section>
    </div>`;
  bindIvEvents(); updateIvResults();
}

function ivSlider(label,key) { return `<div class="iv-slider"><label for="iv-${key}">${label}</label><input id="iv-${key}" data-iv="${key}" type="range" min="0" max="15" value="${state.ivs[key]}" aria-label="${label} 개체값"><output id="out-${key}">${state.ivs[key]}</output></div>`; }
function levelSlider() { return `<div class="iv-slider"><label for="levelInput">레벨</label><input id="levelInput" type="range" min="1" max="50" step="0.5" value="${state.level}" aria-label="현재 포켓몬 레벨"><output id="levelOutput">${state.level}</output></div>`; }

function bindIvEvents() {
  $$('[data-iv]',els.detail).forEach(input=>input.addEventListener('input',()=>{state.ivs[input.dataset.iv]=Number(input.value);$(`#out-${input.dataset.iv}`).value=input.value;updateIvResults();}));
  $('#levelInput').addEventListener('input',event=>{state.level=Number(event.target.value);$('#levelOutput').value=event.target.value;updateIvResults();});
  $('#maxEligible').addEventListener('change',event=>{state.maxEligible=event.target.checked;updateIvResults();});
}

function handleDetailClick(event) {
  const select=event.target.closest('[data-select-key]'); if(select){navigateTo(select.dataset.selectKey);return;}
  if(event.target.closest('[data-mobile-back]')){history.replaceState(null,'',`${location.pathname}${location.search}`);document.body.classList.remove('show-detail');return;}
  const mode=event.target.closest('[data-mode]'); if(mode){state.mode=mode.dataset.mode;$$('[data-mode]',els.detail).forEach(button=>button.classList.toggle('active',button.dataset.mode===state.mode));$('#maxToggle').hidden=state.mode!=='max';updateIvResults();}
}

function cpmAt(level) { return CPM[Math.max(0,Math.min(CPM.length-1,Math.round((level-1)*2)))]; }
function statsAt(pokemon,ivs,level) {
  const cpm=cpmAt(level),attack=(pokemon.stats.attack+ivs.attack)*cpm,defense=(pokemon.stats.defense+ivs.defense)*cpm,hp=Math.max(10,Math.floor((pokemon.stats.stamina+ivs.stamina)*cpm));
  const cp=Math.max(10,Math.floor((pokemon.stats.attack+ivs.attack)*Math.sqrt(pokemon.stats.defense+ivs.defense)*Math.sqrt(pokemon.stats.stamina+ivs.stamina)*cpm*cpm/10));
  return{attack,defense,hp,cp,product:attack*defense*hp,level};
}

function bestUnderCap(pokemon,ivs,cap) {
  if(cap===Infinity)return statsAt(pokemon,ivs,50);
  let low=0,high=CPM.length-1,best=0;
  while(low<=high){const mid=(low+high)>>1,level=1+mid/2,result=statsAt(pokemon,ivs,level);if(result.cp<=cap){best=mid;low=mid+1;}else high=mid-1;}
  return statsAt(pokemon,ivs,1+best/2);
}

function ivRankData(pokemon,cap) {
  const key=`${pokemon.speciesKey}:${cap}`;
  if(state.ivCache.has(key)){const cached=state.ivCache.get(key);state.ivCache.delete(key);state.ivCache.set(key,cached);return cached;}
  const rows=[];
  for(let attack=0;attack<=15;attack++)for(let defense=0;defense<=15;defense++)for(let stamina=0;stamina<=15;stamina++){
    const ivs={attack,defense,stamina},best=bestUnderCap(pokemon,ivs,cap);rows.push({key:`${attack}-${defense}-${stamina}`,...best});
  }
  rows.sort((a,b)=>b.product-a.product||b.attack-a.attack||b.hp-a.hp); const byIv=new Map();
  rows.forEach((row,index)=>byIv.set(row.key,{...row,rank:index+1,percent:row.product/rows[0].product*100}));
  const value={byIv,best:rows[0]};
  if(state.ivCache.size>=12)state.ivCache.delete(state.ivCache.keys().next().value);
  state.ivCache.set(key,value); return value;
}

function appraisal() { const total=state.ivs.attack+state.ivs.defense+state.ivs.stamina;return{total,percent:total/45*100,stars:total===45?'4★':total>=37?'3★':total>=30?'2★':total>=23?'1★':'0★'}; }
function gradeClass(grade) { return grade==='S'?'':grade.toLowerCase(); }

function evaluate(pokemon,mode=state.mode) {
  const app=appraisal(),current=statsAt(pokemon,state.ivs,state.level),perfect=statsAt(pokemon,{attack:15,defense:15,stamina:15},state.level);
  if(LEAGUES[mode]){
    const league=LEAGUES[mode],rank=ivRankData(pokemon,league.cap).byIv.get(`${state.ivs.attack}-${state.ivs.defense}-${state.ivs.stamina}`);
    const grade=rank.rank<=41?'S':rank.rank<=410?'A':rank.rank<=1229?'B':'C'; const top=rank.rank/4096*100;
    const maxPerfect=bestUnderCap(pokemon,{attack:15,defense:15,stamina:15},league.cap); const uncapped=league.cap!==Infinity&&maxPerfect.level===50&&maxPerfect.cp<league.cap;
    const meta=state.pvp.leagues[league.key]?.[pokemon.speciesKey];
    let why=uncapped?`${pokemon.name}은(는) 50레벨에서도 CP 제한에 여유가 있어 낮은 공격보다 15/15/15에 가까운 개체가 유리합니다.`:`CP 제한 리그에서는 공격이 CP를 더 많이 올리므로, 공격을 낮추고 방어·체력을 높이면 더 높은 레벨과 능력치 곱을 확보하는 경우가 많습니다.`;
    if(mode==='master')why='마스터리그는 CP 제한이 없어 세 능력치를 모두 높이는 것이 원칙이며, 특히 공격 IV는 CMP 선공과 공격 breakpoint에 영향을 줄 수 있습니다.';
    why+=meta?` 현재 종족 메타 점수는 ${meta.score}점이며 추천 순위는 ${meta.rank}위입니다. 개체 순위와 종족의 메타 활용도는 서로 다른 지표입니다.`:' 현재 공개 메타 랭킹에 대표 형태가 없어 개체 순위만 판정했습니다.';
    const tooHigh=league.cap!==Infinity&&current.cp>league.cap;
    return{grade,title:`${league.name} ${grade}급 개체`,subtitle:`동종 IV ${rank.rank.toLocaleString()}위 · 상위 ${top<1?top.toFixed(1):Math.round(top)}%`,metrics:[['목표 CP',rank.cp.toLocaleString()],['도달 레벨',rank.level],['능력치 효율',`${rank.percent.toFixed(2)}%`]],explanation:why,caution:`능력치 곱 기반 일반 순위입니다. 특정 대면전의 breakpoint·bulkpoint·CMP는 달라질 수 있습니다.${tooHigh?' 현재 레벨에서 이미 리그 CP를 초과해 강화도를 낮출 수 없으므로 이 형태로는 참가할 수 없습니다.':''}`,rank};
  }
  if(mode==='pve'){
    const score=(state.ivs.attack*.5+state.ivs.defense*.25+state.ivs.stamina*.25)/15*100,grade=score>=95?'S':score>=85?'A':score>=70?'B':'C',attackLoss=(1-current.attack/perfect.attack)*100;
    return{grade,title:`레이드 공격수 ${grade}급`,subtitle:`공격 가중 IV 점수 ${score.toFixed(1)}점`,metrics:[['공격 IV',`${state.ivs.attack}/15`],['감정 IV',`${app.percent.toFixed(1)}%`],['현재 예상 CP',current.cp.toLocaleString()]],explanation:`레이드는 제한 시간 때문에 공격 IV를 먼저 봅니다. 이 개체의 같은 레벨 15공격 대비 실제 공격 손실은 약 ${attackLoss.toFixed(2)}%입니다. 방어와 체력은 차지 기술을 한 번 더 쓰는 생존 구간에서 가치가 생깁니다.`,caution:'종족값·강화 레벨·기술·보스 상성이 IV보다 영향이 큽니다. 추천 DPS는 날씨, 보스 방어, 피격 에너지와 breakpoint를 반영하지 않은 중립 이론값입니다.'};
  }
  const role=archetype(pokemon),weights=role.key==='attack'?[.5,.25,.25]:role.key==='stamina'?[.25,.3,.45]:[.3,.4,.3];
  const score=(state.ivs.attack*weights[0]+state.ivs.defense*weights[1]+state.ivs.stamina*weights[2])/15*100;
  if(!isMaxCapable(pokemon))return{grade:'–',title:'현재 맥스 미지원 종',subtitle:'확인된 Pokémon GO 맥스 개체 목록 기준',metrics:[['공격 IV',`${state.ivs.attack}/15`],['방어 IV',`${state.ivs.defense}/15`],['체력 IV',`${state.ivs.stamina}/15`]],explanation:'이 종은 현재 데이터에서 다이맥스 또는 거다이맥스 가능한 개체가 확인되지 않았습니다. 향후 맥스배틀 데뷔 시 다시 평가할 수 있습니다.',caution:'본가에서 맥스 변신이 가능한지와 Pokémon GO에서 실제 맥스 개체를 얻을 수 있는지는 다릅니다.'};
  if(!state.maxEligible)return{grade:'?',title:'맥스 개체 여부를 확인하세요',subtitle:'종이 지원돼도 일반 개체는 입장할 수 없습니다',metrics:[['종 지원','가능'],['거다이맥스',pokemon.gigantamax?'가능':'해당 없음'],['현재 예상 CP',current.cp.toLocaleString()]],explanation:'슬라이더 아래의 “이 개체는 맥스 포켓몬입니다”를 체크해야 맥스 역할별 IV 평가를 진행합니다.',caution:'맥스배틀이나 특별 리서치에서 얻은 맥스 자격은 개체 단위입니다. 같은 종의 일반 포켓몬에는 자동 적용되지 않습니다.'};
  const grade=score>=95?'S':score>=85?'A':score>=70?'B':'C',roleName=role.key==='attack'?'맥스 공격수':role.key==='stamina'?'맥스 힐러·탱커':'맥스 탱커';
  return{grade,title:`${roleName} ${grade}급`,subtitle:`역할 가중 IV 점수 ${score.toFixed(1)}점`,metrics:[['공격 IV',`${state.ivs.attack}/15`],['내구 IV',`${state.ivs.defense+state.ivs.stamina}/30`],['거다이맥스',pokemon.gigantamax?'가능':'–']],explanation:role.key==='attack'?'공격 IV와 보스 약점을 찌르는 노말 기술 타입이 핵심입니다. 맥스 어택 레벨을 올리면 IV 차이보다 큰 화력 차이가 납니다.':'방어·체력과 보스 기술 저항을 우선하세요. 맥스가드로 버티거나 맥스스피릿으로 팀을 회복시키는 역할에 적합합니다.',caution:'다이맥스 어택 타입은 현재 노말 기술 타입으로 결정됩니다. 거다이맥스는 종 고유 G-Max 기술을 사용하며, 메가진화와 맥스 변신은 동시에 사용할 수 없습니다.'};
}

function updateIvResults() {
  const p=state.selected,result=evaluate(p),app=appraisal();
  $('#appraisalStars').textContent=app.stars; $('#appraisalPercent').textContent=`${app.total}/45 · ${app.percent.toFixed(1)}%`;
  const maxToggle=$('#maxToggle'); if(maxToggle){maxToggle.hidden=state.mode!=='max';const checkbox=$('#maxEligible');checkbox.disabled=!isMaxCapable(p);checkbox.checked=state.maxEligible&&isMaxCapable(p);}
  $('#ivResult').innerHTML=`<div class="grade-row"><span class="grade ${gradeClass(result.grade)}">${result.grade}</span><div><h4>${esc(result.title)}</h4><p>${esc(result.subtitle)}</p></div></div><div class="result-metrics">${result.metrics.map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div><p class="explanation">${esc(result.explanation)}</p><p class="caution">${esc(result.caution)}</p>`;
  const finals=[...new Map([p,...finalEvolutions(p)].map(item=>[item.speciesKey,item])).values()];
  $('#projectionGrid').innerHTML=finals.map(item=>{const value=evaluate(item);return`<button type="button" class="projection-card" data-select-key="${esc(item.speciesKey)}"><img src="${esc(item.image||'')}" alt=""><span><strong>${esc(displayName(item))}</strong><small>${esc(value.title)}</small></span><b>${value.grade}</b></button>`;}).join('');
}

function moveForPokemon(pokemon,id,kind) {
  return pokemon.moves[kind].find(move=>move.id===id)||state.moveById.get(id);
}
function moveName(id,move=state.moveById.get(id)) { return move?.ko||id.toLowerCase().split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '); }
function moveLine(pokemon,id,kind,label) {
  const move=moveForPokemon(pokemon,id,kind);
  return`<div class="move-line"><span class="move-kind">${label}</span><i class="move-type" ${move?typeAttrs(move.type):''}></i><b>${esc(moveName(id,move))}</b>${move?.elite?'<span class="elite">ELITE</span>':''}</div>`;
}
function bestPve(pokemon) {
  const combos=[];
  for(const fast of pokemon.moves.fast.filter(move=>move.power>0&&move.energy>0&&move.duration>0))for(const charged of pokemon.moves.charged.filter(move=>move.power>0&&move.energy<0&&move.duration>0)){
    const count=Math.max(1,Math.ceil(Math.abs(charged.energy)/fast.energy)),fastStab=pokemon.types.some(type=>type.id===fast.type)?1.2:1,chargedStab=pokemon.types.some(type=>type.id===charged.type)?1.2:1;
    const damage=fast.power*fastStab*count+charged.power*chargedStab,duration=(fast.duration*count+charged.duration)/1000;
    combos.push({fast,charged,score:damage/duration});
  }
  return combos.sort((a,b)=>b.score-a.score)[0];
}
function pvpMoveCard(pokemon,key,label) {
  const meta=state.pvp.leagues[key]?.[pokemon.speciesKey];
  if(!meta)return`<article class="move-set"><div class="move-set-head"><strong>${label}</strong><span class="score-pill">자료 없음</span></div><p class="move-caption">현재 대표 형태가 공개 전체 랭킹에 포함되지 않았습니다.</p></article>`;
  return`<article class="move-set"><div class="move-set-head"><strong>${label}</strong><span class="score-pill">메타 ${meta.score} · #${meta.rank}</span></div>${meta.moves.map((id,index)=>moveLine(pokemon,id,index?'charged':'fast',index?'차지':'노말')).join('')}<p class="move-caption">PvPoke 전체 리그 시뮬레이션의 현재 추천입니다. 보통 차지 기술 2개 해방을 전제로 합니다.</p></article>`;
}
function moveSetsHtml(pokemon) {
  const pve=bestPve(pokemon);
  const pveCard=pve?`<article class="move-set"><div class="move-set-head"><strong>레이드 PvE</strong><span class="score-pill">중립 DPS ${pve.score.toFixed(1)}</span></div>${moveLine(pokemon,pve.fast.id,'fast','노말')}${moveLine(pokemon,pve.charged.id,'charged','차지')}<p class="move-caption">자속 보정 포함 중립 사이클 이론값입니다. 보스 타입에 맞춰 같은 타입 조합을 우선하세요.</p></article>`:`<article class="move-set"><strong>레이드 PvE</strong><p class="move-caption">현재 계산 가능한 공격 기술 조합이 없습니다.</p></article>`;
  return pvpMoveCard(pokemon,'great','PvP · 슈퍼리그')+pvpMoveCard(pokemon,'ultra','PvP · 하이퍼리그')+pvpMoveCard(pokemon,'master','PvP · 마스터리그')+pveCard;
}

function transformationHtml(pokemon) {
  const cards=[];
  for(const mega of pokemon.mega){const types=mega.types.map(type=>type.ko).join('·');cards.push(`<article class="transform-card mega"><h4>${esc(mega.name)}</h4><span class="score-pill">${esc(types)} 타입 부스트</span><div class="transform-stat"><span>공격 ${mega.stats.attack}</span><span>방어 ${mega.stats.defense}</span><span>체력 ${mega.stats.stamina}</span></div><p>메가진화 중 종족값과 타입이 이 형태로 바뀝니다. 레이드 동료의 공격을 강화하고, 메가 타입과 같은 공격은 더 큰 보너스를 받습니다. IV는 유지되므로 PvE에서는 공격 IV를 우선합니다.</p></article>`);}
  if(pokemon.mega.length)cards.push('<article class="transform-card mega"><h4>2026 메가 운용 메모</h4><p>메가진화는 일반 진화가 아닌 일시적 전투 형태입니다. 일부 대상은 슈퍼 맥스 레벨과 메가 중 추가 차지 공격을 지원하므로 게임 내 자격을 확인하세요. 일반 GO 배틀리그 사용 가능 여부는 시즌 규칙을 따릅니다.</p></article>');
  if(isMaxCapable(pokemon)){const fastTypes=[...new Map(pokemon.moves.fast.map(move=>[move.type,move])).values()].map(move=>move.typeKo).join(' · '),maxLabel=pokemon.gigantamax?(pokemon.dynamax?'다이맥스 · 거다이맥스':'거다이맥스'):'다이맥스',role=archetype(pokemon);cards.push(`<article class="transform-card max"><h4>${maxLabel} 운용</h4><span class="score-pill">${role.name}</span><div class="transform-stat"><span>맥스 어택</span><span>맥스가드</span><span>맥스스피릿</span></div><p>노말 기술 선택에 따라 다이맥스 어택 타입을 ${esc(fastTypes||'현재 기술 타입')} 중에서 바꿀 수 있습니다. ${pokemon.gigantamax?'거다이맥스 시에는 종 고유 G-Max 기술이 맥스 어택을 대신합니다. ':''}맥스 기술 레벨·보스 저항·강화 레벨이 IV보다 더 큰 영향을 줄 수 있습니다.</p></article>`);}else cards.push('<div class="empty-transform">현재 데이터에서 이 종의 맥스 개체는 확인되지 않았습니다. 일반 개체는 향후 종이 데뷔해도 자동으로 맥스 자격을 얻지 않습니다.</div>');
  return cards.join('');
}

init();
