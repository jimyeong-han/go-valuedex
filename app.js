const Mechanics = window.ValueDexMechanics;
if(!Mechanics)throw new Error('개체값 계산 모듈을 불러오지 못했습니다.');
const Collection = window.ValueDexCollection;
const APP_VERSION = '1.7.0';

const TYPE_ORDER = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
const TYPE_KO = {normal:'노말',fire:'불꽃',water:'물',electric:'전기',grass:'풀',ice:'얼음',fighting:'격투',poison:'독',ground:'땅',flying:'비행',psychic:'에스퍼',bug:'벌레',rock:'바위',ghost:'고스트',dragon:'드래곤',dark:'악',steel:'강철',fairy:'페어리'};
const LEAGUES = {great:{name:'슈퍼리그',cap:1500,key:'great'},ultra:{name:'하이퍼리그',cap:2500,key:'ultra'},master:{name:'마스터리그',cap:Infinity,key:'master'}};
const FORM_LABEL_KO = {normal:'기본',alola:'알로라',galarian:'가라르',hisuian:'히스이',paldea:'팔데아',male:'수컷',female:'암컷',attack:'어택폼',defense:'디펜스폼',speed:'스피드폼',altered:'어나더폼',origin:'오리진폼',incarnate:'화신폼',therian:'영물폼',plant:'초목도롱',sandy:'모래땅도롱',trash:'슈레도롱',meteor:'유성폼',core:'코어폼',ice_rider:'백마 탄 모습'};
const GENERATION_REGION_KO = Object.freeze({1:'관동',2:'성도',3:'호연',4:'신오',5:'하나',6:'칼로스',7:'알로라',8:'가라르',9:'팔데아'});

const state = {pokemon:[],byKey:new Map(),byDex:new Map(),defaultByDex:new Map(),pvp:null,selected:null,query:'',type:'',generation:'',feature:'',limit:36,mode:'great',ivs:{attack:10,defense:10,stamina:10},level:20,currentMoves:{fast:null,charged:[]},maxEligible:false,maxKind:'none',condition:'normal',purifyTrainerLevel:25,apex:false,training:{capType:'none',silverStat:'attack',target:{attack:10,defense:10,stamina:10},goodBuddy:false,phase:'planned'},ivCache:new Map(),utilityCache:new Map(),dataDate:'',collection:{repo:null,records:[],recovery:[],query:'',status:'',tag:'',sort:'updated',favorite:false,limit:100,compareMode:false,selectedIds:new Set(),compareView:'great',editing:null,error:'',metricCache:new Map()}};
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
    await initCollection();
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
  els.generation.insertAdjacentHTML('beforeend',generations.map(gen=>`<option value="${gen}">${gen}세대${GENERATION_REGION_KO[gen]?` (${GENERATION_REGION_KO[gen]})`:''}</option>`).join(''));
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
  bindCollectionEvents();
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
    const utility=speciesUtility(pokemon);
    return `<button type="button" class="pokemon-row ${state.selected?.speciesKey===pokemon.speciesKey?'active':''}" data-select-key="${esc(pokemon.speciesKey)}" role="option" aria-selected="${state.selected?.speciesKey===pokemon.speciesKey}">
      <img class="pokemon-thumb" src="${esc(pokemon.image||'')}" alt="" loading="lazy"><span><strong>${esc(displayName(pokemon))}</strong><small>${padDex(pokemon.dex)} · ${esc(pokemon.en)}</small><span class="mini-types">${dots}<em class="utility-mini ${utility.key}">${esc(utility.shortLabel)}</em></span></span>
      <span class="row-features">${pokemon.mega.length?'<i class="feature-dot">M</i>':''}${pokemon.gigantamax?'<i class="feature-dot max">GMAX</i>':pokemon.dynamax?'<i class="feature-dot max">MAX</i>':''}</span></button>`;
  }).join(''):'<p class="role-summary">조건에 맞는 포켓몬이 없습니다. 이름이나 필터를 바꿔보세요.</p>';
}

