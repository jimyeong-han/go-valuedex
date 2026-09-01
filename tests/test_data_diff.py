from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_data_diff import (
    Limits,
    Snapshot,
    compare_snapshots,
    documents_have_substantive_changes,
    load_snapshot_from_directory,
)


TEST_LIMITS = Limits(
    min_forms=0,
    min_dex_numbers=0,
    min_pvp_entries_per_league=0,
    form_drop_ratio=0.05,
    form_drop_floor=1,
    removed_form_ratio=0.05,
    removed_form_floor=1,
    shadow_drop_ratio=0.10,
    shadow_drop_floor=1,
    shadow_removal_cap=3,
    max_capable_drop_ratio=0.10,
    max_capable_drop_floor=1,
    max_capable_removal_cap=2,
    move_coverage_drop_ratio=0.05,
    move_coverage_drop_floor=1,
    pvp_drop_ratio=0.10,
    pvp_drop_floor=1,
    pvp_removal_cap=3,
    fingerprint_change_ratio=0.05,
    fingerprint_change_floor=1,
    move_signature_change_ratio=0.05,
    move_signature_change_cap=75,
)


def documents(count: int = 40):
    pokemon = []
    for dex in range(1, count + 1):
        key = f"{dex}:normal"
        pokemon.append(
            {
                "speciesKey": key,
                "dex": dex,
                "stats": {"attack": 100 + dex, "defense": 100, "stamina": 100},
                "types": [{"id": "normal"}],
                "shadowEligible": dex <= 20,
                "maxCapable": dex <= 10,
                "moves": {
                    "fast": [{"id": "TACKLE"}],
                    "charged": [{"id": "STRUGGLE"}],
                },
            }
        )
    rankings = {record["speciesKey"]: {} for record in pokemon}
    return {"pokemon": pokemon}, {
        "leagues": {league: copy.deepcopy(rankings) for league in ("great", "ultra", "master")}
    }


def snapshot(pair):
    return Snapshot.from_documents(*pair)


