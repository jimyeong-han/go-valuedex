#!/usr/bin/env python3
"""Validate generated datasets against their offline JSON data contracts."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError as exc:  # pragma: no cover - exercised only on an unprepared machine
    raise SystemExit(
        "jsonschema is required; run: python3 -m pip install -r requirements-dev.txt"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
DATASETS = {
    "pokemon": (ROOT / "data/pokemon.json", ROOT / "schemas/pokemon.schema.json"),
    "pvp": (ROOT / "data/pvp.json", ROOT / "schemas/pvp.schema.json"),
}
BASE_POKEMON_SOURCES = {"pokemonGoApi", "pvpokeGameMaster", "serebiiMaxBattles"}
POKEMINERS_SOURCE = "pokeMinersGameMaster"
PVP_LEAGUE_SOURCES = {
    "great": "pvpokeGreatLeague",
    "ultra": "pvpokeUltraLeague",
    "master": "pvpokeMasterLeague",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def nested_refs(value: Any) -> Iterable[str]:
    """Yield every JSON Schema reference without resolving it."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str):
                yield item
            else:
                yield from nested_refs(item)
    elif isinstance(value, list):
        for item in value:
            yield from nested_refs(item)


def assert_offline_schema(schema: dict[str, Any], label: str = "schema") -> None:
    """Reject remote $refs so validation never depends on the network."""
    remote_refs = [ref for ref in nested_refs(schema) if not ref.startswith("#")]
    if remote_refs:
        raise ValueError(f"{label} contains remote $ref values: {remote_refs}")


def error_path(error) -> str:
    path = "$"
    for part in error.absolute_path:
        path += f"[{part}]" if isinstance(part, int) else f".{part}"
    return path


def schema_errors(document: Any, schema: dict[str, Any], label: str) -> list[str]:
    assert_offline_schema(schema, label)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [
        f"{label} {error_path(error)}: {error.message}"
        for error in sorted(
            validator.iter_errors(document),
            key=lambda item: tuple(str(part) for part in item.absolute_path),
        )
    ]


def parse_rfc3339(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("timezone offset is required")
    return parsed


def timestamp_errors(document: dict[str, Any], label: str) -> list[str]:
    errors = []
    try:
        generated_at = parse_rfc3339(document["generatedAt"])
    except (KeyError, TypeError, ValueError) as exc:
        return [f"{label}: generatedAt is not RFC 3339 ({exc})"]
    sources = document.get("sources")
    if not isinstance(sources, dict):
        return errors
    for source_id, source in sources.items():
        try:
            retrieved_at = parse_rfc3339(source["retrievedAt"])
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"{label}: source {source_id} has invalid retrievedAt ({exc})")
            continue
        if retrieved_at > generated_at:
            errors.append(f"{label}: source {source_id} was retrieved after generatedAt")
    return errors


