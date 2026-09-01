# GO ValueDex

Pokémon GO 포켓몬을 검색하고, 보유 개체의 IV 가치를 용도별로 판단하는 모바일 우선 정적 웹 앱입니다. 서버나 로그인이 필요하지 않으며 GitHub Pages에 바로 배포할 수 있습니다.

## 제공 기능

- 한국어·영문명·도감 번호 검색과 타입/세대/메가/다이맥스 필터
- 공격·방어·체력 `0–15` 슬라이더 및 현재 강화 레벨 입력
- 슈퍼·하이퍼·마스터리그의 4,096개 IV 조합 전수 순위
- PvP 개체 적합도와 해당 종의 메타 활용도를 분리한 설명
- 레이드 PvE 공격 우선 평가 및 중립 사이클 기술 추천
- 현재 형태와 모든 최종 진화체에 동일 IV를 적용한 가치 비교
- 클릭 가능한 진화 계보
- PvP 리그별 추천 기술과 엘리트 기술 표시
- 메가진화 종족값·타입·레이드 영향 설명
- 다이맥스/거다이맥스 지원 여부, 개체 자격 확인, 역할별 IV 우선순위와 맥스 기술 설명

## 로컬 실행

빌드 과정은 없습니다. `fetch()`로 정적 JSON을 읽으므로 파일을 직접 더블클릭하지 말고 웹 서버를 실행합니다.

```bash
python3 -m http.server 8000
```

이후 `http://localhost:8000`을 엽니다.

## GitHub Pages 배포

1. 이 디렉터리를 GitHub 저장소의 `main` 브랜치에 올립니다.
2. **Settings → Pages → Build and deployment**에서 `Deploy from a branch`를 선택합니다.
3. `main`과 `/ (root)`를 선택해 저장합니다.

앱은 완전한 정적 파일이므로 별도 환경변수나 API 키가 필요하지 않습니다.

## 데이터 갱신

현재 스냅샷을 다시 생성하려면 실행합니다.

```bash
python3 scripts/update_data.py
```

매주 데이터 스냅샷을 확인하는 GitHub Actions 워크플로도 포함되어 있습니다. 외부 소스 구조가 바뀌면 안전 검증에 실패하고 기존 데이터는 그대로 유지됩니다.

데이터 출처:

- [Pokémon GO API](https://github.com/pokemon-go-api/pokemon-go-api): 한국어 이름, GO 종족값, 진화, 기술, 메가 형태
- [PvPoke](https://github.com/pvpoke/pvpoke): 현재 PvP 리그 랭킹과 추천 기술
- [Serebii Max Battles](https://www.serebii.net/pokemongo/maxbattles.shtml): Pokémon GO에서 확인된 다이맥스·거다이맥스 가능 종
- [PokéAPI sprites](https://github.com/PokeAPI/sprites): GO 전용 이미지가 없는 포켓몬의 대체 이미지

## 판정 범위

- PvP IV 순위는 CP 제한 이하 최고 레벨에서 `실공격 × 실방어 × 정수 HP`를 비교합니다.
- 포켓몬 레벨은 1–50, 0.5 단위이며 베스트 파트너의 일시적 51레벨은 포함하지 않습니다.
- PvP IV 1위가 모든 대면전에서 최선이라는 의미는 아닙니다. CMP, breakpoint, bulkpoint와 팀 조합에 따라 결과가 바뀔 수 있습니다.
- PvE 추천은 자속 보정을 포함한 중립 사이클 이론값입니다. 날씨, 보스 상성/방어, 피격 에너지와 실제 breakpoint는 반영하지 않습니다.
- 다이맥스 자격은 종이 아니라 개별 포켓몬에 붙습니다. 지원 종의 일반 개체는 맥스배틀에 사용할 수 없습니다.
- 진화하면 IV와 레벨은 유지되지만 CP와 종족값 기반 순위는 달라집니다.

## 주의

비상업 개인용 팬 프로젝트이며 Niantic, Scopely, Nintendo, GAME FREAK 또는 The Pokémon Company와 관련이 없습니다. Pokémon 이름·이미지·게임 데이터와 각 상표는 해당 권리자에게 있습니다. 제3자 데이터의 코드 라이선스는 Pokémon 지식재산권에 대한 사용 허가를 의미하지 않습니다.
