#!/usr/bin/env python3
import json
import math
import re
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parents[1]
pokemon = json.loads((root / "data/pokemon.json").read_text(encoding="utf-8"))["pokemon"]
pvp_data = json.loads((root / "data/pvp.json").read_text(encoding="utf-8"))
pvp = pvp_data["leagues"]

assert len(pokemon) >= 1150, "Form-aware Pokédex is unexpectedly small"
by_key = {entry["speciesKey"]: entry for entry in pokemon}
assert len(by_key) == len(pokemon), "Duplicate speciesKey values"
by_dex = defaultdict(list)
for entry in pokemon:
    by_dex[entry["dex"]].append(entry)
assert len(by_dex) >= 1000, "Pokédex number coverage is unexpectedly small"

for dex, forms in by_dex.items():
    defaults = [entry for entry in forms if entry["isDefault"]]
    assert len(defaults) == 1, f"#{dex} must have exactly one default form"

for entry in pokemon:
    assert re.fullmatch(r"\d+:[a-z0-9_]+", entry["speciesKey"]), entry["speciesKey"]
    dex_value, form_slug = entry["speciesKey"].split(":", 1)
    assert int(dex_value) == entry["dex"] and form_slug == entry["formSlug"]
    assert entry["name"] and entry["en"] and entry["types"]
    assert entry["baseName"] and entry["baseEn"] and entry["formSlug"]
    assert all(entry["stats"][key] > 0 for key in ("attack", "defense", "stamina"))
    for evolution in entry["evolutions"]:
        assert evolution["speciesKey"] in by_key
        assert by_key[evolution["speciesKey"]]["dex"] == evolution["dex"]
    assert len({evolution["speciesKey"] for evolution in entry["evolutions"]}) == len(entry["evolutions"])
    assert entry["maxCapable"] == (entry["dynamax"] or entry["gigantamax"])
    if entry["pvpSpeciesId"] is None:
        assert not entry["shadowEligible"]

assert sum(entry["dynamax"] for entry in pokemon) >= 20
assert sum(entry["gigantamax"] for entry in pokemon) >= 5
assert sum(entry["maxCapable"] for entry in pokemon) >= sum(entry["dynamax"] for entry in pokemon)
assert all(len(pvp[league]) >= 100 for league in ("great", "ultra", "master"))

# These currently appear only in the Gigantamax source section. They must still
# be treated as Max-capable without changing the raw Dynamax flag.
for dex in (52, 131, 143, 861):
    default = next(entry for entry in by_dex[dex] if entry["isDefault"])
    assert default["gigantamax"] and default["maxCapable"]

for league, rankings in pvp.items():
    for species_key, meta in rankings.items():
        entry = by_key[species_key]
        fast_moves = {move["id"] for move in entry["moves"]["fast"]}
        charged_moves = {move["id"] for move in entry["moves"]["charged"]}
        assert meta["speciesId"] == entry["pvpSpeciesId"]
        assert meta["moves"], f"{league} {species_key} has no recommended moves"
        assert meta["moves"][0] in fast_moves, (
            f"{league} {species_key} recommends unavailable fast move {meta['moves'][0]}"
        )
        assert all(move in charged_moves for move in meta["moves"][1:]), (
            f"{league} {species_key} recommends an unavailable charged move"
        )

# Form-sensitive regression fixtures.
assert {entry["speciesKey"] for entry in by_dex[386]} == {
    "386:normal", "386:attack", "386:defense", "386:speed"
}
assert by_key["386:defense"]["stats"] == {"attack": 144, "defense": 330, "stamina": 137}
assert {entry["speciesKey"] for entry in by_dex[487]} == {"487:altered", "487:origin"}
assert by_key["487:altered"]["pvpSpeciesId"] == "giratina_altered"
assert by_key["487:origin"]["pvpSpeciesId"] == "giratina_origin"
assert {entry["speciesKey"] for entry in by_dex[645]} == {"645:incarnate", "645:therian"}

alolan_rattata = by_key["19:alola"]
assert any(evolution["speciesKey"] == "20:alola" for evolution in alolan_rattata["evolutions"])
assert by_key["100:hisuian"]["pvpSpeciesId"] == "voltorb_hisuian"
assert any(
    evolution["speciesKey"] == "413:sandy"
    for evolution in by_key["412:sandy"]["evolutions"]
)
assert len({by_key[f"412:{form}"]["image"] for form in ("plant", "sandy", "trash")}) == 3

# Cosmetic patterns and colours that do not change valuation collapse through
# their whole evolution chain instead of creating one giant mixed family.
assert {entry["speciesKey"] for entry in by_dex[664]} == {"664:normal"}
assert by_key["664:normal"]["evolutions"][0]["speciesKey"] == "665:normal"
assert by_key["665:normal"]["evolutions"][0]["speciesKey"] == "666:normal"
assert {entry["speciesKey"] for entry in by_dex[669]} == {"669:normal"}
assert by_key["669:normal"]["evolutions"][0]["speciesKey"] == "670:normal"
assert by_key["670:normal"]["evolutions"][0]["speciesKey"] == "671:normal"

# Gender identity remains selectable even when battle stats are shared.
assert {entry["speciesKey"] for entry in by_dex[593]} == {"593:normal", "593:female"}
assert {entry["speciesKey"] for entry in by_dex[668]} == {"668:normal", "668:female"}

assert by_key["720:confined"]["pvpSpeciesId"] == "hoopa"
assert by_key["778:disguised"]["pvpSpeciesId"] == "mimikyu"
assert by_key["978:normal"]["pvpSpeciesId"] == "tatsugiri_curly"

sinistea = {entry["formSlug"]: entry for entry in by_dex[854]}
assert set(sinistea) == {"phony", "antique"}
assert sinistea["phony"]["evolutions"] == [{
    "dex": 855, "speciesKey": "855:phony", "candy": 50, "item": None,
}]
assert sinistea["antique"]["evolutions"] == [{
    "dex": 855, "speciesKey": "855:antique", "candy": 400, "item": None,
}]
poltchageist = {entry["formSlug"]: entry for entry in by_dex[1012]}
assert set(poltchageist) == {"counterfeit", "artisan"}
assert poltchageist["counterfeit"]["evolutions"][0]["candy"] == 50
assert poltchageist["counterfeit"]["evolutions"][0]["speciesKey"] == "1013:unremarkable"
assert poltchageist["artisan"]["evolutions"][0]["candy"] == 400
assert poltchageist["artisan"]["evolutions"][0]["speciesKey"] == "1013:masterpiece"

for species_key in ("849:amped", "849:low_key", "892:single_strike", "892:rapid_strike"):
    assert by_key[species_key]["maxCapable"]

assert "888:normal" not in by_key
assert {value["id"] for value in by_key["888:hero"]["types"]} == {"fairy"}
assert {value["id"] for value in by_key["888:crowned_sword"]["types"]} == {"fairy", "steel"}
assert not any("anniversary" in entry["speciesKey"] for entry in pokemon)
assert by_key["51:normal"]["pvpSpeciesId"] is None, "Mismatched Dugtrio stats must not be joined"

bulbasaur = by_key["1:normal"]
cpm = 0.5974
perfect_level_20_cp = math.floor(
    (bulbasaur["stats"]["attack"] + 15)
    * math.sqrt(bulbasaur["stats"]["defense"] + 15)
    * math.sqrt(bulbasaur["stats"]["stamina"] + 15)
    * cpm * cpm / 10
)
assert perfect_level_20_cp == 637, "CP formula fixture changed"
print(f"Validated {len(pokemon)} valuation forms and all league snapshots")