function resolvePokemonKey(value) {
  if(value&&state.byKey.has(value))return value;
  const dex=Number(value);return Number.isInteger(dex)?state.defaultByDex.get(dex)?.speciesKey:null;
}
function navigateTo(value) { const key=resolvePokemonKey(value);if(!key)return;const current=new URLSearchParams(location.hash.slice(1)).get('pokemon');if(current===key)selectPokemon(key,false);else location.hash=`pokemon=${encodeURIComponent(key)}`; }
function resetScenarioState() {
  state.condition='normal';state.purifyTrainerLevel=25;state.apex=false;state.maxEligible=false;state.maxKind='none';state.currentMoves={fast:null,charged:[]};
  state.training={capType:'none',silverStat:'attack',target:{...state.ivs},goodBuddy:false,phase:'planned'};
}
function selectPokemon(value,updateHash=true) {
  const key=resolvePokemonKey(value),pokemon=state.byKey.get(key); if(!pokemon)return;
  state.selected=pokemon;resetScenarioState();
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

const UTILITY_LEVEL = {collection:0,conditional:1,core:2};
const NOT_USER_OWNABLE_FORM_IDS = new Set(['890:eternamax']);
function speciesUtility(pokemon) {
  if(state.utilityCache.has(pokemon.speciesKey))return state.utilityCache.get(pokemon.speciesKey);
  const thresholds={great:{coreRank:100,coreScore:87,conditionalRank:250,conditionalScore:82},ultra:{coreRank:100,coreScore:87,conditionalRank:250,conditionalScore:82},master:{coreRank:100,coreScore:75,conditionalRank:150,conditionalScore:69}};
  const metas=Object.entries(LEAGUES).map(([key,league])=>({key,league,meta:state.pvp.leagues[key]?.[pokemon.speciesKey],threshold:thresholds[key]})).filter(value=>value.meta);
  const pvpCoreRows=metas.filter(({meta,threshold})=>meta.rank<=threshold.coreRank&&Number(meta.score)>=threshold.coreScore);
  const pvpConditionalRows=metas.filter(({meta,threshold})=>meta.rank<=threshold.conditionalRank&&Number(meta.score)>=threshold.conditionalScore);
  const bestPvp=[...pvpCoreRows,...pvpConditionalRows,...metas].sort((a,b)=>a.meta.rank-b.meta.rank||Number(b.meta.score)-Number(a.meta.score))[0];
  const profile=pveProfile(pokemon),pveIndex=(profile.raw?.score||0)*pokemon.stats.attack,coherentIndex=(profile.coherent?.score||0)*pokemon.stats.attack,bulk=pokemon.stats.defense*pokemon.stats.stamina;
  const pveCore=pveIndex>=6000&&coherentIndex>=5800&&pokemon.stats.attack>=230&&bulk>=18000;
  const pveUseful=pveIndex>=5200&&coherentIndex>=5000&&pokemon.stats.attack>=200;
  const megaIndex=Math.max(0,...pokemon.mega.map(mega=>(pveProfile(pokemon,mega.types.map(type=>type.id)).coherent?.score||0)*mega.stats.attack));
  const megaCore=megaIndex>=7400,hasMega=pokemon.mega.length>0,maxUseful=isMaxCapable(pokemon)&&(pokemon.gigantamax||pokemon.evolutions.length===0);
  const unavailable=NOT_USER_OWNABLE_FORM_IDS.has(pokemon.speciesKey);
  let key='collection';if(!unavailable&&(pvpCoreRows.length||pveCore||megaCore))key='core';else if(!unavailable&&(pvpConditionalRows.length||pveUseful||hasMega||maxUseful))key='conditional';
  const labels={core:['핵심 실전용','핵심'],conditional:['조건부 실전용','조건부'],collection:['수집·관상 중심','수집']};
  const reasons=[];
  if(unavailable)reasons.push('플레이어가 보유할 수 없는 데이터상 전투 형태');
  else {
    if((pvpCoreRows.length||pvpConditionalRows.length)&&bestPvp)reasons.push(`${bestPvp.league.name} 메타 #${bestPvp.meta.rank}`);
    if(pveCore)reasons.push('중립 레이드 화력 지수 상위권');else if(pveUseful)reasons.push('레이드 공격수 후보');
    if(megaCore)reasons.push('Mega 화력 지수 상위권');else if(hasMega)reasons.push('Mega 운용 가능');
    if(maxUseful)reasons.push('맥스 개체일 때 역할 후보');
  }
  const primaryReason=reasons[0]||'뚜렷한 상위권 지표 없음';
  const text=unavailable?'게임 데이터에는 존재하지만 플레이어 보유·투자 대상이 아닌 특수 전투 형태이므로 참고용으로만 표시합니다.':reasons.length?`${reasons.join(' · ')} 기준입니다. 실제 성능은 기술, 상대, 팀 조합과 시즌 규칙에 따라 달라지며, 일반 개체는 맥스 자격을 자동으로 얻지 않습니다.`:'현재 공개 PvP 메타와 중립 레이드 화력·Mega·Max 기준에서 뚜렷한 상위권 지표가 확인되지 않았습니다. 기술 업데이트나 다른 폼에서 평가는 달라질 수 있습니다.';
  const value={key,label:labels[key][0],shortLabel:labels[key][1],text,primaryReason,pvpRank:bestPvp?.meta.rank??Infinity,pveIndex,coherentIndex,megaIndex,unavailable};state.utilityCache.set(pokemon.speciesKey,value);return value;
}
function battleUtility(pokemon) {
  const current=speciesUtility(pokemon);
  const evolved=finalEvolutions(pokemon).filter(item=>item.speciesKey!==pokemon.speciesKey).map(item=>({pokemon:item,utility:speciesUtility(item)})).sort((a,b)=>UTILITY_LEVEL[b.utility.key]-UTILITY_LEVEL[a.utility.key]||a.pokemon.dex-b.pokemon.dex)[0];
  return{...current,evolution:evolved&&UTILITY_LEVEL[evolved.utility.key]>UTILITY_LEVEL[current.key]?`진화 후 실전 후보 · ${displayName(evolved.pokemon)} ${evolved.utility.label} (${evolved.utility.primaryReason})`:''};
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
  const p=state.selected,role=archetype(p),utility=battleUtility(p),maxStat=Math.max(p.stats.attack,p.stats.defense,p.stats.stamina,300);
  const stat=(label,key)=>`<div class="stat-box"><span>${label}</span><strong>${p.stats[key]}</strong><div class="stat-bar"><i style="width:${Math.round(p.stats[key]/maxStat*100)}%"></i></div></div>`;
  const modeTab=(key,label)=>`<button class="mode-tab ${state.mode===key?'active':''}" data-mode="${key}" role="tab" aria-selected="${state.mode===key}">${label}</button>`;
  els.detail.innerHTML=`
    <button type="button" class="mobile-back" data-mobile-back>← 도감으로</button>
    <article class="hero-card"><div class="hero-copy"><span class="dex-number">${padDex(p.dex)} · GENERATION ${p.generation||'–'}</span><h2>${esc(displayName(p))}</h2><p class="english-name">${esc(p.en)}</p><div class="type-row">${typePills(p)}</div><div class="capability-row">${featurePills(p)}<span class="utility-pill ${utility.key}">${esc(utility.label)}</span></div>${formSwitcherHtml(p)}</div><img class="hero-art" src="${esc(p.image||'')}" alt="${esc(displayName(p))}"></article>
    <div class="detail-grid">
      <section class="panel panel-pad"><div class="section-label"><div><h3>기본 능력치와 실전 분류</h3><p>IV를 더하기 전 종족값과 현재 데이터 기준 활용도</p></div><span class="score-pill">${role.name}</span></div><div class="stats-grid">${stat('공격','attack')}${stat('방어','defense')}${stat('체력','stamina')}</div><p class="role-summary">${role.text}</p><div class="utility-summary ${utility.key}"><strong>${esc(utility.label)}</strong><p>${esc(utility.text)}</p>${utility.evolution?`<span>${esc(utility.evolution)}</span>`:''}</div></section>
      <section class="panel panel-pad"><div class="section-label"><div><h3>진화 계보</h3><p>같은 IV와 강화 레벨을 유지해 각각 다시 계산합니다</p></div></div><div class="evolution-chain">${evolutionHtml(p)}</div></section>
      <section class="panel iv-lab">
        <div class="iv-head"><div><h3>내 개체의 가치</h3><p>공격·방어·체력을 슬라이더나 숫자로 입력하면 즉시 다시 계산합니다.</p></div><div class="iv-head-actions"><button id="quickSave" class="quick-save" type="button">현재 개체 저장</button><div class="appraisal"><b id="appraisalStars">–</b><span class="appraisal-values"><span id="appraisalPercent">IV 완성도 –</span><span id="statRetention">15/15/15 대비 능력치 곱 –</span></span></div></div></div>
        ${statusSelectorHtml(p)}
        <div class="mode-tabs" role="tablist">${modeTab('great','슈퍼리그')}${modeTab('ultra','하이퍼리그')}${modeTab('master','마스터리그')}${modeTab('pve','레이드 PvE')}${modeTab('max','맥스배틀')}</div>
        <div class="iv-content"><div class="slider-panel">
          ${ivSlider('공격','attack')}${ivSlider('방어','defense')}${ivSlider('체력','stamina')}
          <div class="level-row"><p class="level-hint">현재 강화 레벨을 알면 진화 후 즉시 사용 가능 여부도 확인할 수 있어요.</p>${levelSlider()}<output id="estimatedCp" class="estimated-cp" aria-live="polite" aria-atomic="true"><span>현재 예상 CP</span><strong>–</strong></output></div>
          ${currentMoveFieldsHtml()}
          ${purificationOptionsHtml(p)}
          ${trainingPlannerHtml()}
          <div class="max-toggle" id="maxToggle"${isMaxCapable(p)?'':' hidden'}><label for="maxEligible"><input id="maxEligible" type="checkbox"><span><strong>이 개체는 맥스 포켓몬입니다</strong><span>같은 종이라도 맥스배틀/특별 리서치 출신 개체만 입장할 수 있어요.</span></span></label><select id="maxKindInput" aria-label="맥스 개체 종류"><option value="dynamax">다이맥스</option><option value="gigantamax">거다이맥스</option></select></div>
        </div><div class="result-card" id="ivResult"></div></div>
        <section id="scenarioCompare" class="scenario-compare" hidden aria-live="polite"></section>
        <div class="projection"><h4>같은 IV로 진화하면</h4><div class="projection-grid" id="projectionGrid"></div></div>
      </section>
      <section class="panel panel-pad full-panel"><div class="section-label"><div><h3>추천 기술 구성</h3><p>PvP는 현재 메타, PvE는 중립 대상 이론 사이클 기준</p></div></div><div id="moveStatusNote"></div><div class="moves-grid">${moveSetsHtml(p)}</div></section>
      <section class="panel panel-pad full-panel"><div class="section-label"><div><h3>메가진화와 맥스배틀 영향</h3><p>일반 진화와 구분되는 일시적·개체별 전투 형태</p></div></div><div class="transform-grid" id="transformationGrid">${transformationHtml(p,state.condition)}</div><span class="data-date">도감 ${esc(state.dataDate)} · PvP ${esc(String(state.pvp.updated||'').slice(0,10))} 기준</span></section>
    </div>`;
  bindIvEvents(); updateIvResults();
}

function ivSlider(label,key) {
  const value=state.ivs[key];
  return `<div class="iv-slider iv-stat-slider"><label for="iv-${key}">${label}</label><div class="iv-range-wrap"><input id="iv-${key}" data-iv="${key}" type="range" min="0" max="15" step="1" value="${value}" aria-label="${label} 개체값 슬라이더"><span class="iv-range-ticks" aria-hidden="true"><span class="iv-range-tick" data-iv-tick="5"></span><span class="iv-range-tick" data-iv-tick="10"></span></span></div><input id="iv-number-${key}" class="iv-number-input" data-iv-number="${key}" type="number" min="0" max="15" step="1" inputmode="numeric" value="${value}" aria-label="${label} 개체값 직접 입력"></div>`;
}
function levelSlider() { return `<div class="iv-slider"><label for="levelInput">레벨</label><input id="levelInput" type="range" min="1" max="50" step="0.5" value="${state.level}" aria-label="현재 포켓몬 레벨"><output id="levelOutput">${state.level}</output></div>`; }
function currentMoveFieldsHtml() {
  return `<fieldset class="current-move-fields"><legend>저장할 현재 기술 <span>선택 사항</span></legend><div><label for="currentFastMove">노말 기술</label><select id="currentFastMove"><option value="">모름</option></select></div><div><label for="currentChargedMove1">차지 기술 1</label><select id="currentChargedMove1"><option value="">모름</option></select></div><div><label for="currentChargedMove2">차지 기술 2</label><select id="currentChargedMove2"><option value="">없음·모름</option></select></div><p id="currentMoveHelp">선택한 기술은 “현재 개체 저장”을 누를 때 함께 보관됩니다.</p></fieldset>`;
}
function statusSelectorHtml(pokemon) {
  const disabled=pokemon.shadowEligible?'':' disabled aria-disabled="true"';
  return `<div class="status-selector"><div class="status-tabs" role="radiogroup" aria-label="현재 개체 상태"><button type="button" class="status-tab active" data-condition="normal" aria-pressed="true">일반</button><button type="button" class="status-tab shadow" data-condition="shadow" aria-pressed="false"${disabled}>그림자</button><button type="button" class="status-tab purified" data-condition="purified" aria-pressed="false"${disabled}>정화됨</button></div><p id="statusHint" class="status-hint"></p></div>`;
}
function purificationOptionsHtml(pokemon) {
  return `<div class="purify-options" id="purifyOptions" hidden><div><label for="purifyTrainerLevel">정화 시 트레이너 레벨</label><input id="purifyTrainerLevel" type="number" min="1" max="25" step="1" value="${state.purifyTrainerLevel}"><small>25 이상은 모두 정화 레벨 25로 계산</small></div>${pokemon.shadow?.apex?'<label class="apex-toggle"><input id="apexShadow" type="checkbox"> 이 개체는 APEX 그림자입니다</label>':''}</div>`;
}
function trainingTargetSlider(label,key) {
  return `<div class="training-target"><label for="training-${key}">${label}</label><input id="training-${key}" data-training-iv="${key}" type="range" min="${state.ivs[key]}" max="15" value="${state.training.target[key]}"><output id="training-out-${key}">${state.training.target[key]}</output></div>`;
}
function trainingPlannerHtml() {
  return `<details class="training-planner" id="trainingPlanner"><summary><span>대단한 특훈 계획</span><small>병뚜껑으로 IV를 올린 뒤의 가치 비교</small></summary><div class="training-body"><div class="training-controls"><label>병뚜껑<select id="trainingCap"><option value="none">사용 안 함</option><option value="gold">금색병뚜껑</option><option value="silver">은색병뚜껑</option></select></label><label class="buddy-check"><input id="trainingBuddy" type="checkbox"> 굿 파트너 이상</label></div><fieldset class="silver-stats" id="silverStats" hidden><legend>은색병뚜껑 적용 능력치</legend><label><input type="radio" name="silverStat" data-silver-stat="attack" checked> 공격</label><label><input type="radio" name="silverStat" data-silver-stat="defense"> 방어</label><label><input type="radio" name="silverStat" data-silver-stat="stamina"> 체력</label></fieldset><fieldset class="training-targets" id="trainingTargets"><legend>특훈 후 목표 IV</legend>${trainingTargetSlider('공격','attack')}${trainingTargetSlider('방어','defense')}${trainingTargetSlider('체력','stamina')}</fieldset><div class="training-phase" role="radiogroup" aria-label="특훈 진행 상태"><button type="button" class="active" data-training-phase="planned" aria-pressed="true">계획</button><button type="button" data-training-phase="completed" aria-pressed="false">완료 기록</button></div><p class="training-help" id="trainingHelp">병뚜껑을 고르면 현재 개체와 특훈 후를 비교합니다. IV는 낮출 수 없습니다.</p><p class="training-source">굿 파트너 이상 · 상승 1포인트당 과제 1개 · 병뚜껑 사용 후 365일 내 완료 · 특훈 개체는 Pokémon HOME 전송 불가</p></div></details>`;
}

function bindIvEvents() {
  const normalizeIv=value=>{const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.min(15,Math.round(number))):0;};
  const applyIv=(key,value,{writeNumber=true}={})=>{const normalized=normalizeIv(value),changed=state.ivs[key]!==normalized;state.ivs[key]=normalized;const range=$(`#iv-${key}`),number=$(`#iv-number-${key}`);if(range)range.value=String(normalized);if(writeNumber&&number)number.value=String(normalized);if(changed){syncTrainingTargets();updateIvResults();}return normalized;};
  $$('[data-iv]',els.detail).forEach(input=>input.addEventListener('input',()=>applyIv(input.dataset.iv,input.value)));
  $$('[data-iv-number]',els.detail).forEach(input=>{
    input.addEventListener('input',()=>{if(input.value==='')return;const number=Number(input.value);if(Number.isFinite(number))applyIv(input.dataset.ivNumber,number,{writeNumber:false});});
    const commit=()=>applyIv(input.dataset.ivNumber,input.value);
    input.addEventListener('change',commit);
    input.addEventListener('blur',commit);
  });
  $('#levelInput').addEventListener('input',event=>{state.level=Number(event.target.value);$('#levelOutput').value=event.target.value;updateIvResults();});
  for(const id of ['currentFastMove','currentChargedMove1','currentChargedMove2'])$('#'+id)?.addEventListener('change',syncCurrentMovesFromForm);
  $('#maxEligible').addEventListener('change',event=>{state.maxEligible=event.target.checked;if(!state.maxEligible)state.maxKind='none';else if(!recordMaxKindSupported(state.maxKind,state.selected))state.maxKind=state.selected.dynamax?'dynamax':'gigantamax';updateIvResults();});
  $('#maxKindInput').addEventListener('change',event=>{state.maxKind=event.target.value;state.maxEligible=true;updateIvResults();});
  $('#purifyTrainerLevel').addEventListener('input',event=>{state.purifyTrainerLevel=Math.max(1,Math.min(25,Math.round(Number(event.target.value)||25)));updateIvResults();});
  $('#apexShadow')?.addEventListener('change',event=>{state.apex=event.target.checked;clearIncompatibleCurrentStatusMoves();updateIvResults();});
  $('#trainingCap').addEventListener('change',event=>{state.training.capType=event.target.value;if(state.training.capType==='none')state.training.target={...state.ivs};syncTrainingTargets();updateIvResults();});
  $('#trainingBuddy').addEventListener('change',event=>{state.training.goodBuddy=event.target.checked;updateIvResults();});
  $$('[data-training-iv]',els.detail).forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.trainingIv;state.training.target[key]=Math.max(state.ivs[key],Number(input.value));$(`#training-out-${key}`).value=state.training.target[key];updateIvResults();}));
}

function syncTrainingTargets() {
  for(const key of ['attack','defense','stamina'])state.training.target[key]=Math.max(state.ivs[key],Math.min(15,state.training.target[key]??state.ivs[key]));
  if(state.training.capType==='silver')for(const key of ['attack','defense','stamina'])if(key!==state.training.silverStat)state.training.target[key]=state.ivs[key];
}

function handleDetailClick(event) {
  if(event.target.closest('#quickSave')){quickSaveCurrent();return;}
  const select=event.target.closest('[data-select-key]'); if(select){navigateTo(select.dataset.selectKey);return;}
  if(event.target.closest('[data-mobile-back]')){history.replaceState(null,'',`${location.pathname}${location.search}`);document.body.classList.remove('show-detail');return;}
  const condition=event.target.closest('[data-condition]');if(condition&&!condition.disabled){state.condition=condition.dataset.condition;state.apex=false;if(state.condition==='shadow'){state.maxEligible=false;state.maxKind='none';state.training.capType='none';state.training.target={...state.ivs};}clearIncompatibleCurrentStatusMoves();updateIvResults();return;}
  const phase=event.target.closest('[data-training-phase]');if(phase){state.training.phase=phase.dataset.trainingPhase;updateIvResults();return;}
  const silver=event.target.closest('[data-silver-stat]');if(silver){state.training.silverStat=silver.dataset.silverStat;syncTrainingTargets();updateIvResults();return;}
  const mode=event.target.closest('[data-mode]'); if(mode){state.mode=mode.dataset.mode;$$('[data-mode]',els.detail).forEach(button=>{const active=button.dataset.mode===state.mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});updateIvResults();}
}

function statsAt(pokemon,ivs,level) { return Mechanics.statsAt(pokemon,ivs,level); }
function bestUnderCap(pokemon,ivs,cap) { return Mechanics.bestUnderCap(pokemon,ivs,cap); }

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

