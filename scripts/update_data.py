#!/usr/bin/env python3
"""Build the compact, static data files consumed by GO ValueDex."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
POKEDEX_URL = "https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json"
PVP_GM_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json"
PVP_RANK_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-{cap}.json"
MAX_URL = "https://www.serebii.net/pokemongo/maxbattles.shtml"
POKEMINERS_GM_URL = "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json"
SCHEMA_VERSION = 1

SOURCE_IDS = {
    "pokemon_go_api": "pokemonGoApi",
    "pvpoke_game_master": "pvpokeGameMaster",
    "pvpoke_great": "pvpokeGreatLeague",
    "pvpoke_ultra": "pvpokeUltraLeague",
    "pvpoke_master": "pvpokeMasterLeague",
    "serebii_max": "serebiiMaxBattles",
    "pokeminers_game_master": "pokeMinersGameMaster",
}
RETRIEVED_AT: dict[str, str] = {}
SOURCE_SHA256: dict[str, str] = {}

# A few equivalent moves use different identifiers in the two upstream data
# sets. Canonicalise only the known one-to-one aliases so every stored
# recommendation can still be resolved against pokemon.json.
PVP_MOVE_ID_ALIASES = {
    "AEGISLASH_CHARGE_PSYCHO_CUT": "PSYCHO_CUT",
    "FUTURE_SIGHT": "FUTURESIGHT",
    "PYRO_BALL": "PYROBALL",
}

# Some high-value attacks are intentionally absent from a Pokemon's normal and
# Elite TM pools in GAME_MASTER. They are injected by an encounter, item,
# Fusion, or form-change workflow instead. pokemon-go-api consequently cannot
# attach them to a form even though the move battle settings exist. Keep this
# small, reviewed overlay form-specific and derive every battle number from the
# same PokeMiners snapshot used elsewhere in this builder.
SPECIAL_MOVE_OVERLAYS = {
    "384:normal": ({
        "id": "DRAGON_ASCENT",
        "ko": "화룡점정",
        "en": "Dragon Ascent",
        "accessKind": "special_item",
        "accessLabel": "운석 사용",
        "source": "https://pokemongo.com/news/mega-rayquaza-raid-day-2025?hl=en",
    },),
    "483:origin": ({
        "id": "ROAR_OF_TIME",
        "ko": "시간의포효",
        "en": "Roar of Time",
        "accessKind": "event_encounter",
        "accessLabel": "이벤트 레이드에서 기술 보유 개체 포획",
        "source": "https://pokemongo.com/news/origin-forme-adventure-effects-dialga-palkia",
    },),
    "484:origin": ({
        "id": "SPACIAL_REND",
        "ko": "공간절단",
        "en": "Spacial Rend",
        "accessKind": "event_encounter",
        "accessLabel": "이벤트 레이드에서 기술 보유 개체 포획",
        "source": "https://pokemongo.com/news/origin-forme-adventure-effects-dialga-palkia",
    },),
    "646:black": ({
        "id": "FREEZE_SHOCK",
        "ko": "프리즈볼트",
        "en": "Freeze Shock",
        "accessKind": "fusion",
        "accessLabel": "얼어붙은세계 보유 큐레무와 제크로무 합체",
        "source": "https://pokemongo.com/post/fusion-adventure-effects-kyurem?hl=en",
    },),
    "646:white": ({
        "id": "ICE_BURN",
        "ko": "콜드플레어",
        "en": "Ice Burn",
        "accessKind": "fusion",
        "accessLabel": "얼어붙은세계 보유 큐레무와 레시라무 합체",
        "source": "https://pokemongo.com/post/fusion-adventure-effects-kyurem?hl=en",
    },),
    "800:dusk_mane": ({
        "id": "SUNSTEEL_STRIKE",
        "ko": "메테오드라이브",
        "en": "Sunsteel Strike",
        "accessKind": "fusion",
        "accessLabel": "네크로즈마와 솔가레오 합체",
        "source": "https://pokemongo.com/post/fusion-adventure-effects-necrozma?hl=en",
    },),
    "800:dawn_wings": ({
        "id": "MOONGEIST_BEAM",
        "ko": "섀도레이",
        "en": "Moongeist Beam",
        "accessKind": "fusion",
        "accessLabel": "네크로즈마와 루나아라 합체",
        "source": "https://pokemongo.com/post/fusion-adventure-effects-necrozma?hl=en",
    },),
    "888:crowned_sword": ({
        "id": "BEHEMOTH_BLADE",
        "ko": "거수참",
        "en": "Behemoth Blade",
        "accessKind": "form_change",
        "accessLabel": "아이언헤드 보유 자시안의 검왕 폼 체인지",
        "source": "https://pokemongo.com/news/crowned-energy-resource-zacian-zamazenta",
    },),
    "889:crowned_shield": ({
        "id": "BEHEMOTH_BASH",
        "ko": "거수탄",
        "en": "Behemoth Bash",
        "accessKind": "form_change",
        "accessLabel": "아이언헤드 보유 자마젠타의 방패왕 폼 체인지",
        "source": "https://pokemongo.com/news/crowned-energy-resource-zacian-zamazenta",
    },),
}

TYPE_NAMES_KO = {
    "normal": "노말", "fire": "불꽃", "water": "물", "electric": "전기",
    "grass": "풀", "ice": "얼음", "fighting": "격투", "poison": "독",
    "ground": "땅", "flying": "비행", "psychic": "에스퍼", "bug": "벌레",
    "rock": "바위", "ghost": "고스트", "dragon": "드래곤", "dark": "악",
    "steel": "강철", "fairy": "페어리",
}

# The top-level record for these species is a generic or hybrid placeholder.
# Their named child form is the actual default users can own or evaluate.
CANONICAL_DEFAULT_FORMS = {
    412: "BURMY_PLANT",
    413: "WORMADAM_PLANT",
    421: "CHERRIM_OVERCAST",
    487: "GIRATINA_ALTERED",
    492: "SHAYMIN_LAND",
    555: "DARMANITAN_STANDARD",
    641: "TORNADUS_INCARNATE",
    642: "THUNDURUS_INCARNATE",
    645: "LANDORUS_INCARNATE",
    647: "KELDEO_ORDINARY",
    648: "MELOETTA_ARIA",
    681: "AEGISLASH_SHIELD",
    710: "PUMPKABOO_SMALL",
    711: "GOURGEIST_SMALL",
    718: "ZYGARDE_FIFTY_PERCENT",
    720: "HOOPA_CONFINED",
    741: "ORICORIO_BAILE",
    745: "LYCANROC_MIDDAY",
    746: "WISHIWASHI_SOLO",
    778: "MIMIKYU_DISGUISED",
    849: "TOXTRICITY_AMPED",
    875: "EISCUE_ICE",
    876: "INDEEDEE_MALE",
    877: "MORPEKO_FULL_BELLY",
    888: "ZACIAN_HERO",
    889: "ZAMAZENTA_HERO",
    892: "URSHIFU_SINGLE_STRIKE",
    905: "ENAMORUS_INCARNATE",
    964: "PALAFIN_ZERO",
}

# These top-level records are placeholders rather than a real display form,
# but their named variants are combat-equivalent and should still collapse.
COLLAPSED_DEFAULT_FORMS = {
    585: "DEERLING_SPRING",
    586: "SAWSBUCK_SPRING",
    854: "SINISTEA_PHONY",
    855: "POLTEAGEIST_PHONY",
    1012: "POLTCHAGEIST_COUNTERFEIT",
    1013: "SINISTCHA_UNREMARKABLE",
}

PRESERVED_FORM_IDS = {
    "SINISTEA_ANTIQUE", "SINISTEA_PHONY",
    "POLTEAGEIST_ANTIQUE", "POLTEAGEIST_PHONY",
    "POLTCHAGEIST_ARTISAN", "POLTCHAGEIST_COUNTERFEIT",
    "SINISTCHA_MASTERPIECE", "SINISTCHA_UNREMARKABLE",
}

BASE_FORM_SLUG_OVERRIDES = {
    774: "meteor",
}

EXCLUDED_FORM_FRAGMENTS = (
    "PIKACHU_ANNIVERSARY_",
    "ZYGARDE_COMPLETE_TEN_PERCENT",
    "ZYGARDE_COMPLETE_FIFTY_PERCENT",
)

PVP_FORM_ID_ALIASES = {
    "oricorio_pompom": "oricorio_pom_pom",
    "zygarde_ten_percent": "zygarde_10",
    "zygarde_fifty_percent": "zygarde",
    "hoopa_confined": "hoopa",
    "mimikyu_disguised": "mimikyu",
    "minior_meteor": "minior_meteor",
    "tatsugiri": "tatsugiri_curly",
}

# The Max source is indexed by Pokédex number. Keep the default form as the
# conservative fallback, then opt in alternate forms explicitly confirmed for
# Pokémon GO Max Battles.
MAX_FORM_SLUGS = {
    849: {"amped", "low_key"},
    892: {"single_strike", "rapid_strike"},
}


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "GO-ValueDex-data-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    value = json.loads(raw)
    RETRIEVED_AT[url] = rfc3339_now()
    SOURCE_SHA256[url] = hashlib.sha256(raw).hexdigest()
    return value


def fetch_text(url: str, encoding: str = "utf-8") -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "GO-ValueDex-data-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    value = raw.decode(encoding, errors="replace")
    RETRIEVED_AT[url] = rfc3339_now()
    SOURCE_SHA256[url] = hashlib.sha256(raw).hexdigest()
    return value


def rfc3339_now() -> str:
    """Return a compact UTC timestamp accepted by RFC 3339 validators."""
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def source(url: str) -> dict[str, str]:
    try:
        retrieved_at = RETRIEVED_AT[url]
        sha256 = SOURCE_SHA256[url]
    except KeyError as exc:
        raise RuntimeError(f"No retrieval provenance recorded for {url}") from exc
    return {"url": url, "retrievedAt": retrieved_at, "sha256": sha256}


def pokemon_sources() -> dict[str, dict[str, str]]:
    return {
        SOURCE_IDS["pokemon_go_api"]: source(POKEDEX_URL),
        SOURCE_IDS["pvpoke_game_master"]: source(PVP_GM_URL),
        SOURCE_IDS["serebii_max"]: source(MAX_URL),
        SOURCE_IDS["pokeminers_game_master"]: source(POKEMINERS_GM_URL),
    }


def pvp_sources() -> dict[str, dict[str, str]]:
    return {
        SOURCE_IDS["pvpoke_game_master"]: source(PVP_GM_URL),
        SOURCE_IDS["pvpoke_great"]: source(PVP_RANK_URL.format(cap=1500)),
        SOURCE_IDS["pvpoke_ultra"]: source(PVP_RANK_URL.format(cap=2500)),
        SOURCE_IDS["pvpoke_master"]: source(PVP_RANK_URL.format(cap=10000)),
    }


def max_capabilities() -> tuple[set[int], set[int]]:
    html = fetch_text(MAX_URL, "latin-1")
    giga_start = html.index("List of Gigantamax Capable")
    dyna_start = html.index("List of Dynamax Capable", giga_start)
    gigantamax = {int(value) for value in re.findall(r"#(\d{4})", html[giga_start:dyna_start])}
    dynamax = {int(value) for value in re.findall(r"#(\d{4})", html[dyna_start:])}
    if len(dynamax) < 20 or len(gigantamax) < 5:
        raise RuntimeError("Max capability list looks incomplete; upstream markup may have changed")
    return dynamax, gigantamax


def compact_type(value):
    if not value:
        return None
    return {
        "id": value["type"].replace("POKEMON_TYPE_", "").lower(),
        "ko": value["names"].get("Korean") or value["names"].get("English"),
    }


def compact_move(move, elite: bool, fast: bool):
    combat = move.get("combat") or {}
    output = {
        "id": move["id"].removesuffix("_FAST"),
        "ko": move["names"].get("Korean") or move["names"].get("English"),
        "en": move["names"].get("English"),
        "type": move["type"]["type"].replace("POKEMON_TYPE_", "").lower(),
        "typeKo": move["type"]["names"].get("Korean") or move["type"]["names"].get("English"),
        "power": move.get("power") or 0,
        "energy": move.get("energy") or 0,
        "duration": move.get("durationMs") or 0,
        "pvpPower": combat.get("power") or 0,
        "pvpEnergy": combat.get("energy") or 0,
        "turns": combat.get("turns") or (1 if not fast else 0),
        "elite": elite,
    }
    if elite:
        output["access"] = {
            "kind": "elite_tm",
            "tmLearnability": "elite_only",
            "label": "이벤트·특별 진화·대단한 기술머신",
        }
    return output


def compact_special_move(move_settings, combat_move, metadata):
    move_id = metadata["id"]
    if move_settings.get("movementId") != move_id or combat_move.get("uniqueId") != move_id:
        raise RuntimeError(f"Special move settings mismatch for {move_id}")
    pve_type = move_settings["pokemonType"].replace("POKEMON_TYPE_", "").lower()
    pvp_type = combat_move["type"].replace("POKEMON_TYPE_", "").lower()
    if pve_type != pvp_type or pve_type not in TYPE_NAMES_KO:
        raise RuntimeError(f"Special move type mismatch for {move_id}")
    return {
        "id": move_id,
        "ko": metadata["ko"],
        "en": metadata["en"],
        "type": pve_type,
        "typeKo": TYPE_NAMES_KO[pve_type],
        "power": int(move_settings.get("power") or 0),
        "energy": int(move_settings.get("energyDelta") or 0),
        "duration": int(move_settings.get("durationMs") or 0),
        "pvpPower": int(combat_move.get("power") or 0),
        "pvpEnergy": int(combat_move.get("energyDelta") or 0),
        "turns": int(combat_move.get("durationTurns") or 1),
        "elite": False,
        "access": {
            "kind": metadata["accessKind"],
            "tmLearnability": "none",
            "label": metadata["accessLabel"],
            "source": metadata["source"],
        },
    }


def form_image(base, entry, dex: int) -> str:
    """Prefer an exact GO form asset before using a dex-level fallback."""
    direct = (entry.get("assets") or {}).get("image")
    if direct:
        return direct
    form_id = entry.get("formId")
    if form_id:
        exact = [
            asset for asset in (base.get("assetForms") or [])
            if asset.get("form") == form_id
            and not asset.get("costume")
            and not asset.get("isFemale")
            and asset.get("image")
        ]
        if exact:
            return exact[0]["image"]
    return f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{dex}.png"


def move_values(value):
    return value.values() if isinstance(value, dict) else value


def raw_type_id(value) -> str | None:
    if not value:
        return None
    return value["type"].replace("POKEMON_TYPE_", "").lower()


def raw_move_ids(entry, field: str) -> tuple[str, ...]:
    return tuple(sorted(
        move["id"].removesuffix("_FAST")
        for move in move_values(entry.get(field) or [])
    ))


def intrinsic_combat_signature(entry):
    """Return combat fields independent of a form's evolution target."""
    stats = entry["stats"]
    return (
        stats["attack"], stats["defense"], stats["stamina"],
        raw_type_id(entry.get("primaryType")),
        raw_type_id(entry.get("secondaryType")),
        raw_move_ids(entry, "quickMoves"),
        raw_move_ids(entry, "eliteQuickMoves"),
        raw_move_ids(entry, "cinematicMoves"),
        raw_move_ids(entry, "eliteCinematicMoves"),
    )


