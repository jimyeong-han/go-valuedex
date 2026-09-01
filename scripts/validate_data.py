#!/usr/bin/env python3
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parents[1]
pokemon = json.loads((root / "data/pokemon.json").read_text(encoding="utf-8"))["pokemon"]
pvp_data = json.loads((root / "data/pvp.json").read_text(encoding="utf-8"))
pvp = pvp_data["leagues"]

assert len(pokemon) >= 1000, "Pokédex is unexpectedly small"
by_dex = {entry["dex"]: entry for entry in pokemon}
assert len(by_dex) == len(pokemon), "Duplicate Pokédex numbers"
for entry in pokemon:
    assert entry["name"] and entry["en"] and entry["types"]
    assert all(entry["stats"][key] > 0 for key in ("attack", "defense", "stamina"))
    assert all(evolution["dex"] in by_dex for evolution in entry["evolutions"])
    assert entry["maxCapable"] == (entry["dynamax"] or entry["gigantamax"])
assert sum(entry["dynamax"] for entry in pokemon) >= 20
assert sum(entry["gigantamax"] for entry in pokemon) >= 5
assert sum(entry["maxCapable"] for entry in pokemon) >= sum(entry["dynamax"] for entry in pokemon)
assert all(len(pvp[league]) >= 100 for league in ("great", "ultra", "master"))

# These currently appear only in the Gigantamax source section. They must still
# be treated as Max-capable without changing the meaning of the raw flags.
for dex in (52, 131, 143, 861):
    assert by_dex[dex]["gigantamax"]
    assert by_dex[dex]["maxCapable"]

for league, rankings in pvp.items():
    for dex_value, meta in rankings.items():
        entry = by_dex[int(dex_value)]
        fast_moves = {move["id"] for move in entry["moves"]["fast"]}
        charged_moves = {move["id"] for move in entry["moves"]["charged"]}
        assert meta["speciesId"]
        assert meta["moves"], f"{league} #{dex_value} has no recommended moves"
        assert meta["moves"][0] in fast_moves, (
            f"{league} #{dex_value} recommends unavailable fast move {meta['moves'][0]}"
        )
        assert all(move in charged_moves for move in meta["moves"][1:]), (
            f"{league} #{dex_value} recommends an unavailable charged move"
        )

# Form-sensitive regression fixtures: never substitute a stronger form merely
# because it shares a Pokédex number with the compact representative entry.
expected_forms = {
    386: "deoxys",
    487: "giratina_altered",
    641: "tornadus_incarnate",
    642: "thundurus_incarnate",
    645: "landorus_incarnate",
}
for rankings in pvp.values():
    for dex, species_id in expected_forms.items():
        meta = rankings.get(str(dex))
        if meta:
            assert meta["speciesId"] == species_id, (
                f"#{dex} representative was incorrectly mapped to {meta['speciesId']}"
            )

bulbasaur = by_dex[1]
cpm = 0.5974
perfect_level_20_cp = math.floor(
    (bulbasaur["stats"]["attack"] + 15)
    * math.sqrt(bulbasaur["stats"]["defense"] + 15)
    * math.sqrt(bulbasaur["stats"]["stamina"] + 15)
    * cpm * cpm / 10
)
assert perfect_level_20_cp == 637, "CP formula fixture changed"
print(f"Validated {len(pokemon)} Pokémon and all league snapshots")