function makeSnapshot(overrides={}) { return{ivs:{...state.ivs,...(overrides.ivs||{})},level:overrides.level??state.level,status:overrides.status??state.condition,maxEligible:overrides.maxEligible??state.maxEligible,maxKind:overrides.maxKind??state.maxKind}; }
function effectiveStateSnapshot() {
  if(state.training.capType==='none'||state.training.phase!=='completed')return makeSnapshot();
  const plan=Mechanics.buildTrainingPlan({ivs:state.ivs,target:state.training.target,status:state.condition,capType:state.training.capType,silverStat:state.training.silverStat,goodBuddy:state.training.goodBuddy,phase:state.training.phase});
  return plan.valid?makeSnapshot({ivs:plan.targetIvs}):makeSnapshot();
}
function gradeClass(grade) { return grade==='S'?'':grade.toLowerCase(); }

function evaluate(pokemon,mode=state.mode,snapshot=makeSnapshot()) {
  const {ivs,level,status,maxEligible}=snapshot,maxKind=snapshot.maxKind||(maxEligible?(pokemon.dynamax?'dynamax':'gigantamax'):'none'),app=Mechanics.appraisalFor(ivs),current=Mechanics.applyStatusModifiers(statsAt(pokemon,ivs,level),status),perfect=Mechanics.applyStatusModifiers(statsAt(pokemon,{attack:15,defense:15,stamina:15},level),status),statusPrefix=status==='shadow'?'그림자 ':status==='purified'?'정화 ':'';
  if(LEAGUES[mode]){
    const league=LEAGUES[mode],rank=ivRankData(pokemon,league.cap).byIv.get(`${ivs.attack}-${ivs.defense}-${ivs.stamina}`);
    const grade=rank.rank<=41?'S':rank.rank<=410?'A':rank.rank<=1229?'B':'C'; const top=rank.rank/4096*100;
    const maxPerfect=bestUnderCap(pokemon,{attack:15,defense:15,stamina:15},league.cap); const uncapped=league.cap!==Infinity&&maxPerfect.level===50&&maxPerfect.cp<league.cap;
    const normalMeta=state.pvp.leagues[league.key]?.[pokemon.speciesKey],meta=status==='shadow'?null:normalMeta;
    let why=uncapped?`${pokemon.name}은(는) 50레벨에서도 CP 제한에 여유가 있어 낮은 공격보다 15/15/15에 가까운 개체가 유리합니다.`:`CP 제한 리그에서는 공격이 CP를 더 많이 올리므로, 공격을 낮추고 방어·체력을 높이면 더 높은 레벨과 능력치 곱을 확보하는 경우가 많습니다.`;
    if(mode==='master')why='마스터리그는 CP 제한이 없어 세 능력치를 모두 높이는 것이 원칙이며, 특히 공격 IV는 CMP 선공과 공격 breakpoint에 영향을 줄 수 있습니다.';
    if(status==='shadow')why+=' 그림자 보정은 CP와 동종 IV 순위를 바꾸지 않지만 실제 공격은 1.2배, 방어는 5/6가 됩니다. 일반형 PvP 메타 점수를 그림자형 점수로 대신 표시하지 않습니다.';
    else why+=meta?` 현재 종족 메타 점수는 ${meta.score}점이며 추천 순위는 ${meta.rank}위입니다. 개체 순위와 종족의 메타 활용도는 서로 다른 지표입니다.`:' 현재 공개 메타 랭킹에 대표 형태가 없어 개체 순위만 판정했습니다.';
    if(status==='purified')why+=' 입력한 IV와 레벨은 이미 정화가 끝난 현재값으로 계산하며 +2와 레벨 보정을 다시 적용하지 않습니다.';
    const tooHigh=league.cap!==Infinity&&current.cp>league.cap;
    return{grade,title:`${statusPrefix}${league.name} ${grade}급 개체`,subtitle:`동종 IV ${rank.rank.toLocaleString()}위 · 상위 ${top<1?top.toFixed(1):Math.round(top)}%`,metrics:[['목표 CP',rank.cp.toLocaleString()],['도달 레벨',rank.level],['능력치 효율',`${rank.percent.toFixed(2)}%`]],explanation:why,caution:`능력치 곱 기반 일반 순위입니다. 특정 대면전의 breakpoint·bulkpoint·CMP는 달라질 수 있습니다.${tooHigh?' 현재 레벨에서 이미 리그 CP를 초과해 강화도를 낮출 수 없으므로 이 형태로는 참가할 수 없습니다.':''}`,rank};
  }
  if(mode==='pve'){
    const score=(ivs.attack*.5+ivs.defense*.25+ivs.stamina*.25)/15*100,grade=score>=95?'S':score>=85?'A':score>=70?'B':'C',attackLoss=(1-current.attack/perfect.attack)*100,shadowText=status==='shadow'?' 그림자 보정으로 실전 공격은 20% 증가하고 방어는 5/6가 되며 CP는 그대로입니다.':'';
    return{grade,title:`${statusPrefix}레이드 공격수 ${grade}급`,subtitle:`공격 가중 IV 점수 ${score.toFixed(1)}점`,metrics:[['공격 IV',`${ivs.attack}/15`],['실전 공격',current.attack.toFixed(1)],['현재 예상 CP',current.cp.toLocaleString()]],explanation:`레이드는 제한 시간 때문에 공격 IV를 먼저 봅니다. 이 개체의 같은 레벨 15공격 대비 실제 공격 손실은 약 ${attackLoss.toFixed(2)}%입니다. 방어와 체력은 차지 기술을 한 번 더 쓰는 생존 구간에서 가치가 생깁니다.${shadowText}`,caution:'종족값·강화 레벨·기술·보스 상성이 IV보다 영향이 큽니다. 추천 DPS는 날씨, 보스 방어, 피격 에너지와 breakpoint를 반영하지 않은 중립 이론값입니다.'};
  }
  const role=archetype(pokemon),weights=role.key==='attack'?[.5,.25,.25]:role.key==='stamina'?[.25,.3,.45]:[.3,.4,.3];
  const score=(ivs.attack*weights[0]+ivs.defense*weights[1]+ivs.stamina*weights[2])/15*100;
  if(status==='shadow')return{grade:'–',title:'그림자 포켓몬은 맥스배틀 사용 불가',subtitle:'정화 미리보기에서 정화 후 가치를 확인하세요',metrics:[['공격 IV',`${ivs.attack}/15`],['방어 IV',`${ivs.defense}/15`],['체력 IV',`${ivs.stamina}/15`]],explanation:'그림자 포켓몬은 다이맥스·거다이맥스 개체가 될 수 없으며 맥스배틀에 참가할 수 없습니다.',caution:'그림자 보정과 맥스 변신을 동시에 적용하지 않습니다.'};
  if(!isMaxCapable(pokemon))return{grade:'–',title:'현재 맥스 미지원 종',subtitle:'확인된 Pokémon GO 맥스 개체 목록 기준',metrics:[['공격 IV',`${ivs.attack}/15`],['방어 IV',`${ivs.defense}/15`],['체력 IV',`${ivs.stamina}/15`]],explanation:'이 종은 현재 데이터에서 다이맥스 또는 거다이맥스 가능한 개체가 확인되지 않았습니다. 향후 맥스배틀 데뷔 시 다시 평가할 수 있습니다.',caution:'본가에서 맥스 변신이 가능한지와 Pokémon GO에서 실제 맥스 개체를 얻을 수 있는지는 다릅니다.'};
  if(!maxEligible)return{grade:'?',title:'맥스 개체 여부를 확인하세요',subtitle:'종이 지원돼도 일반 개체는 입장할 수 없습니다',metrics:[['종 지원','가능'],['거다이맥스',pokemon.gigantamax?'가능':'해당 없음'],['현재 예상 CP',current.cp.toLocaleString()]],explanation:'슬라이더 아래의 “이 개체는 맥스 포켓몬입니다”를 체크해야 맥스 역할별 IV 평가를 진행합니다.',caution:'맥스배틀이나 특별 리서치에서 얻은 맥스 자격은 개체 단위입니다. 같은 종의 일반 포켓몬에는 자동 적용되지 않습니다.'};
  if(!recordMaxKindSupported(maxKind,pokemon))return{grade:'–',title:`저장된 ${maxKindLabel(maxKind)} 자격은 현재 폼과 불일치`,subtitle:'현재 Max 지원 데이터와 저장 기록을 함께 확인하세요',metrics:[['저장 종류',maxKindLabel(maxKind)],['다이맥스',pokemon.dynamax?'지원':'미지원'],['거다이맥스',pokemon.gigantamax?'지원':'미지원']],explanation:'가져온 기록의 Max 종류는 데이터 손실을 막기 위해 보존했지만 현재 도감에서는 이 폼의 해당 자격이 확인되지 않습니다.',caution:'잘못 연결된 폼인지, 이후 데이터에서 제외된 자격인지 게임 내 개체와 출처를 다시 확인하세요.'};
  const grade=score>=95?'S':score>=85?'A':score>=70?'B':'C',roleName=role.key==='attack'?'맥스 공격수':role.key==='stamina'?'맥스 힐러·탱커':'맥스 탱커';
  return{grade,title:`${statusPrefix}${roleName} ${grade}급`,subtitle:`${maxKindLabel(maxKind)} · 역할 가중 IV 점수 ${score.toFixed(1)}점`,metrics:[['공격 IV',`${ivs.attack}/15`],['내구 IV',`${ivs.defense+ivs.stamina}/30`],['Max 종류',maxKindLabel(maxKind)]],explanation:role.key==='attack'?`공격 IV와 보스 약점을 찌르는 노말 기술 타입이 핵심입니다. ${maxKind==='gigantamax'?'선택한 거다이맥스는 종 고유 G-Max 기술을 사용합니다.':'다이맥스 어택 타입은 현재 노말 기술 타입으로 결정됩니다.'} 맥스 기술 레벨을 올리면 IV 차이보다 큰 화력 차이가 납니다.`:'방어·체력과 보스 기술 저항을 우선하세요. 맥스가드로 버티거나 맥스스피릿으로 팀을 회복시키는 역할에 적합합니다.',caution:'메가진화와 맥스 변신은 동시에 사용할 수 없습니다. 실제 맥스 기술 레벨과 보스 기술을 함께 확인하세요.'};
}