def raw_form_lookup(raw):
    lookup = {}
    for base in raw:
        lookup[base["id"]] = base
        lookup[f"{base['id']}_NORMAL"] = base
        for form in move_values(base.get("regionForms") or []):
            lookup[form.get("formId") or form["id"]] = form
    return lookup


def freeze_value(value):
    if isinstance(value, dict):
        return tuple(sorted((key, freeze_value(item)) for key, item in value.items()))
    if isinstance(value, list):
        return tuple(freeze_value(item) for item in value)
    return value


def normalized_evolutions(entry, form_lookup) -> tuple[tuple, ...]:
    """Compare evolution outcomes by combat data, not cosmetic form IDs."""
    output = []
    for evolution in entry.get("evolutions") or []:
        target = form_lookup.get(evolution.get("formId")) or form_lookup.get(evolution.get("id"))
        output.append((
            evolution.get("id"),
            intrinsic_combat_signature(target) if target else None,
            evolution.get("candies"),
            freeze_value(evolution.get("item")),
            freeze_value(evolution.get("quests") or []),
        ))
    return tuple(sorted(output, key=repr))


def combat_signature(entry, form_lookup):
    """Return fields that can change this form's valuation or evolution."""
    return intrinsic_combat_signature(entry) + (normalized_evolutions(entry, form_lookup),)