class DataDiffGuardTests(unittest.TestCase):
    def test_identical_snapshot_passes(self):
        baseline = snapshot(documents())
        report = compare_snapshots(baseline, baseline, TEST_LIMITS)
        self.assertTrue(report.ok, report.errors)

    def test_additive_update_passes_and_is_reported(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        added = copy.deepcopy(current_documents[0]["pokemon"][-1])
        added.update(speciesKey="41:normal", dex=41)
        current_documents[0]["pokemon"].append(added)
        for league in current_documents[1]["leagues"].values():
            league["41:normal"] = {}

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertTrue(report.ok, report.errors)
        self.assertTrue(any("Added 1 form" in warning for warning in report.warnings))

    def test_mass_form_deletion_is_rejected(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        current_documents[0]["pokemon"] = current_documents[0]["pokemon"][:-5]

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(any("form count fell" in error for error in report.errors))

    def test_lost_dex_is_rejected_even_when_aggregate_count_is_unchanged(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        current_documents[0]["pokemon"][0]["speciesKey"] = "2:alternate"
        current_documents[0]["pokemon"][0]["dex"] = 2

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(any("Pokedex numbers disappeared" in error for error in report.errors))

    def test_pvp_league_collapse_is_rejected(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        for key in list(current_documents[1]["leagues"]["great"])[:8]:
            del current_documents[1]["leagues"]["great"][key]

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(any("PvP great lost" in error for error in report.errors))

    def test_equal_count_shadow_and_max_membership_swaps_are_rejected(self):
        baseline_documents = documents(100)
        for index, record in enumerate(baseline_documents[0]["pokemon"]):
            record["shadowEligible"] = index < 50
            record["maxCapable"] = index < 50
        current_documents = copy.deepcopy(baseline_documents)

        # Ten percent would allow five removals from either 50-member set. The
        # lower absolute caps must still reject these equal-count replacements.
        for record in current_documents[0]["pokemon"][:4]:
            record["shadowEligible"] = False
        for record in current_documents[0]["pokemon"][50:54]:
            record["shadowEligible"] = True

        for record in current_documents[0]["pokemon"][:3]:
            record["maxCapable"] = False
        for record in current_documents[0]["pokemon"][50:53]:
            record["maxCapable"] = True

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertEqual(
            len(snapshot(baseline_documents).shadow_keys),
            len(snapshot(current_documents).shadow_keys),
        )
        self.assertEqual(
            len(snapshot(baseline_documents).max_capable_keys),
            len(snapshot(current_documents).max_capable_keys),
        )
        self.assertTrue(any("Shadow eligibility lost" in error for error in report.errors))
        self.assertTrue(any("Max capability lost" in error for error in report.errors))

    def test_equal_count_pvp_membership_swap_is_rejected(self):
        baseline_documents = documents(50)
        for key in [f"{dex}:normal" for dex in range(41, 51)]:
            del baseline_documents[1]["leagues"]["great"][key]
        current_documents = copy.deepcopy(baseline_documents)
        # Ten percent permits four removals; the three-entry cap is stricter.
        for dex in range(1, 5):
            del current_documents[1]["leagues"]["great"][f"{dex}:normal"]
        for dex in range(41, 45):
            current_documents[1]["leagues"]["great"][f"{dex}:normal"] = {}

        baseline_snapshot = snapshot(baseline_documents)
        current_snapshot = snapshot(current_documents)
        report = compare_snapshots(
            baseline_snapshot, current_snapshot, TEST_LIMITS
        )
        self.assertEqual(
            len(baseline_snapshot.pvp_keys["great"]),
            len(current_snapshot.pvp_keys["great"]),
        )
        self.assertFalse(report.ok)
        self.assertTrue(any("PvP great lost" in error for error in report.errors))

    def test_mass_capability_and_move_mutations_are_rejected(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        for record in current_documents[0]["pokemon"][:8]:
            record["shadowEligible"] = False
            record["maxCapable"] = False
            record["moves"] = {"fast": [], "charged": []}

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        for label in ("Shadow eligibility", "Max capability", "Fast-move", "Charged-move"):
            self.assertTrue(any(label in error for error in report.errors), label)

    def test_mass_stat_and_type_mutations_are_rejected(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        for record in current_documents[0]["pokemon"][:5]:
            record["stats"]["attack"] += 50
            record["types"] = [{"id": "dragon"}]

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(
            any("Form identity/base stats/types changed" in error for error in report.errors)
        )

    def test_form_id_mutation_is_part_of_the_combat_fingerprint(self):
        baseline_documents = documents()
        for record in baseline_documents[0]["pokemon"]:
            record["formId"] = f"FORM_{record['dex']}"
        current_documents = copy.deepcopy(baseline_documents)
        for record in current_documents[0]["pokemon"][:5]:
            record["formId"] += "_REPLACED"

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(
            any("Form identity/base stats/types changed" in error for error in report.errors)
        )

    def test_mass_move_id_signature_replacement_is_rejected(self):
        baseline_documents = documents()
        current_documents = copy.deepcopy(baseline_documents)
        for record in current_documents[0]["pokemon"][:5]:
            record["moves"]["fast"][0]["id"] = "NEW_FAST_MOVE"
            record["moves"]["charged"][0]["id"] = "NEW_CHARGED_MOVE"

        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(current_documents), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(
            any("move ID signatures changed" in error for error in report.errors)
        )

    def test_move_signature_absolute_cap_applies_before_five_percent(self):
        baseline_documents = documents(1600)
        within_cap = copy.deepcopy(baseline_documents)
        for record in within_cap[0]["pokemon"][:75]:
            record["moves"]["fast"][0]["id"] = "UPDATED_FAST_MOVE"
        self.assertTrue(
            compare_snapshots(
                snapshot(baseline_documents), snapshot(within_cap), TEST_LIMITS
            ).ok
        )

        above_cap = copy.deepcopy(within_cap)
        above_cap[0]["pokemon"][75]["moves"]["fast"][0]["id"] = "UPDATED_FAST_MOVE"
        report = compare_snapshots(
            snapshot(baseline_documents), snapshot(above_cap), TEST_LIMITS
        )
        self.assertFalse(report.ok)
        self.assertTrue(
            any("at most 75" in error for error in report.errors), report.errors
        )

    def test_refresh_timestamps_are_not_substantive_but_source_identity_is(self):
        pokemon, pvp = documents()
        baseline = {
            "pokemon.json": {
                **pokemon,
                "generatedAt": "2026-08-01T00:00:00Z",
                "updated": "2026-08-01",
                "sources": {
                    "primary": {
                        "url": "https://example.test/pokemon.json",
                        "retrievedAt": "2026-08-01T00:00:00Z",
                        "sha256": "a" * 64,
                    }
                },
            },
            "pvp.json": {
                **pvp,
                "generatedAt": "2026-08-01T00:00:00Z",
                "updated": "2026-08-01",
                "sources": {
                    "primary": {
                        "url": "https://example.test/pvp.json",
                        "retrievedAt": "2026-08-01T00:00:00Z",
                        "sha256": "b" * 64,
                    }
                },
            },
        }
        refreshed = copy.deepcopy(baseline)
        for document in refreshed.values():
            document["generatedAt"] = "2026-09-01T00:00:00Z"
            document["updated"] = "2026-09-01"
            document["sources"]["primary"]["retrievedAt"] = "2026-09-01T00:00:00Z"

        self.assertFalse(documents_have_substantive_changes(baseline, refreshed))

        checksum_changed = copy.deepcopy(refreshed)
        checksum_changed["pokemon.json"]["sources"]["primary"]["sha256"] = "c" * 64
        self.assertTrue(documents_have_substantive_changes(baseline, checksum_changed))

        url_changed = copy.deepcopy(refreshed)
        url_changed["pvp.json"]["sources"]["primary"]["url"] = "https://new.example/pvp.json"
        self.assertTrue(documents_have_substantive_changes(baseline, url_changed))

    def test_directory_loader_accepts_repo_root_or_data_directory(self):
        pokemon, pvp = documents()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data"
            data.mkdir()
            (data / "pokemon.json").write_text(json.dumps(pokemon), encoding="utf-8")
            (data / "pvp.json").write_text(json.dumps(pvp), encoding="utf-8")

            from_root = load_snapshot_from_directory(root)
            from_data = load_snapshot_from_directory(data)
            self.assertEqual(from_root.dex_numbers, from_data.dex_numbers)
            self.assertEqual(from_root.pvp_keys, from_data.pvp_keys)


if __name__ == "__main__":
    unittest.main()
