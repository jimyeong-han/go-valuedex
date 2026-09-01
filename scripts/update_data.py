#!/usr/bin/env python3
"""Build the compact, static data files consumed by GO ValueDex."""

from __future__ import annotations

import datetime as dt
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

# A few equivalent moves use different identifiers in the two upstream data
# sets. Canonicalise only the known one-to-one aliases so every stored
# recommendation can still be resolved against pokemon.json.
PVP_MOVE_ID_ALIASES = {
    "AEGISLASH_CHARGE_PSYCHO_CUT": "PSYCHO_CUT",
    "FUTURE_SIGHT": "FUTURESIGHT",
    "PYRO_BALL": "PYROBALL",
}


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "GO-ValueDex-data-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def fetch_text(url: str, encoding: str = "utf-8") -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "GO-ValueDex-data-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode(encoding, errors="replace")


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
    return {
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


def move_values(value):
    return value.values() if isinstance(value, dict) else value


def build_pokemon(raw, dynamax: set[int], gigantamax: set[int]):
    id_to_dex = {entry["id"]: entry["dexNr"] for entry in raw}
    output = []
    for entry in raw:
        fast = [compact_move(move, False, True) for move in move_values(entry.get("quickMoves", []))]
        fast += [compact_move(move, True, True) for move in move_values(entry.get("eliteQuickMoves", []))]
        charged = [compact_move(move, False, False) for move in move_values(entry.get("cinematicMoves", []))]
        charged += [compact_move(move, True, False) for move in move_values(entry.get("eliteCinematicMoves", []))]
        evolutions = []
        for evolution in entry.get("evolutions", []):
            target = id_to_dex.get(evolution.get("id"))
            if target:
                evolutions.append({
                    "dex": target,
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
        output.append({
            "dex": dex,
            "id": entry["id"].lower(),
            "name": entry["names"].get("Korean") or entry["names"].get("English"),
            "en": entry["names"].get("English"),
            "generation": entry.get("generation"),
            "stats": {
                "attack": entry["stats"]["attack"],
                "defense": entry["stats"]["defense"],
                "stamina": entry["stats"]["stamina"],
            },
            "types": [value for value in (compact_type(entry.get("primaryType")), compact_type(entry.get("secondaryType"))) if value],
            "class": (entry.get("pokemonClass") or "").replace("POKEMON_CLASS_", "").lower() or None,
            "image": (entry.get("assets") or {}).get("image") or f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{dex}.png",
            "evolutions": evolutions,
            "moves": {"fast": fast, "charged": charged},
            "mega": mega,
            "dynamax": dex in dynamax,
            "gigantamax": dex in gigantamax,
            "maxCapable": dex in dynamax or dex in gigantamax,
        })
    return output


def pvp_stats(pokemon) -> dict[str, int]:
    return {
        "atk": pokemon["stats"]["attack"],
        "def": pokemon["stats"]["defense"],
        "hp": pokemon["stats"]["stamina"],
    }


def pvp_types(pokemon) -> tuple[str, ...]:
    return tuple(value["id"] for value in pokemon["types"])


def gm_types(species) -> tuple[str, ...]:
    return tuple(value for value in species.get("types", []) if value != "none")


def move_ids(pokemon, kind: str) -> set[str]:
    return {move["id"] for move in pokemon["moves"][kind]}


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
    exact_id = [species for species in matches if species["speciesId"] == pokemon["id"]]
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
        entry["dex"]: representative_pvp_species(entry, gm_by_dex.get(entry["dex"], []))
        for entry in pokemon
    }
    leagues = {}
    for league, cap in (("great", 1500), ("ultra", 2500), ("master", 10000)):
        rankings = fetch_json(PVP_RANK_URL.format(cap=cap))
        ranked_by_id = {rank["speciesId"]: (index, rank) for index, rank in enumerate(rankings)}
        selected = {}
        for entry in pokemon:
            species = representatives[entry["dex"]]
            if not species:
                continue
            ranked = ranked_by_id.get(species["speciesId"])
            if not ranked:
                continue
            index, rank = ranked
            moves = canonical_rank_moves(rank)
            if not rank_moves_exist(entry, moves):
                continue
            selected[str(entry["dex"])] = {
                "rank": index + 1,
                "score": rank.get("score"),
                "rating": rank.get("rating"),
                "moves": moves,
                "species": species.get("speciesName"),
                "speciesId": species["speciesId"],
            }
        leagues[league] = selected
    return {
        "updated": gm.get("timestamp"),
        "leagues": leagues,
    }


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    raw = fetch_json(POKEDEX_URL)
    dynamax, gigantamax = max_capabilities()
    pokemon = build_pokemon(raw, dynamax, gigantamax)
    pvp = build_pvp(pokemon)
    updated = dt.datetime.now(dt.timezone.utc).date().isoformat()
    write_json(DATA_DIR / "pokemon.json", {"updated": updated, "pokemon": pokemon})
    write_json(DATA_DIR / "pvp.json", pvp)
    max_capable = sum(entry["maxCapable"] for entry in pokemon)
    print(
        f"Wrote {len(pokemon)} Pokémon, {len(dynamax)} Dynamax, "
        f"{len(gigantamax)} Gigantamax ({max_capable} Max-capable)"
    )


if __name__ == "__main__":
    main()