def preserves_identity(form) -> bool:
    form_id = form.get("formId") or ""
    return (
        form_id.endswith("_FEMALE")
        or form_id.endswith("_MALE")
        or form_id in PRESERVED_FORM_IDS
    )


def select_combat_forms(base, form_lookup):
    """Keep one canonical entry per combat-distinct form group.

    pokemon-go-api uses ``regionForms`` for regional, battle, gender and
    special forms. Pure costumes and patterns are collapsed when their stats,
    types, move pools and evolution targets are identical.
    """
    forms = [
        form for form in move_values(base.get("regionForms") or [])
        if not any(fragment in (form.get("formId") or "") for fragment in EXCLUDED_FORM_FRAGMENTS)
        and not (form.get("formId") or "").endswith("_S")
    ]
    if not forms:
        return [(base, [base.get("formId") or base["id"]], True)]

    named_default = CANONICAL_DEFAULT_FORMS.get(base["dexNr"])
    if named_default and not any(form.get("formId") == named_default for form in forms):
        raise RuntimeError(f"Canonical form {named_default} is missing upstream")
    if named_default:
        return [
            (form, [form.get("formId") or form["id"]], form.get("formId") == named_default)
            for form in forms
        ]

    collapsed_default = COLLAPSED_DEFAULT_FORMS.get(base["dexNr"])
    candidates = (
        [(form, form.get("formId") == collapsed_default) for form in forms]
        if collapsed_default
        else [(base, True), *((form, False) for form in forms)]
    )
    groups: dict[tuple, list[tuple[dict, bool]]] = {}
    for form, is_default in candidates:
        signature = combat_signature(form, form_lookup)
        if preserves_identity(form):
            signature += (form.get("formId"),)
        groups.setdefault(signature, []).append((form, is_default))

    selected = []
    for candidates in groups.values():
        defaults = [item for item, is_default in candidates if is_default]
        variants = sorted(
            (item for item, _ in candidates),
            key=lambda item: item.get("formId") or item["id"],
        )
        chosen = defaults[0] if defaults else variants[0]
        aliases = [item.get("formId") or item["id"] for item, _ in candidates]
        selected.append((chosen, aliases, bool(defaults)))
    return selected


