(function installBossAnalysis() {
  'use strict';

  const BossEngine = window.ValueDexPveBoss || window.PveBoss;
  const TIER_MAP = Object.freeze({tier1:'one',tier3:'three',tier5:'five',mega:'mega',megaLegendary:'megaLegendary',custom:'five'});
  const WEATHER_LABELS = Object.freeze({none:'부스트 없음',clear:'맑음',rain:'비',partlyCloudy:'약간 구름',cloudy:'흐림',windy:'강풍',snow:'눈',fog:'안개'});
  const EXCLUDED_ATTACKERS = new Set(['890:eternamax']);
  const STATUS_CHARGED_MOVES = Object.freeze({
    FRUSTRATION:Object.freeze({id:'FRUSTRATION',ko:'화풀이',en:'Frustration',type:'normal',typeKo:'노말',power:10,energy:-33,duration:2000,elite:false,status:'shadow'}),
    RETURN:Object.freeze({id:'RETURN',ko:'은혜갚기',en:'Return',type:'normal',typeKo:'노말',power:25,energy:-33,duration:500,elite:false,status:'purified'}),
    AEROBLAST_PLUS:Object.freeze({id:'AEROBLAST_PLUS',ko:'에어로블라스트+',en:'Aeroblast+',type:'flying',typeKo:'비행',power:200,energy:-100,duration:3500,elite:false,status:'shadow',dex:249,apex:true}),
    AEROBLAST_PLUS_PLUS:Object.freeze({id:'AEROBLAST_PLUS_PLUS',ko:'에어로블라스트++',en:'Aeroblast++',type:'flying',typeKo:'비행',power:225,energy:-100,duration:3500,elite:false,status:'purified',dex:249}),
    SACRED_FIRE_PLUS:Object.freeze({id:'SACRED_FIRE_PLUS',ko:'성스러운불꽃+',en:'Sacred Fire+',type:'fire',typeKo:'불꽃',power:135,energy:-100,duration:2500,elite:false,status:'shadow',dex:250,apex:true}),
    SACRED_FIRE_PLUS_PLUS:Object.freeze({id:'SACRED_FIRE_PLUS_PLUS',ko:'성스러운불꽃++',en:'Sacred Fire++',type:'fire',typeKo:'불꽃',power:155,energy:-100,duration:2500,elite:false,status:'purified',dex:250})
  });
  const RESULT_LIMIT = 20;
  let ready = false;
  let settingPreset = false;
  let tierManuallySelected = false;
  let hasRun = false;
  let rerunTimer = 0;
  let analysisRunId = 0;
  let bossForms = [];
  let bossFormsByKey = new Map();

  const byId = id => document.getElementById(id);
  const safe = value => typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const searchKey = value => String(value ?? '').toLocaleLowerCase('ko').replace(/[\s._'’\-♀♂:()]/g,'');
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const finiteMoveNumber = value => Number.isFinite(Number(value));
  const boundedInput = (id,fallback,integer=false) => {
    const input=byId(id),minimum=Number(input.min),maximum=Number(input.max),raw=input.value.trim()===''?NaN:Number(input.value);
    let value=Number.isFinite(raw)?raw:fallback;
    if(Number.isFinite(minimum))value=Math.max(minimum,value);
    if(Number.isFinite(maximum))value=Math.min(maximum,value);
    if(integer)value=Math.round(value);
    if(!Number.isFinite(raw)||raw!==value)input.value=String(value);
    return value;
  };
  const validFastMoves = pokemon => (pokemon?.moves?.fast || []).filter(move=>finiteMoveNumber(move.power)&&numeric(move.power)>=0&&numeric(move.energy)>0&&numeric(move.duration)>0);
  const validChargedMoves = pokemon => (pokemon?.moves?.charged || []).filter(move=>finiteMoveNumber(move.power)&&numeric(move.power)>=0&&numeric(move.energy)<0&&numeric(move.duration)>0);
  const pokemonName = pokemon => typeof displayName === 'function' ? displayName(pokemon) : pokemon?.name || pokemon?.speciesKey || '알 수 없음';
  const moveLabel = move => move?.ko || move?.en || move?.id || '알 수 없음';
  const typeLabel = type => TYPE_KO?.[type] || type;

  function moveAccessInfo(move) {
    if(move?.access)return move.access;
    if(move?.elite)return{kind:'elite_tm',tmLearnability:'elite_only',label:'이벤트·특별 진화·대단한 기술머신'};
    if(move?.status){
      const labels={FRUSTRATION:'그림자 포켓몬 포획',RETURN:'그림자 포켓몬 정화',AEROBLAST_PLUS:'APEX 그림자 루기아',AEROBLAST_PLUS_PLUS:'APEX 루기아 정화',SACRED_FIRE_PLUS:'APEX 그림자 칠색조',SACRED_FIRE_PLUS_PLUS:'APEX 칠색조 정화'};
      return{kind:'status',tmLearnability:'none',label:labels[move.id]||'그림자·정화 상태 전용'};
    }
    return null;
  }

  function moveAccessHelp(move) {
    const access=moveAccessInfo(move);if(!access)return'';
    return access.tmLearnability==='none'?`${access.label} · 모든 기술머신으로 배울 수 없음`:`${access.label} · 일반 기술머신으로 배울 수 없음`;
  }

  function moveAccessBadge(move) {
    const access=moveAccessInfo(move);if(!access)return'';const status=access.kind==='status',help=moveAccessHelp(move);
    if(status)return`<span class="boss-move-access status" data-access-kind="status" title="${safe(help)}">상태 전용</span>`;
    return`<span class="boss-move-access exclusive" data-access-kind="${safe(access.kind)}" title="${safe(help)}" aria-label="특별 기술, ${safe(help)}">특별 기술</span>`;
  }

  function resultMoveHtml(move) {
    return`${safe(moveLabel(move))}${moveAccessBadge(move)}`;
  }

  function moveAccessNotice(moves) {
    const unique=[...new Map(moves.filter(move=>moveAccessInfo(move)).map(move=>[move.id,move])).values()],exclusive=unique.filter(move=>moveAccessInfo(move).kind!=='status'),statusOnly=unique.filter(move=>moveAccessInfo(move).kind==='status');
    const notices=[];
    if(exclusive.length)notices.push(`<strong>특별 기술 포함</strong> ${exclusive.map(move=>`${safe(moveLabel(move))}: ${safe(moveAccessHelp(move))}`).join('<br>')}`);
    if(statusOnly.length)notices.push(`<strong>상태 전용 기술</strong> ${statusOnly.map(move=>`${safe(moveLabel(move))}: ${safe(moveAccessHelp(move))}`).join('<br>')}`);
    return notices.length?`<p class="boss-move-access-note">${notices.join('<br>')}</p>`:'';
  }

  function bossOptionLabel(pokemon) {
    const types=(pokemon.types||[]).map(type=>type.ko||typeLabel(type.id||type)).join('·');
    return `${typeof padDex==='function'?padDex(pokemon.dex):`#${pokemon.dex}`} ${pokemonName(pokemon)} · ${types}${pokemon.raidTransformation?' · 보스 폼':''}`;
  }

  function bossMatches(pokemon, query) {
    if(!query)return true;
    const raw=query.trim(),number=raw.replace(/^#/,'');
    const haystack=[pokemonName(pokemon),pokemon.name,pokemon.en,pokemon.baseName,pokemon.baseEn,pokemon.formId,pokemon.formSlug,...(pokemon.searchAliases||[])].map(searchKey).join(' ');
    return haystack.includes(searchKey(raw))||(number&&String(pokemon.dex).startsWith(number));
  }

  function populateBosses(query='', preferredKey='') {
    const select=byId('bossSpecies');
    if(!select||!state?.pokemon?.length)return false;
    const matches=bossForms.filter(pokemon=>bossMatches(pokemon,query));
    select.innerHTML=matches.length?matches.map(pokemon=>`<option value="${safe(pokemon.speciesKey)}">${safe(bossOptionLabel(pokemon))}</option>`).join(''):'<option value="">검색 결과가 없습니다.</option>';
    const target=matches.some(pokemon=>pokemon.speciesKey===preferredKey)?preferredKey:matches[0]?.speciesKey||'';
    select.value=target;
    updateBossMoves();
    return true;
  }

  function selectedBoss() {
    return bossFormsByKey.get(byId('bossSpecies')?.value) || null;
  }

  function moveOptions(moves, emptyLabel) {
    return `<option value="">${safe(emptyLabel)}</option>${moves.map(move=>`<option value="${safe(move.id)}">${safe(moveLabel(move))} · ${safe(move.typeKo||typeLabel(move.type))}</option>`).join('')}`;
  }

  function updateBossMoves() {
    const boss=selectedBoss(),fast=byId('bossFastMove'),charged=byId('bossChargedMove');
    if(!fast||!charged)return;
    fast.innerHTML=moveOptions(validFastMoves(boss),'모름·예상 TDO 미산출');
    charged.innerHTML=moveOptions(validChargedMoves(boss),'모름·예상 TDO 미산출');
    if(boss&&!tierManuallySelected){
      const suggested=boss.raidTransformation?(boss.raidTransformation==='primal'||['legendary','mythic'].includes(boss.class)?'megaLegendary':'mega'):'tier5';
      if(byId('bossTier').value!==suggested){byId('bossTier').value=suggested;setTierPreset();}
    }
    const summary=byId('bossSummary');
    if(summary&&boss)summary.innerHTML=`<strong>${safe(pokemonName(boss))}</strong><span>조건을 확인한 뒤 “이 조건으로 분석”을 누르세요.</span>`;
    scheduleAnalysis();
  }

  function tierKey() {
    return TIER_MAP[byId('bossTier')?.value] || 'five';
  }

  function setTierPreset() {
    if(!BossEngine||byId('bossTier').value==='custom')return;
    const preset=BossEngine.getBossTierPreset(tierKey());
    if(!preset)return;
    settingPreset=true;
    byId('bossHp').value=preset.hp;
    byId('bossTimer').value=preset.timeLimitSeconds;
    byId('bossCpm').value=preset.cpm;
    settingPreset=false;
  }

  function syntheticMega(base, mega) {
    const variant=mega.id.endsWith('_mega_x')?'X':mega.id.endsWith('_mega_y')?'Y':'';
    const primal=mega.id.endsWith('_primal');
    const englishName=primal?`Primal ${base.en}`:`Mega ${base.en}${variant?` ${variant}`:''}`;
    const trailingAlias=primal?`${base.en} Primal`:`${base.en} Mega${variant?` ${variant}`:''}`;
    return {
      ...base,
      speciesKey:`${base.speciesKey}|mega:${mega.id}`,
      formId:mega.id,
      formSlug:mega.id,
      name:mega.name,
      en:englishName,
      searchAliases:[englishName,trailingAlias],
      baseName:base.baseName,
      baseEn:base.baseEn,
      stats:{...mega.stats},
      types:mega.types.map(type=>({...type})),
      image:mega.image||base.image,
      mega:[],
      shadowEligible:false,
      raidTransformation:mega.id.includes('primal')?'primal':'mega'
    };
  }

  function catalogCandidates() {
    const level=numeric(byId('bossAttackerLevel').value)||40,attackIv=Math.max(0,Math.min(15,Math.round(numeric(byId('bossAttackerAttackIv').value)))),includeShadows=byId('bossIncludeShadows').checked,includeMega=byId('bossIncludeMega').checked,candidates=[],megaSeen=new Set();
    for(const pokemon of state.pokemon){
      if(EXCLUDED_ATTACKERS.has(pokemon.speciesKey)||!validFastMoves(pokemon).length||!validChargedMoves(pokemon).length)continue;
      const common={base:pokemon,ivs:{attack:attackIv,defense:15,stamina:15},level,owned:false,fastMoves:validFastMoves(pokemon),chargedMoves:validChargedMoves(pokemon),moveAssumption:'가능한 기술 중 최적 조합 가정'};
      candidates.push({...common,key:pokemon.speciesKey,pokemon,status:'normal',name:pokemonName(pokemon),image:pokemon.image||'',kindLabel:`도감 Lv.${level} · ${attackIv}/15/15`});
      if(includeShadows&&pokemon.shadowEligible)candidates.push({...common,key:`${pokemon.speciesKey}|shadow`,pokemon,status:'shadow',name:`그림자 ${pokemonName(pokemon)}`,image:pokemon.image||'',kindLabel:`그림자 · 도감 Lv.${level} · ${attackIv}/15/15`});
      if(includeMega)for(const mega of pokemon.mega||[]){
        if(megaSeen.has(mega.id))continue;megaSeen.add(mega.id);
        const megaPokemon=syntheticMega(pokemon,mega);
        candidates.push({...common,key:`${pokemon.speciesKey}|mega:${mega.id}`,pokemon:megaPokemon,status:'normal',name:mega.name,image:mega.image||pokemon.image||'',fastMoves:validFastMoves(megaPokemon),chargedMoves:validChargedMoves(megaPokemon),kindLabel:`메가진화 · 도감 Lv.${level} · ${attackIv}/15/15`,isMega:true});
      }
    }
    return candidates;
  }

  function storedMoveChoices(record, pokemon) {
    const fastAll=validFastMoves(pokemon),chargedAll=validChargedMoves(pokemon);
    const storedFast=fastAll.find(move=>move.id===record.moves?.fast);
    const storedChargedIds=record.moves?.charged||[],storedCharged=storedChargedIds.map(id=>{
      const regular=chargedAll.find(move=>move.id===id);if(regular)return regular;
      const special=STATUS_CHARGED_MOVES[id];
      if(!special||special.status!==record.status||special.dex&&special.dex!==pokemon.dex||special.apex&&record.apex!==true)return null;
      return special;
    }).filter(Boolean),hasFast=Boolean(record.moves?.fast),hasCharged=storedChargedIds.length>0,unresolved=(hasFast&&!storedFast)||(hasCharged&&storedCharged.length!==storedChargedIds.length);
    if(unresolved)return {fastMoves:[],chargedMoves:[],moveAssumption:'저장 기술을 현재 데이터로 계산할 수 없어 제외',unresolved:true};
    const fastMoves=hasFast?[storedFast]:fastAll,chargedMoves=hasCharged?storedCharged:chargedAll;
    const moveAssumption=hasFast&&hasCharged?'저장된 보유 기술':hasFast?'저장 노말 기술 · 차지 기술은 최적 조합 가정':hasCharged?'노말 기술은 최적 조합 가정 · 저장 차지 기술':'기술 미입력 · 가능한 최적 조합 가정';
    return {fastMoves,chargedMoves,moveAssumption,unresolved:false};
  }

  function collectionCandidates() {
    const includeShadows=byId('bossIncludeShadows').checked,includeMega=byId('bossIncludeMega').checked,candidates=[];
    let unsupportedMoveRecords=0;
    for(const record of state.collection.records||[]){
      const pokemon=typeof recordPokemon==='function'?recordPokemon(record):state.byKey.get(record.speciesKey);
      if(!pokemon||EXCLUDED_ATTACKERS.has(pokemon.speciesKey)||record.status==='shadow'&&!includeShadows)continue;
      const snapshot=typeof effectiveSnapshot==='function'?effectiveSnapshot(record):{ivs:record.ivs,level:record.level,status:record.status};
      const choices=storedMoveChoices(record,pokemon);
      if(choices.unresolved){unsupportedMoveRecords+=1;continue;}
      if(!choices.fastMoves.length||!choices.chargedMoves.length)continue;
      const shownName=record.nickname||pokemonName(pokemon),training=record.hyperTraining?.phase==='completed'?' · 특훈 완료':'';
      const common={base:pokemon,ivs:snapshot.ivs,level:snapshot.level,owned:true,recordId:record.id,fastMoves:choices.fastMoves,chargedMoves:choices.chargedMoves,moveAssumption:choices.moveAssumption};
      candidates.push({...common,key:`record:${record.id}`,pokemon,status:snapshot.status,name:shownName,image:pokemon.image||'',kindLabel:`${typeof statusLabel==='function'?statusLabel(snapshot.status):snapshot.status} · ${pokemonName(pokemon)} · Lv.${snapshot.level} · ${snapshot.ivs.attack}/${snapshot.ivs.defense}/${snapshot.ivs.stamina}${training}`});
      if(includeMega&&snapshot.status!=='shadow')for(const mega of pokemon.mega||[]){
        const megaPokemon=syntheticMega(pokemon,mega);
        candidates.push({...common,key:`record:${record.id}|mega:${mega.id}`,pokemon:megaPokemon,status:'normal',name:record.nickname?`${record.nickname} · ${mega.name}`:mega.name,image:mega.image||pokemon.image||'',fastMoves:choices.fastMoves,chargedMoves:choices.chargedMoves,kindLabel:`보유 개체 메가진화 · Lv.${snapshot.level} · ${snapshot.ivs.attack}/${snapshot.ivs.defense}/${snapshot.ivs.stamina}${training}`,isMega:true});
      }
    }
    return {candidates,unsupportedMoveRecords};
  }

  function readConfig() {
    const allyMegaType=byId('bossAllyMegaBoost').value,preset=BossEngine.getBossTierPreset(tierKey());
    return {
      tier:tierKey(),
      weather:byId('bossWeather').value,
      allyMegaBoost:allyMegaType==='none'?'none':{mode:'typed',boostedTypes:[allyMegaType]},
      partySize:1,
      bossFastMove:byId('bossFastMove').value||undefined,
      bossChargedMove:byId('bossChargedMove').value||undefined,
      tierOverrides:{hp:boundedInput('bossHp',preset.hp,true),timeLimitSeconds:boundedInput('bossTimer',preset.timeLimitSeconds,true),cpm:boundedInput('bossCpm',preset.cpm)}
    };
  }

  function analyzeCandidate(candidate, boss, config) {
    let best=null;
    for(const fastMove of candidate.fastMoves)for(const chargedMove of candidate.chargedMoves){
      const result=BossEngine.analyzeBossBattle({pokemon:candidate.pokemon,ivs:candidate.ivs,level:candidate.level,status:candidate.status,fastMove,chargedMove,boss,...config});
      if(!result?.valid||!Number.isFinite(result.metrics?.dpsProxy)||result.metrics.dpsProxy<=0)continue;
      if(!best||result.metrics.dpsProxy>best.result.metrics.dpsProxy||(result.metrics.dpsProxy===best.result.metrics.dpsProxy&&(result.metrics.tdoEstimate??result.metrics.tdoProxy??0)>(best.result.metrics.tdoEstimate??best.result.metrics.tdoProxy??0)))best={candidate,fastMove,chargedMove,result};
    }
    if(best)best.breakpoint=BossEngine.findAttackIvBreakpoints({pokemon:candidate.pokemon,ivs:candidate.ivs,currentAttackIv:candidate.ivs.attack,level:candidate.level,status:candidate.status,fastMove:best.fastMove,boss,...config});
    return best;
  }

  function weaknessData(boss) {
    return TYPE_ORDER.map(type=>({type,multiplier:BossEngine.typeEffectiveness(type,boss.types)})).filter(item=>item.multiplier>1.00001).sort((a,b)=>b.multiplier-a.multiplier||TYPE_ORDER.indexOf(a.type)-TYPE_ORDER.indexOf(b.type));
  }

  function formatSeconds(value) {
    if(!Number.isFinite(value))return '–';
    const rounded=Math.round(value);
    if(rounded>=60)return `${Math.floor(rounded/60)}분 ${rounded%60}초`;
    return `${value.toFixed(value<10?1:0)}초`;
  }

  function resultEffectiveness(best, boss) {
    const values=[best.fastMove,best.chargedMove].map(move=>BossEngine.typeEffectiveness(move.type,boss.types));
    return Math.max(...values);
  }

  function renderSummary(boss, config, count) {
    const weaknesses=weaknessData(boss),tierLabel=byId('bossTier').selectedOptions[0]?.textContent||config.tier,types=(boss.types||[]).map(type=>type.ko||typeLabel(type.id||type)).join(' · '),moveText=[byId('bossFastMove').selectedOptions[0]?.textContent,byId('bossChargedMove').selectedOptions[0]?.textContent].filter(Boolean).join(' / '),allyMegaType=byId('bossAllyMegaBoost').value,allyMegaText=allyMegaType==='none'?'없음':`${typeLabel(allyMegaType)} 타입 · 일치 ×1.3 / 그 외 ×1.1`;
    byId('bossSummary').innerHTML=`<strong>${safe(pokemonName(boss))} 공략 요약</strong><span>${safe(types)} 타입 · ${safe(tierLabel)} · ${safe(WEATHER_LABELS[config.weather]||config.weather)} · 후보 ${count.toLocaleString()}개</span><div class="boss-summary-grid"><div><span>보스 HP</span><strong>${config.tierOverrides.hp.toLocaleString()} HP</strong></div><div><span>제한 시간</span><strong>${config.tierOverrides.timeLimitSeconds}초</strong></div><div><span>CPM</span><strong>${config.tierOverrides.cpm}</strong></div><div><span>보스 기술</span><strong>${safe(moveText)}</strong></div><div><span>공격수 기준</span><strong>${byId('bossUseCollection').checked?'내 보유함':`전체 도감 ${byId('bossAttackerAttackIv').value}/15/15`}</strong></div><div><span>동료 Mega</span><strong>${safe(allyMegaText)}</strong></div></div><div class="boss-weaknesses">${weaknesses.length?weaknesses.map(item=>`<span class="boss-weakness ${item.multiplier>1.6?'double':''}" data-type="${safe(item.type)}">${safe(typeLabel(item.type))} ×${item.multiplier.toFixed(2).replace(/0$/,'')}</span>`).join(''):'<span class="boss-weakness">표시할 약점 없음</span>'}</div><p>에너지 상한 100과 이월을 반영한 장기 사이클 평균이며 피격 에너지는 제외합니다. 보스 기술은 둘 다 골라야 예상 TDO에 반영됩니다.</p>`;
  }

  function renderResultCard(best, index, boss) {
    const {candidate,fastMove,chargedMove,result,breakpoint}=best,metrics=result.metrics,dps=metrics.dpsProxy,ttw=metrics.estimatedPartyTimeSeconds??numeric(byId('bossHp').value)/dps,required=metrics.estimatedRequiredPlayers??Math.ceil(ttw/numeric(byId('bossTimer').value)),effectiveness=resultEffectiveness(best,boss),tdo=metrics.tdoEstimate??metrics.tdoProxy,tdoLabel=metrics.tdoEstimate!=null?'예상 TDO':'TDO 지수',fastEffect=BossEngine.typeEffectiveness(fastMove.type,boss.types),chargedEffect=BossEngine.typeEffectiveness(chargedMove.type,boss.types),bossFastKnown=Boolean(byId('bossFastMove').value),bossChargedKnown=Boolean(byId('bossChargedMove').value),incomingLabel=bossFastKnown&&bossChargedKnown?'보스 기술 반영':bossFastKnown||bossChargedKnown?'보스 기술 일부만 지정 · 예상 TDO 미산출':'보스 기술 미지정 · 예상 TDO 미산출',breakpointText=breakpoint?.nextBreakpoint?`다음 노말 BP 공격 IV ${breakpoint.nextBreakpoint.attackIv} · ${breakpoint.nextBreakpoint.damage} 피해`:`노말 ${breakpoint?.currentDamage??result.outgoing.fast?.damage??'–'} 피해 · 이후 IV BP 없음`;
    return `<article class="boss-result-card" data-attacker-key="${safe(candidate.key)}" data-dps="${dps.toFixed(6)}" data-ttw="${Number(ttw).toFixed(6)}" data-effectiveness="${Number(effectiveness.toFixed(6))}" data-required-players="${required}" data-breakpoint="${breakpoint?.nextBreakpoint?.attackIv??''}"><span class="boss-rank">#${index+1}</span><div class="boss-result-copy"><h3>${safe(candidate.name)}<span>${safe(candidate.kindLabel)}</span></h3><p class="boss-move-combo">${resultMoveHtml(fastMove)} + ${resultMoveHtml(chargedMove)} · ${safe(candidate.moveAssumption)}</p>${moveAccessNotice([fastMove,chargedMove])}<div class="boss-result-badges"><span class="${fastEffect>1.6?'super':''}">${safe(typeLabel(fastMove.type))} ×${fastEffect.toFixed(2).replace(/0$/,'')}</span><span class="${chargedEffect>1.6?'super':''}">${safe(typeLabel(chargedMove.type))} ×${chargedEffect.toFixed(2).replace(/0$/,'')}</span><span>${safe(breakpointText)}</span>${candidate.isMega?'<span>MEGA 폼</span>':''}${candidate.status==='shadow'?'<span>SHADOW ×1.2</span>':''}<span>${safe(incomingLabel)}</span></div></div><div class="boss-result-metrics"><div><span>DPS 사이클 추정</span><strong>${dps.toFixed(2)}</strong></div><div><span>${tdoLabel}</span><strong>${Number.isFinite(tdo)?Number(tdo).toFixed(1):'–'}</strong></div><div><span>예상 처치시간(이론)</span><strong>${formatSeconds(ttw)}</strong></div><div><span>최소 인원(이론)</span><strong>${required}명</strong></div></div></article>`;
  }

  async function runAnalysis() {
    const runId=++analysisRunId;
    clearTimeout(rerunTimer);rerunTimer=0;
    const output=byId('bossResults'),summary=byId('bossSummary'),button=byId('runBossAnalysis'),container=document.querySelector('.boss-output'),boss=selectedBoss();
    const finish=()=>{if(runId===analysisRunId){button.disabled=false;container.setAttribute('aria-busy','false');}};
    if(!BossEngine){summary.innerHTML='<div class="boss-error">보스 계산 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</div>';output.innerHTML='';finish();return;}
    if(!boss){summary.innerHTML='<div class="boss-error">분석할 보스와 폼을 선택해 주세요.</div>';output.innerHTML='<div class="boss-empty">보스 이름을 다시 검색하거나 분석할 폼을 선택해 주세요.</div>';finish();return;}
    hasRun=true;
    button.disabled=true;container.setAttribute('aria-busy','true');output.innerHTML='<div class="boss-empty">공격수와 기술 조합을 계산하고 있습니다…</div>';
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    if(runId!==analysisRunId)return;
    try {
      const useCollection=byId('bossUseCollection').checked,config=readConfig();
      if(useCollection){
        if(window.ValueDexAppReady)await window.ValueDexAppReady;
        if(runId!==analysisRunId)return;
        if(!state.collection.repo){renderSummary(boss,config,0);output.innerHTML=`<div class="boss-error">${safe(state.collection.error||'보유함 저장소를 사용할 수 없습니다. 브라우저 저장 공간 설정을 확인해 주세요.')}</div>`;return;}
        if(typeof refreshCollection==='function')await refreshCollection();
        if(runId!==analysisRunId)return;
      }
      const collectionResult=useCollection?collectionCandidates():null,candidates=collectionResult?.candidates||catalogCandidates(),unsupportedMoveRecords=collectionResult?.unsupportedMoveRecords||0;
      renderSummary(boss,config,candidates.length);
      const unsupportedNotice=unsupportedMoveRecords?`<div class="boss-warning">저장 기술을 현재 데이터로 계산할 수 없는 보유 개체 ${unsupportedMoveRecords}마리를 제외했습니다. 다른 최적 기술로 임의 대체하지 않았습니다.</div>`:'';
      if(!candidates.length){const emptyText=useCollection?(state.collection.records.length?'현재 필터와 저장 기술로 계산 가능한 보유 포켓몬이 없습니다.':'보유함에 저장된 포켓몬이 없습니다.'):'계산 가능한 공격수 후보가 없습니다.';output.innerHTML=`${unsupportedNotice}<div class="boss-empty">${emptyText}<br>필터 또는 보유 기술을 확인해 주세요.</div>`;return;}
      const results=[];
      for(const candidate of candidates){const best=analyzeCandidate(candidate,boss,config);if(best)results.push(best);}
      results.sort((left,right)=>right.result.metrics.dpsProxy-left.result.metrics.dpsProxy||(right.result.metrics.tdoEstimate??right.result.metrics.tdoProxy??0)-(left.result.metrics.tdoEstimate??left.result.metrics.tdoProxy??0)||left.candidate.name.localeCompare(right.candidate.name,'ko'));
      output.innerHTML=unsupportedNotice+(results.length?results.slice(0,RESULT_LIMIT).map((best,index)=>renderResultCard(best,index,boss)).join(''):'<div class="boss-empty">이 조건에서 계산 가능한 기술 조합이 없습니다.</div>');
    } catch(error) {
      if(runId===analysisRunId){console.error(error);output.innerHTML=`<div class="boss-error">분석 중 오류가 발생했습니다. ${safe(error.message||error)}</div>`;}
    } finally {
      finish();
    }
  }

  function scheduleAnalysis() {
    if(!hasRun||!ready)return;
    clearTimeout(rerunTimer);
    rerunTimer=setTimeout(()=>runAnalysis(),140);
  }

  function prepare() {
    if(ready)return true;
    if(!state?.pokemon?.length)return false;
    bossForms=state.pokemon.flatMap(pokemon=>[pokemon,...(pokemon.mega||[]).map(mega=>syntheticMega(pokemon,mega))]);
    bossFormsByKey=new Map(bossForms.map(pokemon=>[pokemon.speciesKey,pokemon]));
    const preferred=state.selected?.speciesKey||bossFormsByKey.has('150:normal')&&'150:normal'||bossForms[0].speciesKey;
    populateBosses('',preferred);
    setTierPreset();
    ready=true;
    return true;
  }

  function waitForData(attempt=0) {
    if(prepare())return;
    if(attempt<100)setTimeout(()=>waitForData(attempt+1),50);
    else byId('bossSummary').innerHTML='<div class="boss-error">도감 데이터가 준비되지 않았습니다. 페이지를 새로고침해 주세요.</div>';
  }

  function bind() {
    byId('openBossAnalysis')?.addEventListener('click',()=>{const dialog=byId('bossDialog');if(!dialog.open)dialog.showModal();waitForData();});
    byId('bossSearch')?.addEventListener('input',event=>populateBosses(event.target.value,byId('bossSpecies').value));
    byId('bossSpecies')?.addEventListener('change',updateBossMoves);
    byId('bossTier')?.addEventListener('change',()=>{tierManuallySelected=true;setTierPreset();scheduleAnalysis();});
    for(const id of ['bossHp','bossTimer','bossCpm'])byId(id)?.addEventListener('input',()=>{if(!settingPreset){tierManuallySelected=true;byId('bossTier').value='custom';}scheduleAnalysis();});
    byId('bossAttackerLevel')?.addEventListener('input',event=>{byId('bossAttackerLevelOutput').value=event.target.value;scheduleAnalysis();});
    byId('bossAttackerAttackIv')?.addEventListener('input',event=>{byId('bossAttackerAttackIvOutput').value=event.target.value;scheduleAnalysis();});
    for(const id of ['bossWeather','bossFastMove','bossChargedMove','bossUseCollection','bossIncludeShadows','bossIncludeMega','bossAllyMegaBoost'])byId(id)?.addEventListener('change',scheduleAnalysis);
    byId('runBossAnalysis')?.addEventListener('click',runAnalysis);
  }

  bind();
  window.ValueDexBossAnalysis=Object.freeze({prepare,populateBosses,runAnalysis});
})();
