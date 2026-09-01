# GO ValueDex

Pokémon GO 포켓몬을 검색하고, 보유 개체의 IV와 실제 전투 활용도를 용도별로 판단하는 모바일 우선 정적 웹 앱입니다. 서버나 로그인이 필요하지 않으며 GitHub Pages에 바로 배포할 수 있습니다.

현재 버전: **1.3** · [릴리즈](https://github.com/jimyeong-han/go-valuedex/releases/tag/v1.3) · [변경 기록](CHANGELOG.md)

## 제공 기능

- 1,188개 평가 폼의 한국어·영문명·도감 번호 검색과 타입/세대/메가/다이맥스 필터
- 일반·지역·전투 폼을 독립적으로 선택하고 공유할 수 있는 폼별 URL
- 공격·방어·체력 `0–15` 슬라이더 및 현재 강화 레벨 입력
- PvP·중립 레이드 화력·Mega·Max 근거를 분리한 `핵심 실전용 / 조건부 실전용 / 수집·관상 중심` 분류
- 슈퍼·하이퍼·마스터리그의 4,096개 IV 조합 전수 순위
- PvP 개체 적합도와 해당 종의 메타 활용도를 분리한 설명
- 레이드 PvE 공격 우선 평가 및 중립 사이클 기술 추천
- 현재 형태와 모든 최종 진화체에 동일 IV를 적용한 가치 비교
- 클릭 가능한 진화 계보
- PvP 리그별 추천 기술과 엘리트 기술 표시
- 메가진화 종족값·타입·레이드 영향 설명
- 다이맥스/거다이맥스 지원 여부, 개체 자격 확인, 역할별 IV 우선순위와 맥스 기술 설명
- 일반·그림자·정화 상태 선택과 공격·방어·CP·기술·두 번째 기술 비용 차이 표시
- 정화 전후 IV·레벨·CP·리그 가치 미리보기와 APEX 루기아·칠색조 예외 처리
- 금색·은색병뚜껑 목표 IV, 과제 수, 특훈 전후 가치와 CP 제한 초과 경고
- 버전형 JSON Schema, 출처 URL·수집 시각·SHA-256과 대량 변경 방지 검사
- 데스크톱·390px 모바일 Playwright CI와 검증 성공 후에만 실행되는 GitHub Pages 배포

## 로컬 실행

빌드 과정은 없습니다. `fetch()`로 정적 JSON을 읽으므로 파일을 직접 더블클릭하지 말고 웹 서버를 실행합니다.

```bash
python3 -m http.server 8000
```

이후 `http://localhost:8000`을 엽니다.

## 로드맵

다음 구현 후보와 우선순위, 완료 조건은 [TODO.md](TODO.md)에서 관리합니다.

## GitHub Pages 배포

1. 이 디렉터리를 GitHub 저장소의 `main` 브랜치에 올립니다.
2. **Settings → Pages → Build and deployment → Source**에서 `GitHub Actions`를 선택합니다.
3. `main`에 푸시하면 품질검사를 모두 통과한 정적 파일만 Pages에 배포됩니다.

앱은 완전한 정적 파일이므로 별도 환경변수나 API 키가 필요하지 않습니다.

## 데이터 갱신

현재 스냅샷을 다시 생성하려면 실행합니다.

```bash
python3 scripts/update_data.py
```

매주 데이터 스냅샷을 확인하는 GitHub Actions 워크플로도 포함되어 있습니다. 외부 소스 구조가 바뀌거나 데이터가 비정상적으로 대량 삭제되면 검증에 실패합니다. 정상 변경도 `main`에 직접 쓰지 않고 검토용 PR만 만들며 자동 병합하지 않습니다.

로컬에서 전체 품질검사를 실행하려면 다음을 사용합니다.

```bash
python3 -m pip install -r requirements-dev.txt
npm ci
python3 scripts/validate_schema.py
python3 scripts/validate_data.py
python3 -m unittest discover -s tests -p 'test_*.py'
npm run test:mechanics
npx playwright install chromium
npm run test:browser
```

브라우저 테스트는 앱을 `/go-valuedex/` 하위 경로에 올려 GitHub Pages 프로젝트 사이트와 같은 조건으로 검사합니다.

데이터 출처:

- [Pokémon GO API](https://github.com/pokemon-go-api/pokemon-go-api): 한국어 이름, GO 종족값, 진화, 기술, 메가 형태
- [PvPoke](https://github.com/pvpoke/pvpoke): 현재 PvP 리그 랭킹과 추천 기술
- [PokeMiners Game Masters](https://github.com/PokeMiners/game_masters): 폼별 정화 비용과 그림자·정화 기술
- [Serebii Max Battles](https://www.serebii.net/pokemongo/maxbattles.shtml): Pokémon GO에서 확인된 다이맥스·거다이맥스 가능 종
- [PokéAPI sprites](https://github.com/PokeAPI/sprites): GO 전용 이미지가 없는 포켓몬의 대체 이미지

각 스냅샷은 `schemaVersion`, 생성 시각과 원본별 URL·수집 시각·SHA-256을 포함합니다. 따라서 `master`나 `latest` 주소의 내용이 나중에 바뀌어도 당시 입력 원문을 식별할 수 있습니다.

## 판정 범위

- PvP IV 순위는 CP 제한 이하 최고 레벨에서 `실공격 × 실방어 × 정수 HP`를 비교합니다.
- 포켓몬 레벨은 1–50, 0.5 단위이며 베스트 파트너의 일시적 51레벨은 포함하지 않습니다.
- PvP IV 1위가 모든 대면전에서 최선이라는 의미는 아닙니다. CMP, breakpoint, bulkpoint와 팀 조합에 따라 결과가 바뀔 수 있습니다.
- PvE 추천은 자속 보정을 포함한 중립 사이클 이론값입니다. 날씨, 보스 상성/방어, 피격 에너지와 실제 breakpoint는 반영하지 않습니다.
- 다이맥스 자격은 종이 아니라 개별 포켓몬에 붙습니다. 지원 종의 일반 개체는 맥스배틀에 사용할 수 없습니다.
- 진화하면 IV와 레벨은 유지되지만 CP와 종족값 기반 순위는 달라집니다.
- 폼별 PvP 정보는 도감 번호만으로 추정하지 않고 종족값·타입·기술이 정확히 일치할 때만 연결합니다.
- 실전 분류는 현재 공개 데이터의 보수적 기준입니다. `수집·관상 중심`은 사용할 수 없다는 뜻이 아니며 시즌·기술·팀 구성에 따라 달라집니다.
- 그림자 PvP 추천 기술 카드는 일반 폼 참고값이며, 화풀이 제거 가능 시기와 그림자 전용 메타는 게임 안에서 다시 확인해야 합니다.
- 정화와 완료된 대단한 특훈의 IV 상승은 되돌릴 수 없습니다. 특훈에는 굿 파트너 이상이 필요하고 그림자·4★ 개체는 대상이 아니며, 특훈 개체는 Pokémon HOME으로 보낼 수 없습니다.

## 주의

비상업 개인용 팬 프로젝트이며 Niantic, Scopely, Nintendo, GAME FREAK 또는 The Pokémon Company와 관련이 없습니다. Pokémon 이름·이미지·게임 데이터와 각 상표는 해당 권리자에게 있습니다. 제3자 데이터의 코드 라이선스는 Pokémon 지식재산권에 대한 사용 허가를 의미하지 않습니다.