def canonical_form_slug(base, form) -> str:
    if form is base:
        return BASE_FORM_SLUG_OVERRIDES.get(base["dexNr"], "normal")
    form_id = form.get("formId") or form["id"]
    prefix = f"{base['id']}_"
    slug = form_id[len(prefix):] if form_id.startswith(prefix) else form_id
    if base["dexNr"] == 774:
        return "core"
    return slug.lower()


def build_form_catalog(raw):
    selections = []
    form_to_key: dict[str, str] = {}
    default_by_id: dict[str, str] = {}
    form_lookup = raw_form_lookup(raw)
    for base in raw:
        for form, aliases, is_default in select_combat_forms(base, form_lookup):
            slug = canonical_form_slug(base, form)
            species_key = f"{base['dexNr']}:{slug}"
            selections.append((base, form, species_key, is_default))
            for alias in aliases:
                form_to_key[alias] = species_key
            if is_default:
                default_by_id[base["id"]] = species_key
                form_to_key.setdefault(f"{base['id']}_NORMAL", species_key)
    return selections, form_to_key, default_by_id


def build_pokemon(raw, dynamax: set[int], gigantamax: set[int]):
    id_to_dex = {entry["id"]: entry["dexNr"] for entry in raw}
    selections, form_to_key, default_by_id = build_form_catalog(raw)
    output = []
    for base, entry, species_key, is_default in selections:
        form_slug = species_key.split(":", 1)[1]
        fast = [compact_move(move, False, True) for move in move_values(entry.get("quickMoves", []))]
        fast += [compact_move(move, True, True) for move in move_values(entry.get("eliteQuickMoves", []))]
        charged = [compact_move(move, False, False) for move in move_values(entry.get("cinematicMoves", []))]
        charged += [compact_move(move, True, False) for move in move_values(entry.get("eliteCinematicMoves", []))]
        evolutions = []
        seen_evolutions = set()
        for evolution in entry.get("evolutions", []):
            target = id_to_dex.get(evolution.get("id"))
            target_key = form_to_key.get(evolution.get("formId")) or default_by_id.get(evolution.get("id"))
            identity = (
                target_key,
                evolution.get("candies"),
                freeze_value(evolution.get("item")),
                freeze_value(evolution.get("quests") or []),
            )
            if target and target_key and identity not in seen_evolutions:
                seen_evolutions.add(identity)
                evolutions.append({
                    "dex": target,
                    "speciesKey": target_key,
                    "candy": evolution.get("candies"),
                    "item": (evolution.get("item") or {}).get("names", {}).get("Korean") if isinstance(evolution.get("item"), dict) else evolution.get("item"),
                })
        mega = []
        values = entry.get("megaEvolutions") or {}
        if isinstance(values, dict):
            values = values.values()
        for form in values:
            mega.append({
                "id": form["id"].lower(),
                "name": form["names"].get("Korean") or form["names"].get("English"),
                "stats": {
                    "attack": form["stats"]["attack"],
                    "defense": form["stats"]["defense"],
                    "stamina": form["stats"]["stamina"],
                },
                "types": [value for value in (compact_type(form.get("primaryType")), compact_type(form.get("secondaryType"))) if value],
                "image": (form.get("assets") or {}).get("image"),
            })
        dex = entry["dexNr"]
        max_form = is_default or form_slug in MAX_FORM_SLUGS.get(dex, set())
        output.append({
            "dex": dex,
            "speciesKey": species_key,
            "formId": entry.get("formId") or entry["id"],
            "formSlug": form_slug,
            "id": base["id"].lower(),
            "isDefault": is_default,
            "name": entry["names"].get("Korean") or entry["names"].get("English"),
            "en": entry["names"].get("English"),
            "baseName": base["names"].get("Korean") or base["names"].get("English"),
            "baseEn": base["names"].get("English"),
            "generation": entry.get("generation"),
            "stats": {
                "attack": entry["stats"]["attack"],
                "defense": entry["stats"]["defense"],
                "stamina": entry["stats"]["stamina"],
            },
            "types": [value for value in (compact_type(entry.get("primaryType")), compact_type(entry.get("secondaryType"))) if value],
            "class": (entry.get("pokemonClass") or "").replace("POKEMON_CLASS_", "").lower() or None,
            "image": form_image(base, entry, dex),
            "evolutions": evolutions,
            "moves": {"fast": fast, "charged": charged},
            "mega": mega,
            "pvpSpeciesId": None,
            "shadowEligible": False,
            "shadow": None,
            "dynamax": max_form and dex in dynamax,
            "gigantamax": max_form and dex in gigantamax,
            "maxCapable": max_form and (dex in dynamax or dex in gigantamax),
            "sourceRefs": [
                SOURCE_IDS["pokemon_go_api"],
                SOURCE_IDS["pvpoke_game_master"],
                SOURCE_IDS["serebii_max"],
            ],
        })
    return sorted(output, key=lambda item: (item["dex"], not item["isDefault"], item["name"]))