def source_ref_errors(document: dict[str, Any], kind: str) -> list[str]:
    sources = document.get("sources")
    if not isinstance(sources, dict):
        return []
    known_sources = set(sources)
    errors = []
    if kind == "pokemon":
        seen_species = set()
        for index, record in enumerate(document.get("pokemon") or []):
            if not isinstance(record, dict):
                continue
            species_key = record.get("speciesKey", f"index {index}")
            if species_key in seen_species:
                errors.append(f"pokemon: duplicate speciesKey {species_key}")
            seen_species.add(species_key)
            refs = set(record.get("sourceRefs") or [])
            unknown = refs - known_sources
            if unknown:
                errors.append(f"pokemon {species_key}: unknown sourceRefs {sorted(unknown)}")
            missing = BASE_POKEMON_SOURCES - refs
            if missing:
                errors.append(f"pokemon {species_key}: missing sourceRefs {sorted(missing)}")
            has_shadow = isinstance(record.get("shadow"), dict)
            has_special_move = any(
                isinstance(move, dict)
                and isinstance(move.get("access"), dict)
                and move["access"].get("tmLearnability") == "none"
                for pool in (record.get("moves") or {}).values()
                for move in (pool or [])
            )
            if (has_shadow or has_special_move) != (POKEMINERS_SOURCE in refs):
                errors.append(
                    f"pokemon {species_key}: pokeMinersGameMaster must be referenced exactly when derived move or shadow data exists"
                )
            if record.get("shadowEligible") != has_shadow:
                errors.append(f"pokemon {species_key}: shadowEligible and shadow disagree")
            for pool_name, pool in (record.get("moves") or {}).items():
                for move in pool or []:
                    if not isinstance(move, dict):
                        continue
                    move_id = move.get("id", "unknown move")
                    access = move.get("access")
                    if move.get("elite") and not isinstance(access, dict):
                        errors.append(
                            f"pokemon {species_key} {pool_name}/{move_id}: elite move is missing access metadata"
                        )
                        continue
                    if not isinstance(access, dict):
                        continue
                    kind_value = access.get("kind")
                    learnability = access.get("tmLearnability")
                    if kind_value == "elite_tm":
                        if not move.get("elite") or learnability != "elite_only":
                            errors.append(
                                f"pokemon {species_key} {pool_name}/{move_id}: elite_tm must be elite_only"
                            )
                    elif move.get("elite") or learnability != "none":
                        errors.append(
                            f"pokemon {species_key} {pool_name}/{move_id}: non-Elite access must be TM-ineligible"
                        )
                    if learnability == "none" and not str(access.get("source") or "").startswith("https://"):
                        errors.append(
                            f"pokemon {species_key} {pool_name}/{move_id}: TM-ineligible access requires an HTTPS source"
                        )
    elif kind == "pvp":
        for league, rankings in (document.get("leagues") or {}).items():
            expected = PVP_LEAGUE_SOURCES.get(league)
            if not isinstance(rankings, dict):
                continue
            for species_key, record in rankings.items():
                if not isinstance(record, dict):
                    continue
                refs = set(record.get("sourceRefs") or [])
                unknown = refs - known_sources
                if unknown:
                    errors.append(f"pvp {league}/{species_key}: unknown sourceRefs {sorted(unknown)}")
                required = {"pvpokeGameMaster", expected} if expected else {"pvpokeGameMaster"}
                missing = required - refs
                if missing:
                    errors.append(f"pvp {league}/{species_key}: missing sourceRefs {sorted(missing)}")
                unrelated = (set(PVP_LEAGUE_SOURCES.values()) - {expected}) & refs
                if unrelated:
                    errors.append(
                        f"pvp {league}/{species_key}: unrelated league sourceRefs {sorted(unrelated)}"
                    )
    return errors


def validate_document(
    kind: str,
    document: dict[str, Any],
    schema: dict[str, Any],
) -> list[str]:
    if kind not in DATASETS:
        raise ValueError(f"Unknown dataset kind: {kind}")
    return [
        *schema_errors(document, schema, kind),
        *timestamp_errors(document, kind),
        *source_ref_errors(document, kind),
    ]


def validate_all() -> tuple[list[str], dict[str, dict[str, Any]]]:
    errors = []
    documents = {}
    for kind, (data_path, schema_path) in DATASETS.items():
        document = read_json(data_path)
        schema = read_json(schema_path)
        documents[kind] = document
        errors.extend(validate_document(kind, document, schema))
    pokemon = documents.get("pokemon", {})
    pvp = documents.get("pvp", {})
    if pokemon.get("schemaVersion") != pvp.get("schemaVersion"):
        errors.append("datasets: schemaVersion values do not match")
    if pokemon.get("generatedAt") != pvp.get("generatedAt"):
        errors.append("datasets: generatedAt values do not identify one build snapshot")
    return errors, documents


def main() -> int:
    errors, documents = validate_all()
    if errors:
        print("JSON data contract validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(
        "Validated JSON data contracts offline: "
        f"{len(documents['pokemon']['pokemon'])} Pokémon forms, "
        f"{sum(len(values) for values in documents['pvp']['leagues'].values())} PvP rankings"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
