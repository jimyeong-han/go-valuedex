#!/usr/bin/env python3
"""Reject suspicious bulk changes in generated GO ValueDex snapshots.

The structural validator answers "is this snapshot internally valid?".  This
guard answers the separate question "did an upstream change unexpectedly erase
or rewrite a meaningful part of the previously accepted snapshot?".

Examples:
    python3 scripts/check_data_diff.py --baseline-ref origin/main
    python3 scripts/check_data_diff.py --baseline-dir /tmp/known-good/data
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = ("pokemon.json", "pvp.json")
LEAGUES = ("great", "ultra", "master")


@dataclass(frozen=True)
class Limits:
    """Explicit loss limits. Changes above these values require human review."""

    min_forms: int = 1150
    min_dex_numbers: int = 1000
    min_pvp_entries_per_league: int = 100
    form_drop_ratio: float = 0.015
    form_drop_floor: int = 5
    removed_form_ratio: float = 0.01
    removed_form_floor: int = 5
    shadow_drop_ratio: float = 0.05
    shadow_drop_floor: int = 3
    shadow_removal_cap: int = 30
    max_capable_drop_ratio: float = 0.10
    max_capable_drop_floor: int = 2
    max_capable_removal_cap: int = 15
    move_coverage_drop_ratio: float = 0.02
    move_coverage_drop_floor: int = 3
    pvp_drop_ratio: float = 0.10
    pvp_drop_floor: int = 5
    pvp_removal_cap: int = 75
    fingerprint_change_ratio: float = 0.005
    fingerprint_change_floor: int = 5
    move_signature_change_ratio: float = 0.05
    move_signature_change_cap: int = 75


DEFAULT_LIMITS = Limits()


@dataclass(frozen=True)
class Snapshot:
    pokemon: Mapping[str, Mapping[str, Any]]
    dex_numbers: frozenset[int]
    shadow_keys: frozenset[str]
    max_capable_keys: frozenset[str]
    fast_move_keys: frozenset[str]
    charged_move_keys: frozenset[str]
    pvp_keys: Mapping[str, frozenset[str]]

    @classmethod
    def from_documents(
        cls,
        pokemon_document: Mapping[str, Any],
        pvp_document: Mapping[str, Any],
    ) -> "Snapshot":
        records = pokemon_document.get("pokemon")
        leagues = pvp_document.get("leagues")
        if not isinstance(records, list):
            raise ValueError("pokemon.json must contain a 'pokemon' array")
        if not isinstance(leagues, dict):
            raise ValueError("pvp.json must contain a 'leagues' object")

        by_key: dict[str, Mapping[str, Any]] = {}
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get("speciesKey"), str):
                raise ValueError("every Pokemon record must have a string speciesKey")
            key = record["speciesKey"]
            if key in by_key:
                raise ValueError(f"duplicate speciesKey: {key}")
            by_key[key] = record

        pvp_keys: dict[str, frozenset[str]] = {}
        for league in LEAGUES:
            values = leagues.get(league)
            if not isinstance(values, dict):
                raise ValueError(f"pvp.json league '{league}' must be an object")
            pvp_keys[league] = frozenset(values)

        return cls(
            pokemon=by_key,
            dex_numbers=frozenset(int(record["dex"]) for record in records),
            shadow_keys=frozenset(
                key for key, record in by_key.items() if record.get("shadowEligible")
            ),
            max_capable_keys=frozenset(
                key for key, record in by_key.items() if record.get("maxCapable")
            ),
            fast_move_keys=frozenset(
                key
                for key, record in by_key.items()
                if ((record.get("moves") or {}).get("fast") or [])
            ),
            charged_move_keys=frozenset(
                key
                for key, record in by_key.items()
                if ((record.get("moves") or {}).get("charged") or [])
            ),
            pvp_keys=pvp_keys,
        )


@dataclass(frozen=True)
class Report:
    summary: tuple[str, ...]
    warnings: tuple[str, ...]
    errors: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.errors


def allowed_drop(baseline_count: int, ratio: float, floor: int) -> int:
    return max(floor, math.ceil(baseline_count * ratio))


def _fingerprint(record: Mapping[str, Any]) -> tuple[Any, ...]:
    stats = record.get("stats") or {}
    types = tuple(sorted(value.get("id") for value in (record.get("types") or [])))
    return (
        record.get("formId"),
        stats.get("attack"),
        stats.get("defense"),
        stats.get("stamina"),
        types,
    )


def _move_signature(record: Mapping[str, Any]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    moves = record.get("moves") or {}

    def ids(kind: str) -> tuple[str, ...]:
        return tuple(
            sorted({
                value["id"]
                for value in (moves.get(kind) or [])
                if isinstance(value, dict) and isinstance(value.get("id"), str)
            })
        )

    return ids("fast"), ids("charged")


def compare_snapshots(
    baseline: Snapshot,
    current: Snapshot,
    limits: Limits = DEFAULT_LIMITS,
) -> Report:
    errors: list[str] = []
    warnings: list[str] = []
    summary: list[str] = []

    def add_count(label: str, old: int, new: int) -> None:
        summary.append(f"{label}: {old} -> {new} ({new - old:+d})")

    baseline_keys = frozenset(baseline.pokemon)
    current_keys = frozenset(current.pokemon)
    removed_keys = baseline_keys - current_keys
    added_keys = current_keys - baseline_keys
    lost_dex = baseline.dex_numbers - current.dex_numbers

    add_count("Pokemon forms", len(baseline_keys), len(current_keys))
    add_count("Pokedex numbers", len(baseline.dex_numbers), len(current.dex_numbers))
    add_count("Shadow-eligible forms", len(baseline.shadow_keys), len(current.shadow_keys))
    add_count("Max-capable forms", len(baseline.max_capable_keys), len(current.max_capable_keys))
    add_count("Forms with fast moves", len(baseline.fast_move_keys), len(current.fast_move_keys))
    add_count("Forms with charged moves", len(baseline.charged_move_keys), len(current.charged_move_keys))
    for league in LEAGUES:
        add_count(
            f"PvP {league}",
            len(baseline.pvp_keys[league]),
            len(current.pvp_keys[league]),
        )

    if len(current_keys) < limits.min_forms:
        errors.append(
            f"Pokemon form count {len(current_keys)} is below the absolute floor "
            f"of {limits.min_forms}."
        )
    if len(current.dex_numbers) < limits.min_dex_numbers:
        errors.append(
            f"Pokedex coverage {len(current.dex_numbers)} is below the absolute floor "
            f"of {limits.min_dex_numbers}."
        )
    for league in LEAGUES:
        count = len(current.pvp_keys[league])
        if count < limits.min_pvp_entries_per_league:
            errors.append(
                f"PvP {league} contains {count} entries; the absolute floor is "
                f"{limits.min_pvp_entries_per_league}."
            )

    form_drop = max(0, len(baseline_keys) - len(current_keys))
    form_drop_limit = allowed_drop(
        len(baseline_keys), limits.form_drop_ratio, limits.form_drop_floor
    )
    if form_drop > form_drop_limit:
        errors.append(
            f"Pokemon form count fell by {form_drop}; at most {form_drop_limit} "
            f"({limits.form_drop_ratio:.1%}, floor {limits.form_drop_floor}) is allowed."
        )

    removed_limit = allowed_drop(
        len(baseline_keys), limits.removed_form_ratio, limits.removed_form_floor
    )
    if len(removed_keys) > removed_limit:
        sample = ", ".join(sorted(removed_keys)[:8])
        errors.append(
            f"{len(removed_keys)} existing speciesKey values disappeared; at most "
            f"{removed_limit} ({limits.removed_form_ratio:.1%}, floor "
            f"{limits.removed_form_floor}) is allowed. Sample: {sample}"
        )
    elif removed_keys:
        warnings.append(
            f"Removed {len(removed_keys)} form(s): "
            + ", ".join(sorted(removed_keys)[:12])
        )
    if added_keys:
        warnings.append(
            f"Added {len(added_keys)} form(s): " + ", ".join(sorted(added_keys)[:12])
        )

    # A Pokédex number should never disappear, even if another new number keeps
    # the aggregate count unchanged.
    if lost_dex:
        errors.append(
            f"Pokedex numbers disappeared ({len(lost_dex)}): "
            + ", ".join(f"#{value}" for value in sorted(lost_dex)[:20])
        )

    def check_coverage(
        label: str,
        old_values: frozenset[str],
        new_values: frozenset[str],
        ratio: float,
        floor: int,
        absolute_cap: int | None = None,
    ) -> None:
        removed = old_values - new_values
        removed_count = len(removed)
        limit = allowed_drop(len(old_values), ratio, floor)
        if absolute_cap is not None:
            limit = min(limit, absolute_cap)
        if removed_count > limit:
            errors.append(
                f"{label} lost {removed_count} existing form(s); at most {limit} "
                f"({ratio:.1%}, floor {floor}"
                + (f", absolute cap {absolute_cap}" if absolute_cap is not None else "")
                + ") is allowed. Sample: "
                + ", ".join(sorted(removed)[:8])
            )
        elif removed_count:
            warnings.append(
                f"{label} lost {removed_count} existing form(s) (guard limit {limit}): "
                + ", ".join(sorted(removed)[:8])
            )

    check_coverage(
        "Shadow eligibility",
        baseline.shadow_keys,
        current.shadow_keys,
        limits.shadow_drop_ratio,
        limits.shadow_drop_floor,
        limits.shadow_removal_cap,
    )
    check_coverage(
        "Max capability",
        baseline.max_capable_keys,
        current.max_capable_keys,
        limits.max_capable_drop_ratio,
        limits.max_capable_drop_floor,
        limits.max_capable_removal_cap,
    )
    check_coverage(
        "Fast-move",
        baseline.fast_move_keys,
        current.fast_move_keys,
        limits.move_coverage_drop_ratio,
        limits.move_coverage_drop_floor,
    )
    check_coverage(
        "Charged-move",
        baseline.charged_move_keys,
        current.charged_move_keys,
        limits.move_coverage_drop_ratio,
        limits.move_coverage_drop_floor,
    )
    for league in LEAGUES:
        check_coverage(
            f"PvP {league}",
            baseline.pvp_keys[league],
            current.pvp_keys[league],
            limits.pvp_drop_ratio,
            limits.pvp_drop_floor,
            limits.pvp_removal_cap,
        )

    common_keys = baseline_keys & current_keys
    changed_fingerprints = sorted(
        key
        for key in common_keys
        if _fingerprint(baseline.pokemon[key]) != _fingerprint(current.pokemon[key])
    )
    fingerprint_limit = allowed_drop(
        len(common_keys),
        limits.fingerprint_change_ratio,
        limits.fingerprint_change_floor,
    )
    if len(changed_fingerprints) > fingerprint_limit:
        errors.append(
            f"Form identity/base stats/types changed for {len(changed_fingerprints)} existing forms; "
            f"at most {fingerprint_limit} ({limits.fingerprint_change_ratio:.1%}, "
            f"floor {limits.fingerprint_change_floor}) is allowed. Sample: "
            + ", ".join(changed_fingerprints[:8])
        )
    elif changed_fingerprints:
        warnings.append(
            f"Form identity/base stats/types changed for {len(changed_fingerprints)} form(s): "
            + ", ".join(changed_fingerprints[:12])
        )

    changed_move_signatures = sorted(
        key
        for key in common_keys
        if _move_signature(baseline.pokemon[key]) != _move_signature(current.pokemon[key])
    )
    move_signature_limit = min(
        limits.move_signature_change_cap,
        math.floor(len(common_keys) * limits.move_signature_change_ratio),
    ) if common_keys else 0
    if len(changed_move_signatures) > move_signature_limit:
        errors.append(
            f"Fast/charged move ID signatures changed for {len(changed_move_signatures)} "
            f"existing forms; at most {move_signature_limit} is allowed before either "
            f"{limits.move_signature_change_ratio:.0%} or the "
            f"{limits.move_signature_change_cap}-form cap is exceeded. Sample: "
            + ", ".join(changed_move_signatures[:8])
        )
    elif changed_move_signatures:
        warnings.append(
            f"Fast/charged move ID signatures changed for "
            f"{len(changed_move_signatures)} form(s): "
            + ", ".join(changed_move_signatures[:12])
        )

    return Report(tuple(summary), tuple(warnings), tuple(errors))


def _read_json(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"missing data file: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid JSON in {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"top level of {path} must be an object")
    return value


def load_documents_from_directory(directory: Path) -> dict[str, Mapping[str, Any]]:
    directory = directory.resolve()
    data_dir = directory / "data" if (directory / "data").is_dir() else directory
    return {filename: _read_json(data_dir / filename) for filename in DATA_FILES}


def load_snapshot_from_directory(directory: Path) -> Snapshot:
    documents = load_documents_from_directory(directory)
    return Snapshot.from_documents(documents["pokemon.json"], documents["pvp.json"])


def _git_output(repo_root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise ValueError(f"git {' '.join(arguments)} failed: {detail}")
    return result.stdout


def load_documents_from_git(
    repo_root: Path, reference: str
) -> tuple[dict[str, Mapping[str, Any]], str]:
    if not reference or reference.startswith("-"):
        raise ValueError("baseline ref must be a non-option Git reference")
    resolved = _git_output(
        repo_root, "rev-parse", "--verify", "--end-of-options", f"{reference}^{{commit}}"
    ).strip()

    documents: dict[str, Mapping[str, Any]] = {}
    for filename in DATA_FILES:
        raw = _git_output(repo_root, "show", f"{resolved}:data/{filename}")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError(
                f"invalid JSON in {reference}:data/{filename}: {error}"
            ) from error
        if not isinstance(value, dict):
            raise ValueError(f"top level of {reference}:data/{filename} must be an object")
        documents[filename] = value

    return documents, resolved


def load_snapshot_from_git(repo_root: Path, reference: str) -> tuple[Snapshot, str]:
    documents, resolved = load_documents_from_git(repo_root, reference)
    return (
        Snapshot.from_documents(documents["pokemon.json"], documents["pvp.json"]),
        resolved,
    )


def normalized_substantive_document(document: Mapping[str, Any]) -> Mapping[str, Any]:
    """Remove refresh timestamps while preserving source identity and checksums."""

    normalized = copy.deepcopy(document)
    normalized.pop("generatedAt", None)
    normalized.pop("updated", None)
    sources = normalized.get("sources")
    if isinstance(sources, dict):
        for source in sources.values():
            if isinstance(source, dict):
                source.pop("retrievedAt", None)
    return normalized


def documents_have_substantive_changes(
    baseline: Mapping[str, Mapping[str, Any]],
    current: Mapping[str, Mapping[str, Any]],
) -> bool:
    """Return true unless the only differences are known refresh timestamps."""

    return any(
        normalized_substantive_document(baseline[filename])
        != normalized_substantive_document(current[filename])
        for filename in DATA_FILES
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    baseline = parser.add_mutually_exclusive_group()
    baseline.add_argument(
        "--baseline-ref",
        help="known-good Git ref/commit (default: HEAD^)",
    )
    baseline.add_argument(
        "--baseline-dir",
        type=Path,
        help="directory containing pokemon.json/pvp.json, or its repository root",
    )
    parser.add_argument(
        "--current-dir",
        type=Path,
        default=ROOT / "data",
        help="current data directory (default: repository data/)",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=ROOT,
        help="repository used to resolve --baseline-ref",
    )
    parser.add_argument(
        "--substantive-status",
        action="store_true",
        help=(
            "print only true/false after ignoring generatedAt, updated, and "
            "sources.*.retrievedAt; source URL/SHA and all payload data remain significant"
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        current_documents = load_documents_from_directory(args.current_dir)
        if args.baseline_dir:
            baseline_documents = load_documents_from_directory(args.baseline_dir)
            baseline_label = str(args.baseline_dir.resolve())
        else:
            reference = args.baseline_ref or "HEAD^"
            baseline_documents, resolved = load_documents_from_git(
                args.repo_root.resolve(), reference
            )
            baseline_label = f"{reference} ({resolved[:12]})"
        if args.substantive_status:
            changed = documents_have_substantive_changes(
                baseline_documents, current_documents
            )
            print("true" if changed else "false")
            return 0
        current = Snapshot.from_documents(
            current_documents["pokemon.json"], current_documents["pvp.json"]
        )
        baseline = Snapshot.from_documents(
            baseline_documents["pokemon.json"], baseline_documents["pvp.json"]
        )
        report = compare_snapshots(baseline, current)
    except ValueError as error:
        print(f"Data diff guard configuration error: {error}", file=sys.stderr)
        return 2

    print(f"Data diff baseline: {baseline_label}")
    print("Guard thresholds: forms -1.5%, removed keys -1%, Shadow removals 5%/30, "
          "Max removals 10%/15, move coverage removals 2%, PvP removals 10%/75, stats/types 0.5%, "
          "move-ID signatures 5%/75 forms; no Pokédex number may disappear.")
    for line in report.summary:
        print(f"  {line}")
    for warning in report.warnings:
        print(f"WARNING: {warning}")
    if report.errors:
        for error in report.errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(
            "Data diff guard failed. Inspect the upstream change and adjust the "
            "snapshot or reviewed limits explicitly.",
            file=sys.stderr,
        )
        return 1
    print("Data diff guard passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