def pvp_stats(pokemon) -> dict[str, int]:
    return {
        "atk": pokemon["stats"]["attack"],
        "def": pokemon["stats"]["defense"],
        "hp": pokemon["stats"]["stamina"],
    }


def pvp_types(pokemon) -> frozenset[str]:
    return frozenset(value["id"] for value in pokemon["types"])


def gm_types(species) -> frozenset[str]:
    return frozenset(value for value in species.get("types", []) if value != "none")


def move_ids(pokemon, kind: str) -> set[str]:
    return {move["id"] for move in pokemon["moves"][kind]}


def pvp_species_aliases(pokemon) -> list[str]:
    raw = pokemon["formId"].lower()
    aliases = [PVP_FORM_ID_ALIASES.get(raw, raw), raw]
    if pokemon["formSlug"] == "normal":
        aliases.append(pokemon["id"])
    replacements = {
        "_alola": "_alolan",
        "_galar": "_galarian",
        "_hisui": "_hisuian",
        "_paldea": "_paldean",
    }
    for suffix, replacement in replacements.items():
        if raw.endswith(suffix):
            aliases.append(raw.removesuffix(suffix) + replacement)
    tauros = {
        "tauros_paldea_aqua": "tauros_aqua",
        "tauros_paldea_blaze": "tauros_blaze",
        "tauros_paldea_combat": "tauros_combat",
    }
    if raw in tauros:
        aliases.append(tauros[raw])
    return list(dict.fromkeys(aliases))