const MOVE_LABEL_KO={FRUSTRATION:'화풀이',RETURN:'은혜갚기',AEROBLAST_PLUS:'에어로블라스트+',AEROBLAST_PLUS_PLUS:'에어로블라스트++',SACRED_FIRE_PLUS:'성스러운불꽃+',SACRED_FIRE_PLUS_PLUS:'성스러운불꽃++'};
function scenarioMoveName(id) { return MOVE_LABEL_KO[id]||moveName(id); }
function snapshotStats(pokemon,snapshot) { return Mechanics.applyStatusModifiers(statsAt(pokemon,snapshot.ivs,snapshot.level),snapshot.status); }
function scenarioCardHtml(pokemon,label,snapshot) {
  const stats=snapshotStats(pokemon,snapshot),result=evaluate(pokemon,state.mode,snapshot);
  return `<article class="scenario-card"><span>${esc(label)}</span><strong>${snapshot.ivs.attack}/${snapshot.ivs.defense}/${snapshot.ivs.stamina} · Lv.${snapshot.level}</strong><dl><div><dt>CP</dt><dd>${stats.cp.toLocaleString()}</dd></div><div><dt>실전 공격</dt><dd>${stats.attack.toFixed(1)}</dd></div><div><dt>실전 방어</dt><dd>${stats.defense.toFixed(1)}</dd></div></dl><p>${esc(result.title)}</p></article>`;
}
function trainingReasonText(codes) {
  const labels={GOOD_BUDDY_REQUIRED:'굿 파트너 이상이어야 합니다.',ALREADY_PERFECT:'15/15/15 개체는 대단한 특훈을 할 수 없습니다.',SHADOW_INELIGIBLE:'그림자 포켓몬은 대단한 특훈을 할 수 없습니다.',NO_INCREASE:'현재 IV보다 높은 목표를 하나 이상 선택하세요.',TARGET_BELOW_CURRENT:'IV를 낮추는 방향은 선택할 수 없습니다.',SILVER_SINGLE_STAT_ONLY:'은색병뚜껑은 선택한 능력치 하나만 올릴 수 있습니다.',SILVER_STAT_NO_INCREASE:'은색병뚜껑으로 올릴 능력치의 목표를 높이세요.',CAP_TYPE_REQUIRED:'병뚜껑 종류를 선택하세요.'};
  return codes.map(code=>labels[code]).filter(Boolean);
}
function secondMoveCostText(pokemon,status) {
  const baseStardust=Number(pokemon.shadow?.secondMoveStardust),baseCandy=Number(pokemon.shadow?.secondMoveCandy);
  if(!baseStardust||!baseCandy)return'';
  const multiplier=status==='shadow'?1.2:status==='purified'?0.8:1;
  return `두 번째 기술 ${Math.round(baseStardust*multiplier).toLocaleString()} 별의모래 · 사탕 ${Math.round(baseCandy*multiplier)}`;
}
function renderScenarioCompare(pokemon) {
  const container=$('#scenarioCompare');if(!container)return;
  if(state.condition==='shadow'){
    const shadowData=state.apex&&pokemon.shadow?.apex?pokemon.shadow.apex:pokemon.shadow,plan=Mechanics.buildPurificationPlan({pokemon:{...pokemon,shadow:shadowData},ivs:state.ivs,level:state.level,trainerLevel:state.purifyTrainerLevel,status:'shadow'}),before=makeSnapshot({status:'shadow'}),after=makeSnapshot({status:'purified',ivs:plan.purified.ivs,level:plan.purified.level,maxEligible:false});
    container.hidden=false;container.innerHTML=`<div class="scenario-head"><div><h4>정화 전후 비교</h4><p>원본 그림자 개체는 변경하지 않은 미리보기입니다.</p></div><span class="scenario-badge shadow">${state.apex?'APEX ':''}정화</span></div><div class="scenario-grid">${scenarioCardHtml(pokemon,'현재 그림자',before)}${scenarioCardHtml(pokemon,'정화 후',after)}</div><div class="scenario-facts"><span>비용 ${Number(plan.cost.stardust).toLocaleString()} 별의모래 · 사탕 ${plan.cost.candy}</span><span>${esc(scenarioMoveName(plan.moves.shadow))} → ${esc(scenarioMoveName(plan.moves.purified))}</span><span>IV +${plan.deltas.attack}/+${plan.deltas.defense}/+${plan.deltas.stamina} · Lv.${plan.current.level} → ${plan.purified.level}</span></div><p class="scenario-warning">정화는 되돌릴 수 없습니다. 정화 후에는 그림자 공격 보정을 잃으며, 슬라이더의 원본 IV는 바뀌지 않습니다.</p>`;return;
  }
  if(state.training.capType==='none'){container.hidden=true;container.innerHTML='';return;}
  const plan=Mechanics.buildTrainingPlan({ivs:state.ivs,target:state.training.target,status:state.condition,capType:state.training.capType,silverStat:state.training.silverStat,goodBuddy:state.training.goodBuddy,phase:state.training.phase}),before=makeSnapshot(),after=makeSnapshot({ivs:plan.targetIvs}),league=LEAGUES[state.mode],beforeCp=statsAt(pokemon,before.ivs,before.level).cp,afterCp=statsAt(pokemon,after.ivs,after.level).cp,capWarning=league&&league.cap!==Infinity&&beforeCp<=league.cap&&afterCp>league.cap,errors=trainingReasonText(plan.reasonCodes);
  const capLabel=plan.capType==='gold'?'금색병뚜껑':'은색병뚜껑',phaseLabel=plan.phase==='completed'?'완료 기록':'계획';
  container.hidden=false;container.innerHTML=`<div class="scenario-head"><div><h4>대단한 특훈 전후 비교</h4><p>완료한 IV 상승은 되돌릴 수 없으며 IV를 낮출 수 없습니다.</p></div><span class="scenario-badge training">${capLabel} · ${phaseLabel}</span></div><div class="scenario-grid">${scenarioCardHtml(pokemon,'현재',before)}${scenarioCardHtml(pokemon,'특훈 후',after)}</div><div class="scenario-facts"><span>과제 총 ${plan.taskCount}개</span><span>공격 ${plan.tasks.attack} · 방어 ${plan.tasks.defense} · 체력 ${plan.tasks.stamina}</span><span>CP ${beforeCp.toLocaleString()} → ${afterCp.toLocaleString()}</span></div>${errors.length?`<p class="scenario-warning error">${esc(errors.join(' '))}</p>`:''}${capWarning?`<p class="scenario-warning error">${esc(league.name)} CP ${league.cap.toLocaleString()} 제한을 넘습니다. 공격 IV 상승이 리그 참가 가능 여부를 바꿀 수 있습니다.</p>`:''}`;
}
function updateScenarioControls(pokemon) {
  $$('[data-condition]',els.detail).forEach(button=>{const active=button.dataset.condition===state.condition;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));if(button.dataset.condition!=='normal')button.disabled=!pokemon.shadowEligible;});
  const costs=secondMoveCostText(pokemon,state.condition),hints={normal:'일반 개체입니다. 그림자·정화 보정 없이 입력한 IV와 레벨을 그대로 계산합니다.',shadow:`실전 공격 ×1.2, 방어 ×5/6이며 CP는 변하지 않습니다. 강화·두 번째 기술 비용은 일반의 1.2배입니다.${costs?` ${costs}.`:''}`,purified:`슬라이더는 이미 정화가 끝난 현재 IV입니다. +2를 다시 적용하지 않으며 강화 비용은 0.9배, 두 번째 기술은 0.8배입니다.${costs?` ${costs}.`:''}`};
  $('#statusHint').textContent=hints[state.condition];$('#purifyOptions').hidden=state.condition!=='shadow';$('#purifyTrainerLevel').value=state.purifyTrainerLevel;if($('#apexShadow'))$('#apexShadow').checked=state.apex;
  const shadow=state.condition==='shadow',cap=$('#trainingCap');cap.value=state.training.capType;cap.disabled=shadow;$('#trainingBuddy').checked=state.training.goodBuddy;$('#trainingBuddy').disabled=shadow;$('#trainingPlanner').classList.toggle('unavailable',shadow);$('#silverStats').hidden=state.training.capType!=='silver';
  $$('[data-silver-stat]',els.detail).forEach(input=>{input.checked=input.dataset.silverStat===state.training.silverStat;input.disabled=shadow||state.training.capType!=='silver';});
  const active=!shadow&&state.training.capType!=='none';
  $$('[data-training-iv]',els.detail).forEach(input=>{const key=input.dataset.trainingIv;input.min=state.ivs[key];input.value=state.training.target[key];input.disabled=!active||(state.training.capType==='silver'&&key!==state.training.silverStat);$(`#training-out-${key}`).value=state.training.target[key];});
  $$('[data-training-phase]',els.detail).forEach(button=>{const selected=button.dataset.trainingPhase===state.training.phase;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));button.disabled=shadow||state.training.capType==='none';});
  const maxToggle=$('#maxToggle'),checkbox=$('#maxEligible'),kindSelect=$('#maxKindInput'),capable=isMaxCapable(pokemon);maxToggle.hidden=!capable;checkbox.disabled=shadow||!capable;checkbox.checked=!shadow&&state.maxEligible&&capable;maxToggle.classList.toggle('unavailable',shadow);
  kindSelect.querySelector('[value="dynamax"]').disabled=!pokemon.dynamax;kindSelect.querySelector('[value="gigantamax"]').disabled=!pokemon.gigantamax;
  kindSelect.value=state.maxKind==='none'?(pokemon.dynamax?'dynamax':'gigantamax'):state.maxKind;kindSelect.hidden=!checkbox.checked||(!(pokemon.dynamax&&pokemon.gigantamax)&&recordMaxKindSupported(state.maxKind,pokemon));kindSelect.disabled=shadow;
  refreshCurrentMoveOptions();
}
function updateIvResults() {
  syncTrainingTargets();const p=state.selected,snapshot=effectiveStateSnapshot(),result=evaluate(p,state.mode,snapshot),app=Mechanics.appraisalFor(snapshot.ivs),retention=Mechanics.speciesStatRetention(p,snapshot.ivs);updateScenarioControls(p);
  $('#appraisalStars').textContent=app.stars; $('#appraisalPercent').textContent=`IV 완성도 ${app.total}/45 · ${app.percent.toFixed(1)}%`;$('#statRetention').textContent=`15/15/15 대비 능력치 곱 ${retention.percent.toFixed(2)}%`;
  const estimatedCp=statsAt(p,snapshot.ivs,snapshot.level).cp;$('#estimatedCp').innerHTML=`<span>현재 예상 CP</span><strong>CP ${estimatedCp.toLocaleString()}</strong>`;
  $('#ivResult').innerHTML=`<div class="grade-row"><span class="grade ${gradeClass(result.grade)}">${result.grade}</span><div><h4>${esc(result.title)}</h4><p>${esc(result.subtitle)}</p></div></div><div class="result-metrics">${result.metrics.map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div><p class="explanation">${esc(result.explanation)}</p><p class="caution">${esc(result.caution)}</p>`;
  renderScenarioCompare(p);
  const finals=[...new Map([p,...finalEvolutions(p)].map(item=>[item.speciesKey,item])).values()];
  $('#projectionGrid').innerHTML=finals.map(item=>{const value=evaluate(item,state.mode,snapshot);return`<button type="button" class="projection-card" data-select-key="${esc(item.speciesKey)}"><img src="${esc(item.image||'')}" alt=""><span><strong>${esc(displayName(item))}</strong><small>${esc(value.title)}</small></span><b>${value.grade}</b></button>`;}).join('');
  const shadowData=state.apex&&p.shadow?.apex?p.shadow.apex:p.shadow,note=$('#moveStatusNote');note.innerHTML=state.condition==='shadow'?`<p class="status-move-note shadow"><strong>${esc(scenarioMoveName(shadowData?.shadowMove||'FRUSTRATION'))} 적용 중</strong> 아래 PvP 순위와 추천 기술은 일반 폼 참고값입니다. 화풀이 제거 이벤트 또는 두 번째 차지 기술 해방 가능 여부를 함께 확인하세요.</p>`:state.condition==='purified'?`<p class="status-move-note purified"><strong>${esc(scenarioMoveName(p.shadow?.purifiedMove||'RETURN'))} 확인</strong> 아래 PvP 순위는 일반 폼 참고값입니다. 정화된 개체의 현재 기술 슬롯과 게임 내 TM 가능 여부를 함께 확인하세요.</p>`:'';
  $('#transformationGrid').innerHTML=transformationHtml(p,state.condition);
}

