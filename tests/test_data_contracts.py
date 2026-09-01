"""Offline contract and mutation regressions for generated JSON datasets."""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from unittest import mock

from scripts.update_data import apply_special_move_overlays
from scripts.validate_schema import assert_offline_schema, validate_document


ROOT = Path(__file__).resolve().parents[1]


def load(relative_path: str):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


class DataContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.documents = {
            "pokemon": load("data/pokemon.json"),
            "pvp": load("data/pvp.json"),
        }
        cls.schemas = {
            "pokemon": load("schemas/pokemon.schema.json"),
            "pvp": load("schemas/pvp.schema.json"),
        }

    def errors_for(self, kind: str, mutate=None):
        document = copy.deepcopy(self.documents[kind])
        if mutate:
            mutate(document)
        return validate_document(kind, document, self.schemas[kind])

    def assert_rejected(self, kind: str, mutate, expected: str):
        errors = self.errors_for(kind, mutate)
        self.assertTrue(errors, "mutated data unexpectedly passed the contract")
        self.assertTrue(
            any(expected in error for error in errors),
            f"expected {expected!r} in errors: {errors[:5]}",
        )

    def test_current_datasets_validate_without_network(self):
        for kind, schema in self.schemas.items():
            assert_offline_schema(schema, kind)
            with mock.patch(
                "socket.create_connection",
                side_effect=AssertionError("schema validation attempted network access"),
            ):
                self.assertEqual(self.errors_for(kind), [], kind)

    def test_rejects_schema_version_mutation(self):
        self.assert_rejected(
            "pokemon",
            lambda document: document.__setitem__("schemaVersion", 2),
            "1 was expected",
        )

    def test_rejects_generated_at_without_timezone(self):
        self.assert_rejected(
            "pokemon",
            lambda document: document.__setitem__("generatedAt", "2026-09-01T12:00:00"),
            "generatedAt",
        )

    def test_rejects_invalid_source_digest(self):
        def mutate(document):
            document["sources"]["pokemonGoApi"]["sha256"] = "not-a-sha256"

        self.assert_rejected("pokemon", mutate, "does not match")

    def test_rejects_unknown_record_source_reference(self):
        def mutate(document):
            document["pokemon"][0]["sourceRefs"].append("unknownSource")

        self.assert_rejected("pokemon", mutate, "unknownSource")

    def test_rejects_incomplete_shadow_shape(self):
        def mutate(document):
            apex = next(
                record["shadow"]["apex"]
                for record in document["pokemon"]
                if record.get("shadow") and record["shadow"].get("apex")
            )
            del apex["purifiedMove"]

        self.assert_rejected("pokemon", mutate, "purifiedMove")

    def test_rejects_shadow_provenance_mismatch(self):
        def mutate(document):
            shadow = next(record for record in document["pokemon"] if record.get("shadow"))
            shadow["sourceRefs"].remove("pokeMinersGameMaster")

        self.assert_rejected("pokemon", mutate, "pokeMinersGameMaster")

    def test_rejects_non_tm_move_without_official_source(self):
        def mutate(document):
            record = next(
                record for record in document["pokemon"]
                if record["speciesKey"] == "384:normal"
            )
            move = next(
                move for move in record["moves"]["charged"]
                if move["id"] == "DRAGON_ASCENT"
            )
            del move["access"]["source"]

        self.assert_rejected("pokemon", mutate, "requires an HTTPS source")

    def test_rejects_non_tm_move_mislabeled_as_elite_tm(self):
        def mutate(document):
            record = next(
                record for record in document["pokemon"]
                if record["speciesKey"] == "483:origin"
            )
            move = next(
                move for move in record["moves"]["charged"]
                if move["id"] == "ROAR_OF_TIME"
            )
            move["access"]["kind"] = "elite_tm"

        self.assert_rejected("pokemon", mutate, "elite_tm must be elite_only")

    def test_rejects_cross_league_provenance(self):
        def mutate(document):
            ranking = next(iter(document["leagues"]["great"].values()))
            ranking["sourceRefs"] = ["pvpokeGameMaster", "pvpokeUltraLeague"]

        self.assert_rejected("pvp", mutate, "unrelated league sourceRefs")

    def test_rejects_undeclared_record_field(self):
        def mutate(document):
            document["pokemon"][0]["accidentalField"] = True

        self.assert_rejected("pokemon", mutate, "Additional properties are not allowed")

    def test_special_move_overlay_stops_when_upstream_adds_the_move(self):
        pokemon = [{
            "speciesKey": "384:normal",
            "moves": {"fast": [], "charged": [{"id": "DRAGON_ASCENT"}]},
            "sourceRefs": [],
        }]
        with self.assertRaisesRegex(RuntimeError, "now present in the upstream move pool"):
            apply_special_move_overlays(pokemon, [])


if __name__ == "__main__":
    unittest.main()