def representative_pvp_species(pokemon, candidates):
    """Resolve one PvPoke form without ever falling back to another form.

    A dex number alone is insufficient for form species such as Deoxys and
    Giratina. Stats and types must describe the compact Pokémon GO API entry.
    Exact IDs win; otherwise a unique form can be inferred from its fingerprint.
    If multiple cosmetic/form candidates remain, returning None is safer than
    attaching a different form's ranking and moves.
    """
    matches = [
        species for species in candidates
        if species.get("baseStats") == pvp_stats(pokemon)
        and gm_types(species) == pvp_types(pokemon)
    ]
    aliases = pvp_species_aliases(pokemon)
    for alias in aliases:
        exact_id = [species for species in matches if species["speciesId"] == alias]
        if len(exact_id) == 1:
            return exact_id[0]
    if len(matches) == 1:
        return matches[0]

    fast = move_ids(pokemon, "fast")
    charged = move_ids(pokemon, "charged")
    exact_moves = [
        species for species in matches
        if set(species.get("fastMoves") or []) == fast
        and set(species.get("chargedMoves") or []) == charged
    ]
    return exact_moves[0] if len(exact_moves) == 1 else None


def canonical_rank_moves(rank) -> list[str]:
    return [PVP_MOVE_ID_ALIASES.get(move, move) for move in rank.get("moveset", [])]