function moveForPokemon(pokemon,id,kind) {
  return pokemon.moves[kind].find(move=>move.id===id)||state.moveById.get(id);
}
function moveName(id,move=state.moveById.get(id)) { return move?.ko||id.toLowerCase().split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '); }
function moveAccessInfo(move) {
  if(move?.access)return move.access;
  return move?.elite?{kind:'elite_tm',tmLearnability:'elite_only',label:'이벤트·특별 진화·대단한 기술머신'}:null;
}
function exclusiveMoveHelp(move) {
  const access=moveAccessInfo(move);if(!access)return'';
  return access.tmLearnability==='none'?`${access.label} · 모든 기술머신으로 배울 수 없음`:`${access.label} · 일반 기술머신으로 배울 수 없음`;
}
function exclusiveMoveBadge(move) {
  const access=moveAccessInfo(move);if(!access)return'';const help=exclusiveMoveHelp(move);
  return`<span class="elite exclusive-move-badge" data-access-kind="${esc(access.kind)}" title="${esc(help)}" aria-label="특별 기술, ${esc(help)}">특별 기술</span>`;
}
function exclusiveMoveNotice(moves) {
  const exclusive=[...new Map((moves||[]).filter(move=>moveAccessInfo(move)).map(move=>[move.id,move])).values()];
  if(!exclusive.length)return'';
  return`<p class="exclusive-move-note"><strong>특별 기술 포함</strong><span>${exclusive.map(move=>`${esc(moveName(move.id,move))}: ${esc(exclusiveMoveHelp(move))}`).join('<br>')}</span></p>`;
}
function moveLine(pokemon,id,kind,label) {
  const move=moveForPokemon(pokemon,id,kind);
  return`<div class="move-line" data-move-id="${esc(id)}" data-exclusive="${moveAccessInfo(move)?'true':'false'}"><span class="move-kind">${label}</span><i class="move-type" ${move?typeAttrs(move.type):''}></i><b>${esc(moveName(id,move))}</b>${exclusiveMoveBadge(move)}</div>`;
}
function pveProfile(pokemon,stabTypes=pokemon.types.map(type=>type.id)) {
  const combos=[];
  for(const fast of pokemon.moves.fast.filter(move=>move.power>0&&move.energy>0&&move.duration>0))for(const charged of pokemon.moves.charged.filter(move=>move.power>0&&move.energy<0&&move.duration>0)){
    const count=Math.max(1,Math.ceil(Math.abs(charged.energy)/fast.energy)),fastStab=stabTypes.includes(fast.type)?1.2:1,chargedStab=stabTypes.includes(charged.type)?1.2:1;
    const damage=fast.power*fastStab*count+charged.power*chargedStab,duration=(fast.duration*count+charged.duration)/1000;
    combos.push({fast,charged,score:damage/duration,coherent:fast.type===charged.type&&stabTypes.includes(fast.type)});
  }
  return{raw:[...combos].sort((a,b)=>b.score-a.score)[0],coherent:combos.filter(combo=>combo.coherent).sort((a,b)=>b.score-a.score)[0]};
}
function bestPve(pokemon) { return pveProfile(pokemon).raw; }
function pvpMoveCard(pokemon,key,label) {
  const meta=state.pvp.leagues[key]?.[pokemon.speciesKey];
  if(!meta)return`<article class="move-set"><div class="move-set-head"><strong>${label}</strong><span class="score-pill">자료 없음</span></div><p class="move-caption">현재 대표 형태가 공개 전체 랭킹에 포함되지 않았습니다.</p></article>`;
  const moves=meta.moves.map((id,index)=>moveForPokemon(pokemon,id,index?'charged':'fast'));
  return`<article class="move-set"><div class="move-set-head"><strong>${label}</strong><span class="score-pill">메타 ${meta.score} · #${meta.rank}</span></div>${meta.moves.map((id,index)=>moveLine(pokemon,id,index?'charged':'fast',index?'차지':'노말')).join('')}${exclusiveMoveNotice(moves)}<p class="move-caption">PvPoke 전체 리그 시뮬레이션의 현재 추천입니다. 보통 차지 기술 2개 해방을 전제로 합니다.</p></article>`;
}
function moveSetsHtml(pokemon) {
  const pve=bestPve(pokemon);
  const pveCard=pve?`<article class="move-set"><div class="move-set-head"><strong>레이드 PvE</strong><span class="score-pill">중립 DPS ${pve.score.toFixed(1)}</span></div>${moveLine(pokemon,pve.fast.id,'fast','노말')}${moveLine(pokemon,pve.charged.id,'charged','차지')}${exclusiveMoveNotice([pve.fast,pve.charged])}<p class="move-caption">자속 보정 포함 중립 사이클 이론값입니다. 보스 타입에 맞춰 같은 타입 조합을 우선하세요.</p></article>`:`<article class="move-set"><strong>레이드 PvE</strong><p class="move-caption">현재 계산 가능한 공격 기술 조합이 없습니다.</p></article>`;
  return pvpMoveCard(pokemon,'great','PvP · 슈퍼리그')+pvpMoveCard(pokemon,'ultra','PvP · 하이퍼리그')+pvpMoveCard(pokemon,'master','PvP · 마스터리그')+pveCard;
}

function transformationHtml(pokemon,status='normal') {
  const cards=[];
  if(status==='shadow'){
    if(pokemon.mega.length)cards.push(`<article class="transform-card mega disabled"><h4>메가진화 불가</h4><span class="score-pill">그림자 상태</span><p>그림자 포켓몬은 ${esc(pokemon.mega.map(mega=>mega.name).join(' · '))}(으)로 메가진화할 수 없습니다. 정화 후에는 일반 메가진화 조건을 확인할 수 있습니다.</p></article>`);
    if(isMaxCapable(pokemon))cards.push('<article class="transform-card max disabled"><h4>맥스배틀 사용 불가</h4><span class="score-pill">그림자 상태</span><p>그림자 포켓몬에는 다이맥스·거다이맥스 자격을 적용하지 않습니다. 그림자 공격 보정과 맥스 변신을 동시에 계산하지 않습니다.</p></article>');
    if(!cards.length)cards.push('<div class="empty-transform">그림자 상태에서는 메가진화와 맥스 변신을 사용할 수 없습니다.</div>');
    return cards.join('');
  }
  for(const mega of pokemon.mega){const types=mega.types.map(type=>type.ko).join('·');cards.push(`<article class="transform-card mega"><h4>${esc(mega.name)}</h4><span class="score-pill">${esc(types)} 타입 부스트</span><div class="transform-stat"><span>공격 ${mega.stats.attack}</span><span>방어 ${mega.stats.defense}</span><span>체력 ${mega.stats.stamina}</span></div><p>메가진화 중 종족값과 타입이 이 형태로 바뀝니다. 레이드 동료의 공격을 강화하고, 메가 타입과 같은 공격은 더 큰 보너스를 받습니다. IV는 유지되므로 PvE에서는 공격 IV를 우선합니다.</p></article>`);}
  if(pokemon.mega.length)cards.push('<article class="transform-card mega"><h4>2026 메가 운용 메모</h4><p>메가진화는 일반 진화가 아닌 일시적 전투 형태입니다. 일부 대상은 슈퍼 맥스 레벨과 메가 중 추가 차지 공격을 지원하므로 게임 내 자격을 확인하세요. 일반 GO 배틀리그 사용 가능 여부는 시즌 규칙을 따릅니다.</p></article>');
  if(isMaxCapable(pokemon)){const fastTypes=[...new Map(pokemon.moves.fast.map(move=>[move.type,move])).values()].map(move=>move.typeKo).join(' · '),maxLabel=pokemon.gigantamax?(pokemon.dynamax?'다이맥스 · 거다이맥스':'거다이맥스'):'다이맥스',role=archetype(pokemon);cards.push(`<article class="transform-card max"><h4>${maxLabel} 운용</h4><span class="score-pill">${role.name}</span><div class="transform-stat"><span>맥스 어택</span><span>맥스가드</span><span>맥스스피릿</span></div><p>노말 기술 선택에 따라 다이맥스 어택 타입을 ${esc(fastTypes||'현재 기술 타입')} 중에서 바꿀 수 있습니다. ${pokemon.gigantamax?'거다이맥스 시에는 종 고유 G-Max 기술이 맥스 어택을 대신합니다. ':''}맥스 기술 레벨·보스 저항·강화 레벨이 IV보다 더 큰 영향을 줄 수 있습니다.</p></article>`);}else cards.push('<div class="empty-transform">현재 데이터에서 이 종의 맥스 개체는 확인되지 않았습니다. 일반 개체는 향후 종이 데뷔해도 자동으로 맥스 자격을 얻지 않습니다.</div>');
  return cards.join('');
}

let toastTimer=0;
const toastActions=new Map();

async function initCollection() {
  if(!Collection||!window.indexedDB){setCollectionError('이 브라우저에서는 IndexedDB 보유함을 사용할 수 없습니다. 도감과 IV 계산은 계속 사용할 수 있습니다.');return;}
  try {
    state.collection.repo=await Collection.open();
    await refreshCollection();
  } catch(error) {
    console.error(error);
    setCollectionError(`보유함을 열지 못했습니다. ${error.message||'브라우저 저장 공간 설정을 확인해 주세요.'}`);
  }
}

function setCollectionError(message) {
  state.collection.error=message;
  const button=$('#openCollection');if(button)button.setAttribute('aria-describedby','collectionStorageError');
  renderCollection();
}

async function refreshCollection() {
  if(!state.collection.repo)return;
  [state.collection.records,state.collection.recovery]=await Promise.all([state.collection.repo.list(),state.collection.repo.listRecovery()]);
  const currentIds=new Set(state.collection.records.map(record=>record.id));
  for(const id of state.collection.selectedIds)if(!currentIds.has(id))state.collection.selectedIds.delete(id);
  state.collection.metricCache.clear();
  const count=state.collection.records.length,counter=$('#collectionCount');
  counter.textContent=String(count);counter.setAttribute('aria-label',`저장한 포켓몬 ${count}마리`);
  renderCollection();
}

async function refreshAfterCommit(actionLabel) {
  try{await refreshCollection();return true;}catch(error){console.error(error);showToast(`${actionLabel}은(는) 저장소에 반영됐지만 화면을 갱신하지 못했습니다. 페이지를 새로고침해 확인하세요.`);return false;}
}

function bindCollectionEvents() {
  $('#openCollection').addEventListener('click',async()=>{renderCollection();const dialog=$('#collectionDialog');if(!dialog.open)dialog.showModal();if(state.collection.repo)try{await refreshCollection();}catch(error){console.error(error);showToast('다른 탭의 최신 보유함을 불러오지 못했습니다. 페이지를 새로고침해 확인하세요.');}});
  $$('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.closeDialog)?.close()));
  $('#collectionSearch').addEventListener('input',event=>{state.collection.query=event.target.value;state.collection.limit=100;renderCollection();});
  $('#collectionStatus').addEventListener('change',event=>{state.collection.status=event.target.value;state.collection.limit=100;renderCollection();});
  $('#collectionTag').addEventListener('change',event=>{state.collection.tag=event.target.value;state.collection.limit=100;renderCollection();});
  $('#collectionSort').addEventListener('change',event=>{state.collection.sort=event.target.value;state.collection.limit=100;renderCollection();});
  $('#collectionFavorite').addEventListener('change',event=>{state.collection.favorite=event.target.checked;state.collection.limit=100;renderCollection();});
  $('#collectionList').addEventListener('click',handleCollectionClick);
  $('#toggleCompare').addEventListener('click',()=>setCompareMode(!state.collection.compareMode));
  $('#cancelCompare').addEventListener('click',()=>setCompareMode(false));
  $('#openCompare').addEventListener('click',openComparison);
  $('#exportCollectionJson').addEventListener('click',()=>exportCollection('json'));
  $('#exportCollectionCsv').addEventListener('click',()=>exportCollection('csv'));
  $('#exportCollectionRecovery').addEventListener('click',exportCollectionRecovery);
  $('#importCollection').addEventListener('click',()=>$('#collectionFile').click());
  $('#collectionFile').addEventListener('change',importCollectionFile);
  $('#clearCollection').addEventListener('click',clearCollection);
  $('#recordForm').addEventListener('submit',saveRecordEdits);
  $('#deleteRecord').addEventListener('click',deleteEditingRecord);
  const refreshRecordMovesPreservingValues=()=>{const moves=recordFormMoveValues();refreshRecordFormEligibility();refreshRecordFormOptions(moves);};
  $('#recordSpecies').addEventListener('change',refreshRecordMovesPreservingValues);
  $('#recordStatus').addEventListener('change',refreshRecordMovesPreservingValues);
  $('#recordApex').addEventListener('change',refreshRecordMovesPreservingValues);
  const normalizeRecordIv=value=>{const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.min(15,Math.round(number))):0;};
  const syncRecordIv=(rangeId,value,{writeNumber=true}={})=>{const normalized=normalizeRecordIv(value),range=$('#'+rangeId),number=$('#'+rangeId+'Number');range.value=String(normalized);if(writeNumber)number.value=String(normalized);};
  $$('[data-record-iv-range]').forEach(input=>input.addEventListener('input',()=>syncRecordIv(input.dataset.recordIvRange,input.value)));
  $$('[data-record-iv-number]').forEach(input=>{
    input.addEventListener('input',()=>{if(input.value==='')return;const number=Number(input.value);if(Number.isFinite(number))syncRecordIv(input.dataset.recordIvNumber,number,{writeNumber:false});});
    const commit=()=>syncRecordIv(input.dataset.recordIvNumber,input.value);
    input.addEventListener('change',commit);input.addEventListener('blur',commit);
  });
  $('#recordLevel').addEventListener('input',event=>{event.target.nextElementSibling.value=event.target.value;});
  $('.compare-modes').addEventListener('click',event=>{const button=event.target.closest('[data-compare-mode]');if(!button)return;state.collection.compareView=button.dataset.compareMode;$$('[data-compare-mode]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;});renderComparison();});
  $('.compare-modes').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=$$('[data-compare-mode]'),current=Math.max(0,tabs.indexOf(document.activeElement));let next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(current+1)%tabs.length:(current-1+tabs.length)%tabs.length;event.preventDefault();tabs[next].focus();tabs[next].click();});
  $('#appToast').addEventListener('click',event=>{const button=event.target.closest('[data-toast-action]');if(!button)return;const action=toastActions.get(button.dataset.toastAction);if(action)action();});
}

function showToast(message,actions=[]) {
  const toast=$('#appToast');clearTimeout(toastTimer);toastActions.clear();
  toast.innerHTML=`<span>${esc(message)}</span>${actions.map((action,index)=>{const key=String(index);toastActions.set(key,action.run);return`<button type="button" data-toast-action="${key}">${esc(action.label)}</button>`;}).join('')}`;
  toast.hidden=false;
  const hide=()=>{if(toast.matches(':focus-within')){toastTimer=setTimeout(hide,1000);return;}toast.hidden=true;toastActions.clear();};
  toastTimer=setTimeout(hide,7000);
}

async function refreshStaleRecord(error) {
  if(['REVISION_CONFLICT','RECORD_NOT_FOUND'].includes(error?.code))await refreshAfterCommit('최신 기록 확인');
}

function currentHyperTrainingRecord() {
  if(state.training.capType==='none')return null;
  if(state.condition==='shadow'||!['attack','defense','stamina'].some(key=>state.training.target[key]>state.ivs[key]))return null;
  return{phase:state.training.phase,capType:state.training.capType,silverStat:state.training.capType==='silver'?state.training.silverStat:null,targetIvs:{...state.training.target},goodBuddy:state.training.goodBuddy};
}

async function quickSaveCurrent() {
  const button=$('#quickSave');
  if(!state.collection.repo){showToast(state.collection.error||'보유함 저장소를 아직 준비하지 못했습니다.');return;}
  button.disabled=true;
  try {
    const maxKind=state.maxEligible&&recordMaxKindSupported(state.maxKind,state.selected)?state.maxKind:'none';
    const chargedMoves=state.currentMoves.charged.filter((id,index,items)=>id&&items.indexOf(id)===index);
    const record=Collection.createRecordFromState(state.selected,{condition:state.condition,ivs:{...state.ivs},level:state.level,apex:state.apex,training:state.training},{maxKind,hyperTraining:currentHyperTrainingRecord(),moves:{fast:state.currentMoves.fast,charged:chargedMoves}});
    const saved=await state.collection.repo.add(record);if(!await refreshAfterCommit('현재 개체 저장'))return;
    showToast(`${displayName(state.selected)} ${state.ivs.attack}/${state.ivs.defense}/${state.ivs.stamina}을(를) 보유함에 저장했습니다.`,[
      {label:'상세 입력',run:()=>openRecordEditor(saved.id)},
      {label:'실행 취소',run:async()=>{try{await state.collection.repo.remove(saved.id,{expectedRevision:saved.revision});if(await refreshAfterCommit('실행 취소'))showToast('방금 저장한 개체를 삭제했습니다.');}catch(error){await refreshStaleRecord(error);showToast(error.message);}}}
    ]);
  } catch(error) {
    console.error(error);showToast(`저장하지 못했습니다. ${error.message}`);
  } finally {button.disabled=false;}
}

function recordPokemon(record) { return state.byKey.get(record.speciesKey); }
function statusLabel(status) { return({normal:'일반',shadow:'그림자',purified:'정화됨'})[status]||status; }
function maxKindLabel(kind) { return({none:'일반 개체',dynamax:'다이맥스',gigantamax:'거다이맥스'})[kind]||kind; }
function recordMaxKindSupported(kind,pokemon) { return kind==='dynamax'?pokemon?.dynamax===true:kind==='gigantamax'?pokemon?.gigantamax===true:false; }
function recordMaxSupported(record,pokemon) { return recordMaxKindSupported(record.max.kind,pokemon); }
function effectiveSnapshot(record) { return Collection.recordToSnapshot(record,{training:'effective'}); }
function recordPveProfile(record,pokemon,stabTypes=pokemon.types.map(type=>type.id)) {
  const fast=record.moves.fast?moveForPokemon(pokemon,record.moves.fast,'fast'):null,charged=record.moves.charged.map(id=>moveForPokemon(pokemon,id,'charged')).filter(Boolean);
  if(fast&&charged.length){const profile=pveProfile({...pokemon,moves:{fast:[fast],charged}},stabTypes);if(profile.raw)return{profile,usesStored:true};}
  return{profile:pveProfile(pokemon,stabTypes),usesStored:false};
}
function recordMaxAttackText(record,pokemon) {
  if(record.max.kind==='gigantamax')return'종 고유 G-Max 기술';
  const fast=record.moves.fast?moveForPokemon(pokemon,record.moves.fast,'fast'):null;return fast?`${fast.typeKo||TYPE_KO[fast.type]||fast.type} · ${moveName(fast.id,fast)}`:'노말 기술 미입력';
}

function recordMetric(record,mode=state.collection.sort) {
  const cacheKey=`${record.id}:${record.revision}:${mode}`;
  if(state.collection.metricCache.has(cacheKey))return state.collection.metricCache.get(cacheKey);
  const pokemon=recordPokemon(record),snapshot=effectiveSnapshot(record);
  let value={primary:['dex','great','ultra','master'].includes(mode)?Infinity:-Infinity,secondary:Infinity,text:'계산 불가'};
  if(mode==='updated')value={primary:Date.parse(record.updatedAt)||0,secondary:0,text:`수정 ${String(record.updatedAt).slice(0,10)}`};
  else if(mode==='ivTotal'){const total=snapshot.ivs.attack+snapshot.ivs.defense+snapshot.ivs.stamina;value={primary:total,secondary:0,text:`IV ${total}/45${record.hyperTraining?.phase==='completed'?' · 특훈 완료':''}`};}
  else if(!pokemon){state.collection.metricCache.set(cacheKey,value);return value;}
  else if(mode==='dex')value={primary:pokemon.dex,secondary:pokemon.formSlug==='normal'?0:1,text:`${padDex(pokemon.dex)} · ${formLabel(pokemon)}`};
  else if(LEAGUES[mode]){
    const league=LEAGUES[mode],result=evaluate(pokemon,mode,snapshot),meta=snapshot.status==='shadow'?null:state.pvp.leagues[mode]?.[pokemon.speciesKey],currentCp=statsAt(pokemon,snapshot.ivs,snapshot.level).cp,tooHigh=league.cap!==Infinity&&currentCp>league.cap,metaMissing=snapshot.status==='shadow'?'그림자형 자료 없음':'자료 없음';
    value={primary:(tooHigh?1000000:0)+(meta?Number(meta.rank):999999),secondary:result.rank?.rank??999999,text:`종 메타 ${meta?`#${meta.rank}`:metaMissing} · IV ${result.rank?`#${result.rank.rank.toLocaleString()}`:'–'}${tooHigh?` · 현재 CP ${currentCp.toLocaleString()} 초과`:''}`};
  } else if(mode==='pve'){
    const stats=Mechanics.applyStatusModifiers(statsAt(pokemon,snapshot.ivs,snapshot.level),snapshot.status),{profile,usesStored}=recordPveProfile(record,pokemon),index=stats.attack*(profile.coherent?.score||profile.raw?.score||0);
    value={primary:index,secondary:0,text:`${usesStored?'보유 기술':'추천 기술 잠재'} 화력 ${index.toFixed(0)}`};
  } else if(mode==='max'){
    const role=archetype(pokemon),weights=role.key==='attack'?[.5,.25,.25]:role.key==='stamina'?[.25,.3,.45]:[.3,.4,.3],eligible=recordMaxSupported(record,pokemon)&&record.status!=='shadow',score=eligible?(snapshot.ivs.attack*weights[0]+snapshot.ivs.defense*weights[1]+snapshot.ivs.stamina*weights[2])/15*100:-1;
    value={primary:score,secondary:0,text:eligible?`${role.name} ${score.toFixed(1)}점 · ${recordMaxAttackText(record,pokemon)}`:'Max 자격 없음'};
  } else if(mode==='mega'){
    const eligible=record.status!=='shadow'&&pokemon.mega.length>0;
    const scores=eligible?pokemon.mega.map(mega=>{const megaPokemon={...pokemon,stats:mega.stats},stats=statsAt(megaPokemon,snapshot.ivs,snapshot.level),{profile,usesStored}=recordPveProfile(record,pokemon,mega.types.map(type=>type.id));return{name:mega.name,score:stats.attack*(profile.coherent?.score||profile.raw?.score||0),usesStored};}):[];
    const best=scores.sort((a,b)=>b.score-a.score)[0];value={primary:best?.score??-1,secondary:0,text:best?`${best.usesStored?'보유 기술':'추천 기술 잠재'} ${best.name} ${best.score.toFixed(0)}`:'Mega 운용 불가'};
  }
  state.collection.metricCache.set(cacheKey,value);return value;
}

function pvpSortBase(record,mode) {
  const cacheKey=`${record.id}:${record.revision}:${mode}:sort-base`;
  if(state.collection.metricCache.has(cacheKey))return state.collection.metricCache.get(cacheKey);
  const pokemon=recordPokemon(record);if(!pokemon){const missing={bucket:3,metaRank:Infinity,dex:Infinity,speciesKey:record.speciesKey};state.collection.metricCache.set(cacheKey,missing);return missing;}
  const snapshot=effectiveSnapshot(record),league=LEAGUES[mode],currentCp=statsAt(pokemon,snapshot.ivs,snapshot.level).cp,tooHigh=league.cap!==Infinity&&currentCp>league.cap,meta=snapshot.status==='shadow'?null:state.pvp.leagues[mode]?.[pokemon.speciesKey],value={bucket:tooHigh?2:meta?0:1,metaRank:meta?Number(meta.rank):Infinity,dex:pokemon.dex,speciesKey:pokemon.speciesKey};state.collection.metricCache.set(cacheKey,value);return value;
}

function compareRecordsForSort(a,b) {
  if(a.favorite!==b.favorite)return Number(b.favorite)-Number(a.favorite);
  const mode=state.collection.sort;
  if(LEAGUES[mode]){
    const ab=pvpSortBase(a,mode),bb=pvpSortBase(b,mode),baseOrder=ab.bucket-bb.bucket||ab.metaRank-bb.metaRank;
    if(baseOrder)return baseOrder;
    if(!Number.isFinite(ab.metaRank)&&ab.speciesKey!==bb.speciesKey)return ab.dex-bb.dex||ab.speciesKey.localeCompare(bb.speciesKey);
    const am=recordMetric(a,mode),bm=recordMetric(b,mode);return am.secondary-bm.secondary||ab.dex-bb.dex||String(a.id).localeCompare(String(b.id));
  }
  const am=recordMetric(a,mode),bm=recordMetric(b,mode);
  if(mode==='dex')return am.primary-bm.primary||am.secondary-bm.secondary||String(a.id).localeCompare(String(b.id));
  return bm.primary-am.primary||am.secondary-bm.secondary||String(a.id).localeCompare(String(b.id));
}

function filteredCollectionRecords() {
  const query=normalize(state.collection.query);
  return state.collection.records.filter(record=>{
    const pokemon=recordPokemon(record),haystack=[pokemon?displayName(pokemon):record.speciesKey,record.nickname,record.note,...record.tags].join(' ');
    return(!query||normalize(haystack).includes(query))&&(!state.collection.status||record.status===state.collection.status)&&(!state.collection.tag||record.tags.includes(state.collection.tag))&&(!state.collection.favorite||record.favorite);
  }).sort(compareRecordsForSort);
}

function renderCollection() {
  const list=$('#collectionList');if(!list)return;
  const total=state.collection.records.length;
  if(state.collection.error){list.innerHTML=`<div id="collectionStorageError" class="storage-error">${esc(state.collection.error)}</div>`;$('#collectionSummary').textContent='보유함을 사용할 수 없습니다.';return;}
  const recovery=$('#collectionRecoveryWarning'),recoveryCount=state.collection.recovery.length;recovery.hidden=!recoveryCount;$('#collectionRecoveryCount').textContent=String(recoveryCount);
  const tags=[...new Set(state.collection.records.flatMap(record=>record.tags))].sort((a,b)=>a.localeCompare(b,'ko')),tagSelect=$('#collectionTag'),selectedTag=state.collection.tag;
  tagSelect.innerHTML='<option value="">모든 태그</option>'+tags.map(tag=>`<option value="${esc(tag)}">${esc(tag)}</option>`).join('');tagSelect.value=tags.includes(selectedTag)?selectedTag:'';if(tagSelect.value!==selectedTag)state.collection.tag='';
  const records=filteredCollectionRecords(),visible=records.slice(0,state.collection.limit),recoveryText=recoveryCount?` · 복구 원본 ${recoveryCount.toLocaleString()}건`:'';$('#collectionSummary').textContent=(records.length===total?`${total.toLocaleString()}마리 저장됨`:`${total.toLocaleString()}마리 중 ${records.length.toLocaleString()}마리 표시`)+recoveryText;
  $('#collectionSearch').value=state.collection.query;$('#collectionStatus').value=state.collection.status;$('#collectionSort').value=state.collection.sort;$('#collectionFavorite').checked=state.collection.favorite;
  $('#toggleCompare').classList.toggle('active',state.collection.compareMode);$('#toggleCompare').textContent=state.collection.compareMode?'비교 선택 중':'비교 선택';
  list.innerHTML=records.length?visible.map(collectionCardHtml).join('')+(visible.length<records.length?`<button class="collection-load-more" type="button" data-collection-more>더 보기 · ${visible.length.toLocaleString()}/${records.length.toLocaleString()}</button>`:''):`<div class="collection-empty"><strong>${total?'필터에 맞는 개체가 없습니다.':'아직 저장한 포켓몬이 없습니다.'}</strong><span>${total?'검색어나 필터를 바꿔보세요.':'도감에서 IV와 상태를 입력한 뒤 “현재 개체 저장”을 누르세요.'}</span></div>`;
  updateCompareBar();
}

function collectionCardHtml(record) {
  const pokemon=recordPokemon(record),snapshot=effectiveSnapshot(record),selected=state.collection.selectedIds.has(record.id),metric=recordMetric(record),name=record.nickname|| (pokemon?displayName(pokemon):record.speciesKey),baseName=record.nickname&&pokemon?displayName(pokemon):'',image=pokemon?.image||'',maxText=record.max.kind==='none'?'':` · ${maxKindLabel(record.max.kind)}`,trainingText=record.hyperTraining?.phase==='completed'?' · 특훈 완료':'';
  const actions=state.collection.compareMode?`<button class="compare-check" type="button" data-record-compare="${esc(record.id)}" aria-pressed="${selected}">${selected?'선택됨':'선택'}</button>`:`<div class="collection-card-actions"><button class="favorite-button ${record.favorite?'active':''}" type="button" data-record-favorite="${esc(record.id)}" aria-label="${record.favorite?'즐겨찾기 해제':'즐겨찾기'}">${record.favorite?'★':'☆'}</button><button type="button" data-record-edit="${esc(record.id)}">편집</button><button type="button" data-record-open="${esc(record.id)}">도감</button></div>`;
  return `<article class="collection-card ${selected?'selected':''}" data-record-id="${esc(record.id)}"><img src="${esc(image)}" alt=""><div class="collection-card-copy"><h3>${esc(name)}${baseName?`<span>${esc(baseName)}</span>`:''}</h3><p>${pokemon?`${padDex(pokemon.dex)} · `:''}${esc(statusLabel(record.status))} · IV ${snapshot.ivs.attack}/${snapshot.ivs.defense}/${snapshot.ivs.stamina} · Lv.${record.level}${esc(trainingText+maxText)}</p><p class="collection-card-metric">${esc(metric.text)}</p>${record.tags.length?`<div class="collection-tags">${record.tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}${pokemon?'':`<p class="form-error">현재 도감에 없는 폼을 백업 보존 중입니다.</p>`}</div>${actions}</article>`;
}

function setCompareMode(enabled) {
  state.collection.compareMode=enabled;if(!enabled)state.collection.selectedIds.clear();renderCollection();
}

function updateCompareBar() {
  const count=state.collection.selectedIds.size,bar=$('#compareBar');bar.hidden=!state.collection.compareMode;$('#compareSelection').textContent=`${count}/4 선택`;$('#openCompare').disabled=count<2||count>4;
}

async function handleCollectionClick(event) {
  if(event.target.closest('[data-collection-more]')){state.collection.limit+=100;renderCollection();return;}
  const favorite=event.target.closest('[data-record-favorite]');
  if(favorite){const record=state.collection.records.find(item=>item.id===favorite.dataset.recordFavorite);if(!record)return;try{await state.collection.repo.update(record.id,{favorite:!record.favorite},{expectedRevision:record.revision});await refreshAfterCommit('즐겨찾기 변경');}catch(error){await refreshStaleRecord(error);showToast(error.message);}return;}
  const edit=event.target.closest('[data-record-edit]');if(edit){openRecordEditor(edit.dataset.recordEdit);return;}
  const open=event.target.closest('[data-record-open]');if(open){loadRecordIntoDetail(open.dataset.recordOpen);return;}
  const compare=event.target.closest('[data-record-compare]');if(compare){const id=compare.dataset.recordCompare;if(state.collection.selectedIds.has(id))state.collection.selectedIds.delete(id);else if(state.collection.selectedIds.size<4)state.collection.selectedIds.add(id);else{showToast('한 번에 최대 4마리까지 비교할 수 있습니다.');return;}renderCollection();}
}

function optionHtml(value,label,selected=false) { return `<option value="${esc(value)}"${selected?' selected':''}>${esc(label)}</option>`; }

function openRecordEditor(id) {
  const record=state.collection.records.find(item=>item.id===id);if(!record)return;
  state.collection.editing=structuredClone(record);$('#recordId').value=record.id;$('#recordNickname').value=record.nickname||'';
  const pokemon=recordPokemon(record),forms=pokemon?(state.byDex.get(pokemon.dex)||[pokemon]):[];
  $('#recordSpecies').innerHTML=forms.length?forms.map(form=>optionHtml(form.speciesKey,displayName(form),form.speciesKey===record.speciesKey)).join(''):optionHtml(record.speciesKey,`${record.speciesKey} (현재 도감에 없음)`,true);
  $('#recordStatus').value=record.status;
  for(const [key,idName] of [['attack','recordAttack'],['defense','recordDefense'],['stamina','recordStamina']]){const value=String(record.ivs[key]);$('#'+idName).value=value;$('#'+idName+'Number').value=value;}
  $('#recordLevel').value=record.level;$('#recordLevel').nextElementSibling.value=record.level;
  $('#recordMaxKind').value=record.max.kind;$('#recordApex').checked=record.apex;$('#recordFavorite').checked=record.favorite;$('#recordTags').value=record.tags.join(', ');$('#recordNote').value=record.note;
  $('#recordDialogTitle').textContent=`${record.nickname||pokemon?.name||record.speciesKey} 편집`;$('#recordError').hidden=true;
  refreshRecordFormOptions(record.moves);const dialog=$('#recordDialog');if(!dialog.open)dialog.showModal();
}

function recordFormMoveValues() {
  return{fast:$('#recordFastMove').value||null,charged:[$('#recordChargedMove1').value,$('#recordChargedMove2').value].filter(Boolean)};
}

function availableChargedMoves(pokemon,status='normal',apex=false) {
  const moves=new Map((pokemon?.moves.charged||[]).map(move=>[move.id,{...move}])),ids=[];
  if(status==='shadow'){
    ids.push(pokemon?.shadow?.shadowMove||'FRUSTRATION');
    if(apex&&pokemon?.shadow?.apex?.shadowMove)ids.push(pokemon.shadow.apex.shadowMove);
  }else if(status==='purified'){
    ids.push(pokemon?.shadow?.purifiedMove||'RETURN');
    if(pokemon?.shadow?.apex?.purifiedMove)ids.push(pokemon.shadow.apex.purifiedMove);
  }
  for(const id of new Set(ids.filter(Boolean))){const known=state.moveById.get(id)||moves.get(id)||{};moves.set(id,{...known,id,ko:scenarioMoveName(id),statusOnly:true});}
  return[...moves.values()];
}

function statusExclusiveMoveIds(pokemon) {
  const shadow=pokemon?.shadow;
  return new Set([
    shadow?.shadowMove||(pokemon?.shadowEligible?'FRUSTRATION':null),
    shadow?.purifiedMove||(pokemon?.shadowEligible?'RETURN':null),
    shadow?.apex?.shadowMove,
    shadow?.apex?.purifiedMove
  ].filter(Boolean));
}

function clearIncompatibleCurrentStatusMoves() {
  const pokemon=state.selected;if(!pokemon)return;
  const allowed=new Set(availableChargedMoves(pokemon,state.condition,state.apex).map(move=>move.id)),exclusive=statusExclusiveMoveIds(pokemon);
  state.currentMoves.charged=(state.currentMoves.charged||[]).map(id=>id&&exclusive.has(id)&&!allowed.has(id)?null:id);
}

function moveChoiceLabel(move) {
  return `${move.ko||moveName(move.id,move)}${moveAccessInfo(move)?' · 특별 기술':''}${move.statusOnly?' · 상태 전용':''}`;
}

function syncCurrentMovesFromForm() {
  const first=$('#currentChargedMove1')?.value||'',second=$('#currentChargedMove2')?.value||'';
  if(second&&second===first)$('#currentChargedMove2').value='';
  const charged=[first||null,second&&second!==first?second:null];
  state.currentMoves={fast:$('#currentFastMove')?.value||null,charged};
}

function refreshCurrentMoveOptions() {
  const pokemon=state.selected;if(!pokemon||!$('#currentFastMove'))return;
  const current=state.currentMoves||{fast:null,charged:[]},chargedMoves=availableChargedMoves(pokemon,state.condition,state.apex);
  const fill=(selector,items,value,emptyLabel)=>{const valid=items.some(move=>move.id===value),selected=value||null,legacy=selected&&!valid?optionHtml(selected,`${moveName(selected)} · 이전 데이터`,true):'';$(selector).innerHTML=optionHtml('',emptyLabel,!selected)+legacy+items.map(move=>optionHtml(move.id,moveChoiceLabel(move),move.id===selected)).join('');return selected;};
  const fast=fill('#currentFastMove',pokemon.moves.fast,current.fast,'모름'),charged1=fill('#currentChargedMove1',chargedMoves,current.charged[0]||null,'모름'),charged2=fill('#currentChargedMove2',chargedMoves,current.charged[1]||null,'없음·모름');
  const distinctCharged2=charged2&&charged2!==charged1?charged2:null;
  state.currentMoves={fast,charged:[charged1,distinctCharged2]};
  if(charged2&&!distinctCharged2)$('#currentChargedMove2').value='';
}

function recordChargedMoveOptions(pokemon) {
  return availableChargedMoves(pokemon,$('#recordStatus').value,$('#recordApex').checked);
}

function refreshRecordFormOptions(savedMoves=null) {
  const record=state.collection.editing,pokemon=state.byKey.get($('#recordSpecies').value),moves=savedMoves||record?.moves||{fast:null,charged:[]};
  const fill=(selector,items,current,emptyLabel)=>{const known=items.some(move=>move.id===current),legacy=current&&!known?optionHtml(current,`${moveName(current)} · 이전 데이터`,true):'';$(selector).innerHTML=optionHtml('',emptyLabel,!current)+legacy+items.map(move=>optionHtml(move.id,moveChoiceLabel(move),move.id===current)).join('');};
  const chargedMoves=recordChargedMoveOptions(pokemon);
  fill('#recordFastMove',pokemon?.moves.fast||[],moves.fast,'모름');fill('#recordChargedMove1',chargedMoves,moves.charged[0]||null,'모름');fill('#recordChargedMove2',chargedMoves,moves.charged[1]||null,'없음·모름');refreshRecordFormEligibility();
}

function refreshRecordFormEligibility() {
  const pokemon=state.byKey.get($('#recordSpecies').value),status=$('#recordStatus'),max=$('#recordMaxKind'),apex=$('#recordApex');
  for(const option of status.options)if(option.value!=='normal')option.disabled=!pokemon?.shadowEligible&&option.value!==status.value;
  const dynamax=max.querySelector('[value="dynamax"]'),gigantamax=max.querySelector('[value="gigantamax"]');dynamax.disabled=!pokemon?.dynamax&&max.value!=='dynamax';gigantamax.disabled=!pokemon?.gigantamax&&max.value!=='gigantamax';
  if(status.value==='shadow'){max.value='none';max.disabled=true;}else max.disabled=false;
  if(status.value!=='shadow'){apex.checked=false;apex.disabled=true;}else apex.disabled=!pokemon?.shadow?.apex&&!apex.checked;
}

function tagsFromInput(value) { return [...new Set(value.split(',').map(tag=>tag.trim()).filter(Boolean))].slice(0,20); }

async function saveRecordEdits(event) {
  event.preventDefault();const current=state.collection.records.find(item=>item.id===$('#recordId').value);if(!current)return;
  const charged=[$('#recordChargedMove1').value,$('#recordChargedMove2').value].filter((id,index,items)=>id&&items.indexOf(id)===index),ivs={attack:Number($('#recordAttack').value),defense:Number($('#recordDefense').value),stamina:Number($('#recordStamina').value)},status=$('#recordStatus').value;
  let hyperTraining=current.hyperTraining,trainingCleared=false;
  if(hyperTraining){const keys=['attack','defense','stamina'],below=keys.some(key=>hyperTraining.targetIvs[key]<ivs[key]),noIncrease=!keys.some(key=>hyperTraining.targetIvs[key]>ivs[key]),silverMismatch=hyperTraining.capType==='silver'&&keys.some(key=>key!==hyperTraining.silverStat&&hyperTraining.targetIvs[key]!==ivs[key]);if(status==='shadow'||below||noIncrease||silverMismatch){hyperTraining=null;trainingCleared=true;}}
  const patch={speciesKey:$('#recordSpecies').value,status,ivs,level:Number($('#recordLevel').value),moves:{fast:$('#recordFastMove').value||null,charged},max:{kind:status==='shadow'?'none':$('#recordMaxKind').value},apex:status==='shadow'&&$('#recordApex').checked,nickname:$('#recordNickname').value.trim(),favorite:$('#recordFavorite').checked,tags:tagsFromInput($('#recordTags').value),note:$('#recordNote').value,hyperTraining};
  try {
    const candidate={...current,...patch},validation=Collection.validateRecord(candidate);if(!validation.valid)throw new Error(validation.errors.map(item=>item.message).join(' '));
    const audit=Collection.auditRecord(candidate,state.byKey,state.moveById);await state.collection.repo.update(current.id,patch,{expectedRevision:current.revision});$('#recordDialog').close();if(!await refreshAfterCommit('보유 개체 변경'))return;showToast(trainingCleared?'IV·상태 변경과 맞지 않는 특훈 계획을 제거하고 저장했습니다.':audit.warnings.length?`보유 개체를 저장했고 현재 도감과 다른 값 ${audit.warnings.length}개를 그대로 보존했습니다.`:'보유 개체 정보를 저장했습니다.');
  } catch(error) {await refreshStaleRecord(error);$('#recordError').textContent=error.message;$('#recordError').hidden=false;}
}

async function deleteEditingRecord() {
  const record=state.collection.records.find(item=>item.id===$('#recordId').value);if(!record||!confirm('이 보유 개체를 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;
  try{await state.collection.repo.remove(record.id,{expectedRevision:record.revision});state.collection.selectedIds.delete(record.id);$('#recordDialog').close();if(await refreshAfterCommit('보유 개체 삭제'))showToast('보유 개체를 삭제했습니다.');}catch(error){await refreshStaleRecord(error);$('#recordError').textContent=error.message;$('#recordError').hidden=false;}
}

function loadRecordIntoDetail(id) {
  const record=state.collection.records.find(item=>item.id===id),pokemon=record&&recordPokemon(record);if(!record||!pokemon){showToast('현재 도감에서 이 폼을 열 수 없습니다. 백업에는 계속 보존됩니다.');return;}
  const snapshot=Collection.recordToSnapshot(record,{training:'base'});state.ivs={...snapshot.ivs};state.level=snapshot.level;selectPokemon(record.speciesKey,false);
  state.ivs={...snapshot.ivs};state.level=snapshot.level;state.currentMoves={fast:record.moves.fast,charged:[...record.moves.charged]};state.condition=snapshot.status;state.maxEligible=record.max.kind!=='none';state.maxKind=record.max.kind;state.apex=record.apex;
  state.training=record.hyperTraining?{capType:record.hyperTraining.capType,silverStat:record.hyperTraining.silverStat||'attack',target:{...record.hyperTraining.targetIvs},goodBuddy:record.hyperTraining.goodBuddy,phase:record.hyperTraining.phase}:{capType:'none',silverStat:'attack',target:{...snapshot.ivs},goodBuddy:false,phase:'planned'};
  history.pushState(null,'',`#pokemon=${encodeURIComponent(record.speciesKey)}`);renderDetail();document.body.classList.add('show-detail');
  for(const dialog of [$('#recordDialog'),$('#compareDialog'),$('#collectionDialog')])if(dialog.open)dialog.close();
  showToast(`${record.nickname||displayName(pokemon)}의 저장값을 도감에 불러왔습니다.`);
}

function backupMetadata() {
  return{appVersion:APP_VERSION,dataSnapshots:{pokemonUpdated:state.dataDate,pvpGeneratedAt:state.pvp.generatedAt||state.pvp.updated||''}};
}

function downloadText(text,filename,type) {
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function exportCollection(format) {
  if(!state.collection.repo){showToast(state.collection.error||'보유함을 사용할 수 없습니다.');return;}
  try {
    const date=new Date().toISOString().slice(0,10),text=format==='json'?await state.collection.repo.exportJSON(backupMetadata()):await state.collection.repo.exportCSV(backupMetadata());
    downloadText(text,`go-valuedex-collection-${date}.${format}`,format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8');showToast(`${format.toUpperCase()} 파일로 ${state.collection.records.length}마리를 내보냈습니다.`);
  } catch(error) {showToast(`내보내지 못했습니다. ${error.message}`);}
}

async function exportCollectionRecovery() {
  if(!state.collection.repo||!state.collection.recovery.length)return;
  try {
    const date=new Date().toISOString().slice(0,10),text=await state.collection.repo.exportRecoveryJSON({appVersion:APP_VERSION});
    downloadText(text,`go-valuedex-recovery-${date}.json`,'application/json;charset=utf-8');showToast(`복구가 필요한 원본 ${state.collection.recovery.length}건을 별도 JSON으로 내보냈습니다.`);
  } catch(error) {showToast(`복구 원본을 내보내지 못했습니다. ${error.message}`);}
}

async function importCollectionFile(event) {
  const file=event.target.files?.[0];event.target.value='';if(!file||!state.collection.repo)return;
  if(file.size>Collection.MAX_IMPORT_BYTES){showToast(`파일이 ${(Collection.MAX_IMPORT_BYTES/1024/1024).toFixed(0)}MB 제한을 초과해 읽지 않았습니다.`);return;}
  const mode=$('#collectionImportMode').value;
  if(mode==='replace'&&!confirm('가져온 파일로 현재 보유함 전체를 교체할까요? 파일 검증이 끝난 뒤 한 번에 적용됩니다.'))return;
  let report;
  try {
    const text=await file.text(),isCsv=file.name.toLowerCase().endsWith('.csv')||file.type.includes('csv'),options={mode,conflict:'newer'};report=isCsv?await state.collection.repo.importCSV(text,options):await state.collection.repo.importJSON(text,options);
  } catch(error) {
    console.error(error);const details=error.errors?.map(item=>item.message).filter(Boolean).join(' ')||error.message;showToast(`파일을 적용하지 않았습니다. ${details}`);
    return;
  }
  state.collection.selectedIds.clear();state.collection.limit=100;if(!await refreshAfterCommit('파일 가져오기'))return;const warningCount=(report.warnings?.length||0)+state.collection.records.reduce((sum,record)=>sum+Collection.auditRecord(record,state.byKey,state.moveById).warnings.length,0),warningText=warningCount?` · 현재 도감과 다른 값 ${warningCount}개 보존`:'';showToast(`가져오기 완료: 추가 ${report.added}, 갱신 ${report.updated}, 건너뜀 ${report.skipped}${warningText}`);
}

async function clearCollection() {
  if(!state.collection.repo||(!state.collection.records.length&&!state.collection.recovery.length))return;
  if(!confirm('보유함의 모든 기록을 삭제할까요? JSON 백업이 없다면 복구할 수 없습니다.'))return;
  try{await state.collection.repo.clear();}catch(error){showToast(`보유함을 비우지 못했습니다. ${error.message}`);return;}state.collection.selectedIds.clear();if(await refreshAfterCommit('보유함 비우기'))showToast('보유함의 모든 기록을 삭제했습니다.');
}

function selectedCollectionRecords() { return [...state.collection.selectedIds].map(id=>state.collection.records.find(record=>record.id===id)).filter(Boolean).slice(0,4); }

function openComparison() {
  const records=selectedCollectionRecords();if(records.length<2||records.length>4)return;renderComparison();const dialog=$('#compareDialog');if(!dialog.open)dialog.showModal();
}

function recordMoveText(record) {
  const fast=record.moves.fast?moveName(record.moves.fast):'모름',charged=record.moves.charged.length?record.moves.charged.map(id=>moveName(id)).join(' · '):'모름';return`${fast} / ${charged}`;
}

function comparisonRows(record,pokemon,mode) {
  if(!pokemon)return[{label:'데이터 상태',value:'현재 도감에 없는 폼',score:null}];
  const snapshot=effectiveSnapshot(record),current=Mechanics.applyStatusModifiers(statsAt(pokemon,snapshot.ivs,snapshot.level),snapshot.status),common=[
    {label:'상태',value:`${statusLabel(record.status)}${record.max.kind!=='none'?` · ${maxKindLabel(record.max.kind)}`:''}`,score:null},
    {label:'IV',value:`${snapshot.ivs.attack}/${snapshot.ivs.defense}/${snapshot.ivs.stamina}${record.hyperTraining?.phase==='completed'?' · 특훈 완료':''}`,score:snapshot.ivs.attack+snapshot.ivs.defense+snapshot.ivs.stamina},
    {label:'레벨·현재 CP',value:`Lv.${snapshot.level} · CP ${current.cp.toLocaleString()}`,score:current.cp},
    {label:'보유 기술',value:recordMoveText(record),score:null}
  ];
  if(LEAGUES[mode]){
    const league=LEAGUES[mode],result=evaluate(pokemon,mode,snapshot),meta=snapshot.status==='shadow'?null:state.pvp.leagues[mode]?.[pokemon.speciesKey],tooHigh=league.cap!==Infinity&&current.cp>league.cap;
    return common.concat([
      {label:'용도 판정',value:`${result.title}${tooHigh?' · 현재 CP로 참가 불가':''}`,score:tooHigh?-1:(result.rank?.percent??-1)},
      {label:'현재 참가',value:tooHigh?`불가 · CP ${current.cp.toLocaleString()}가 ${league.cap.toLocaleString()} 초과`:`가능 · CP ${current.cp.toLocaleString()}`,score:tooHigh?0:1},
      {label:'종 메타',value:meta?`#${meta.rank} · ${meta.score}점`:snapshot.status==='shadow'?'그림자형 자료 없음':'현재 자료 없음',score:meta?100000-meta.rank:-1},
      {label:'동종 IV 순위',value:result.rank?`#${result.rank.rank.toLocaleString()} · 효율 ${result.rank.percent.toFixed(2)}%`:'계산 불가',score:result.rank?.percent??-1}
    ]);
  }
  if(mode==='pve'){
    const metric=recordMetric(record,'pve'),result=evaluate(pokemon,'pve',snapshot);
    return common.concat([{label:'용도 판정',value:result.title,score:metric.primary},{label:'실전 공격',value:current.attack.toFixed(1),score:current.attack},{label:'중립 화력 지수',value:metric.text,score:metric.primary}]);
  }
  if(mode==='max'){
    const metric=recordMetric(record,'max'),supported=recordMaxSupported(record,pokemon)&&record.status!=='shadow',result=evaluate(pokemon,'max',{...snapshot,maxEligible:supported}),maxValue=record.max.kind==='none'?'없음':supported?maxKindLabel(record.max.kind):`${maxKindLabel(record.max.kind)} · 현재 폼과 불일치`;
    return common.concat([{label:'용도 판정',value:result.title,score:metric.primary},{label:'Max 자격',value:maxValue,score:supported?1:0},{label:'Max 공격 기준',value:recordMaxAttackText(record,pokemon),score:null},{label:'역할 IV',value:metric.text,score:metric.primary}]);
  }
  const metric=recordMetric(record,'mega'),megaNames=pokemon.mega.map(mega=>mega.name).join(' · ');
  return common.concat([{label:'Mega 가능',value:record.status==='shadow'?'그림자 상태에서는 불가':megaNames||'해당 없음',score:metric.primary},{label:'Mega 화력 지수',value:metric.text,score:metric.primary},{label:'주의',value:'Mega는 일시적 형태이며 Max와 동시에 사용할 수 없습니다.',score:null}]);
}

function renderComparison() {
  const records=selectedCollectionRecords(),container=$('#compareTable');if(!container||records.length<2){if(container)container.innerHTML='<p class="collection-empty">비교할 개체를 2마리 이상 선택하세요.</p>';return;}
  const columns=records.map(record=>({record,pokemon:recordPokemon(record),rows:comparisonRows(record,recordPokemon(record),state.collection.compareView)})),labels=[...new Set(columns.flatMap(column=>column.rows.map(row=>row.label)))];
  const rows=labels.map(label=>{const values=columns.map(column=>column.rows.find(row=>row.label===label)||{value:'–',score:null}),scores=values.map(value=>value.score).filter(Number.isFinite),best=scores.length?Math.max(...scores):null;return`<tr><th scope="row">${esc(label)}</th>${values.map(value=>`<td class="${best!==null&&value.score===best&&scores.filter(score=>score===best).length===1?'best-value':''}">${esc(value.value)}</td>`).join('')}</tr>`;}).join('');
  container.innerHTML=`<table class="compare-table"><thead><tr><th scope="col">항목</th>${columns.map(({record,pokemon})=>`<th scope="col"><img src="${esc(pokemon?.image||'')}" alt=""><strong>${esc(record.nickname||(pokemon?displayName(pokemon):record.speciesKey))}</strong><br><small>${esc(pokemon?padDex(pokemon.dex):record.speciesKey)}</small></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

window.ValueDexAppReady=init();