def rank_moves_exist(pokemon, moves: list[str]) -> bool:
    if not moves:
        return False
    fast = move_ids(pokemon, "fast")
    charged = move_ids(pokemon, "charged")
    return moves[0] in fast and all(move in charged for move in moves[1:])


def build_pvp(pokemon):
    gm = fetch_json(PVP_GM_URL)
    gm_by_dex: dict[int, list[dict]] = {}
    for species in gm["pokemon"]:
        dex = species.get("dex")
        tags = set(species.get("tags") or [])
        if not dex or "shadow" in tags or "mega" in tags:
            continue
        gm_by_dex.setdefault(dex, []).append(species)

    representatives = {
        entry["speciesKey"]: representative_pvp_species(entry, gm_by_dex.get(entry["dex"], []))
        for entry in pokemon
    }
    for entry in pokemon:
        species = representatives[entry["speciesKey"]]
        entry["pvpSpeciesId"] = species["speciesId"] if species else None
        entry["shadowEligible"] = bool(
            species and "shadoweligible" in set(species.get("tags") or [])
        )
    leagues = {}
    league_sources = {
        "great": SOURCE_IDS["pvpoke_great"],
        "ultra": SOURCE_IDS["pvpoke_ultra"],
        "master": SOURCE_IDS["pvpoke_master"],
    }
    for league, cap in (("great", 1500), ("ultra", 2500), ("master", 10000)):
        rankings = fetch_json(PVP_RANK_URL.format(cap=cap))
        ranked_by_id = {rank["speciesId"]: (index, rank) for index, rank in enumerate(rankings)}
        selected = {}
        for entry in pokemon:
            species = representatives[entry["speciesKey"]]
            if not species:
                continue
            ranked = ranked_by_id.get(species["speciesId"])
            if not ranked:
                continue
            index, rank = ranked
            moves = canonical_rank_moves(rank)
            if not rank_moves_exist(entry, moves):
                continue
            selected[entry["speciesKey"]] = {
                "rank": index + 1,
                "score": rank.get("score"),
                "rating": rank.get("rating"),
                "moves": moves,
                "species": species.get("speciesName"),
                "speciesId": species["speciesId"],
                "sourceRefs": [
                    SOURCE_IDS["pvpoke_game_master"],
                    league_sources[league],
                ],
            }
        leagues[league] = selected
    return {
        "updated": gm.get("timestamp"),
        "leagues": leagues,
    }


def compact_shadow(settings, rule: str = "standard"):
    shadow = settings.get("shadow") or {}
    third_move = settings.get("thirdMove") or {}
    return {
        "purificationStardust": shadow["purificationStardustNeeded"],
        "purificationCandy": shadow["purificationCandyNeeded"],
        "shadowMove": shadow["shadowChargeMove"],
        "purifiedMove": shadow["purifiedChargeMove"],
        "secondMoveStardust": third_move.get("stardustToUnlock"),
        "secondMoveCandy": third_move.get("candyToUnlock"),
        "rule": rule,
    }


def apply_special_move_overlays(pokemon, game_master):
    """Attach non-TM distribution moves to the exact forms that can own them."""
    by_key = {entry["speciesKey"]: entry for entry in pokemon}
    move_settings = {}
    combat_moves = {}
    for template in game_master:
        data = template.get("data") or {}
        move = data.get("moveSettings")
        if move and move.get("movementId"):
            move_settings[move["movementId"]] = move
        combat = data.get("combatMove")
        if combat and combat.get("uniqueId"):
            combat_moves[combat["uniqueId"]] = combat

    for species_key, overlays in SPECIAL_MOVE_OVERLAYS.items():
        entry = by_key.get(species_key)
        if not entry:
            raise RuntimeError(f"Special move target form missing: {species_key}")
        charged = entry["moves"]["charged"]
        for metadata in overlays:
            move_id = metadata["id"]
            existing = [move for move in charged if move["id"] == move_id]
            if existing:
                raise RuntimeError(
                    f"Special move {move_id} is now present in the upstream move pool for "
                    f"{species_key}; review whether its acquisition route is still non-TM"
                )
            settings = move_settings.get(move_id)
            combat = combat_moves.get(move_id)
            if not settings or not combat:
                raise RuntimeError(f"Special move battle settings missing: {move_id}")
            compact = compact_special_move(settings, combat, metadata)
            if compact["power"] <= 0 or compact["energy"] >= 0 or compact["duration"] <= 0:
                raise RuntimeError(f"Special move has unusable PvE values: {move_id}")
            charged.append(compact)
        if SOURCE_IDS["pokeminers_game_master"] not in entry["sourceRefs"]:
            entry["sourceRefs"].append(SOURCE_IDS["pokeminers_game_master"])


def apply_shadow_data(pokemon, game_master):
    settings_by_id: dict[str, list[dict]] = {}
    for template in game_master:
        settings = (template.get("data") or {}).get("pokemonSettings")
        if settings and settings.get("pokemonId"):
            settings_by_id.setdefault(settings["pokemonId"], []).append(settings)

    for entry in pokemon:
        if not entry["shadowEligible"]:
            continue
        pokemon_id = entry["id"].upper()
        form_id = entry["formId"]
        candidates = settings_by_id.get(pokemon_id, [])
        preferred_forms = [form_id]
        if entry["isDefault"]:
            preferred_forms.extend((f"{pokemon_id}_NORMAL", None, pokemon_id))
        preferred_forms = list(dict.fromkeys(preferred_forms))
        selected = None
        for preferred in preferred_forms:
            matches = [
                settings for settings in candidates
                if settings.get("form") == preferred and settings.get("shadow")
            ]
            if len(matches) == 1:
                selected = matches[0]
                break
        if not selected:
            raise RuntimeError(f"Shadow settings missing for {entry['speciesKey']}")
        gm_stats = selected.get("stats") or {}
        expected_stats = {
            "attack": gm_stats.get("baseAttack"),
            "defense": gm_stats.get("baseDefense"),
            "stamina": gm_stats.get("baseStamina"),
        }
        gm_types = {
            value.replace("POKEMON_TYPE_", "").lower()
            for value in (selected.get("type"), selected.get("type2"))
            if value and value != "POKEMON_TYPE_NONE"
        }
        local_types = {value["id"] for value in entry["types"]}
        if expected_stats != entry["stats"] or gm_types != local_types:
            raise RuntimeError(f"Shadow form fingerprint mismatch for {entry['speciesKey']}")
        entry["shadow"] = compact_shadow(selected)
        if SOURCE_IDS["pokeminers_game_master"] not in entry["sourceRefs"]:
            entry["sourceRefs"].append(SOURCE_IDS["pokeminers_game_master"])

        if pokemon_id in {"LUGIA", "HO_OH"} and entry["isDefault"]:
            apex = next(
                (settings for settings in candidates if settings.get("form") == f"{pokemon_id}_S"),
                None,
            )
            if apex and apex.get("shadow"):
                rule = "apex_lugia" if pokemon_id == "LUGIA" else "apex_ho_oh"
                entry["shadow"]["apex"] = compact_shadow(apex, rule)


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    raw = fetch_json(POKEDEX_URL)
    dynamax, gigantamax = max_capabilities()
    pokemon = build_pokemon(raw, dynamax, gigantamax)
    game_master = fetch_json(POKEMINERS_GM_URL)
    apply_special_move_overlays(pokemon, game_master)
    pvp = build_pvp(pokemon)
    apply_shadow_data(pokemon, game_master)
    generated_at = rfc3339_now()
    updated = generated_at[:10]
    write_json(DATA_DIR / "pokemon.json", {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "updated": updated,
        "sources": pokemon_sources(),
        "pokemon": pokemon,
    })
    write_json(DATA_DIR / "pvp.json", {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "updated": pvp["updated"],
        "sources": pvp_sources(),
        "leagues": pvp["leagues"],
    })
    max_capable = sum(entry["maxCapable"] for entry in pokemon)
    print(
        f"Wrote {len(pokemon)} valuation forms across {len(raw)} Pokédex numbers, "
        f"{len(dynamax)} Dynamax, "
        f"{len(gigantamax)} Gigantamax ({max_capable} Max-capable)"
    )


if __name__ == "__main__":
    main()
