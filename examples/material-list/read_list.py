#!/usr/bin/env python3
"""Read and validate an ordinary Cairn material-list snapshot offline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from typing import Any

FORMAT = "cairn.material-list.v1"
MAX_ITEMS = 200
MAX_JSON_BYTES = 512 * 1024
MAX_GUIDE_BYTES = 64 * 1024
MAX_TITLE_CHARS = 160
MAX_LABEL_CHARS = 512
MAX_CONTEXT_KEYS = 32
MAX_CONTEXT_VALUE_BYTES = 16 * 1024
CONTENT_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
CHUNK_SIZE = 1024 * 1024


class InvalidList(ValueError):
    """The supplied document is malformed or outside the format limits."""


def _safe_integer(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return False
    return 0 <= value <= 9007199254740991


def _object(value: Any, allowed: set[str], required: set[str], where: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not required.issubset(value) or not set(value).issubset(allowed):
        raise InvalidList(f"{where} has invalid fields.")
    return value


def _text(value: Any, where: str) -> str:
    if not isinstance(value, str):
        raise InvalidList(f"{where} must be text.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise InvalidList(f"{where} contains invalid Unicode.") from exc
    return value


def _ref(value: Any, where: str) -> dict[str, Any]:
    ref = _object(value, {"content_id", "logical_size", "entry_id", "subject_ref"}, {"content_id", "logical_size"}, where)
    if not isinstance(ref["content_id"], str) or not CONTENT_ID.fullmatch(ref["content_id"]):
        raise InvalidList(f"{where} has an invalid content_id.")
    size = ref["logical_size"]
    if not _safe_integer(size):
        raise InvalidList(f"{where} has an invalid logical_size.")
    for hint in ("entry_id", "subject_ref"):
        if hint in ref and (not isinstance(ref[hint], str) or not ref[hint].strip()):
            raise InvalidList(f"{where} has an invalid {hint}.")
    return ref


def _validate(document: Any) -> dict[str, Any]:
    doc = _object(document, {"format", "title", "guide", "items"}, {"format", "title", "items"}, "The material list")
    if doc["format"] != FORMAT:
        raise InvalidList("The material list format is unsupported.")
    title = _text(doc["title"], "The title")
    if not title.strip() or len(title) > MAX_TITLE_CHARS:
        raise InvalidList("The title is empty or too long.")
    items = doc["items"]
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise InvalidList("The material list has too many items or an invalid items field.")
    for index, raw_item in enumerate(items, 1):
        item = _object(raw_item, {"ref", "label", "context"}, {"ref", "label"}, f"Item {index}")
        _ref(item["ref"], f"Item {index} ref")
        label = _text(item["label"], f"Item {index} label")
        if len(label) > MAX_LABEL_CHARS:
            raise InvalidList(f"Item {index} label is too long.")
        if "context" in item:
            context = item["context"]
            if not isinstance(context, dict) or len(context) > MAX_CONTEXT_KEYS:
                raise InvalidList(f"Item {index} context is invalid or has too many keys.")
            for key, text in context.items():
                if not isinstance(key, str) or not key.strip():
                    raise InvalidList(f"Item {index} context has an invalid key.")
                value = _text(text, f"Item {index} context value")
                if len(value.encode("utf-8")) > MAX_CONTEXT_VALUE_BYTES:
                    raise InvalidList(f"Item {index} context value is too long.")
    if "guide" in doc:
        guide = _object(doc["guide"], {"name", "body", "content_id", "logical_size", "source"},
                        {"name", "body", "content_id", "logical_size"}, "The guide")
        name = _text(guide["name"], "The guide name")
        body = _text(guide["body"], "The guide body")
        if not name.strip() or len(body.encode("utf-8")) > MAX_GUIDE_BYTES:
            raise InvalidList("The guide name is empty or its text is too long.")
        digest = guide["content_id"]
        size = guide["logical_size"]
        body_bytes = body.encode("utf-8")
        if (not isinstance(digest, str) or not CONTENT_ID.fullmatch(digest)
                or not _safe_integer(size)
                or digest != "sha256:" + hashlib.sha256(body_bytes).hexdigest()
                or size != len(body_bytes)):
            raise InvalidList("The guide identity does not match its embedded text.")
        if "source" in guide:
            source = _ref(guide["source"], "The guide source")
            if source["content_id"] != digest or source["logical_size"] != size:
                raise InvalidList("The guide source identity does not match its embedded text.")
    return doc


def _reject_constant(value: str) -> None:
    raise InvalidList(f"Invalid JSON number: {value}.")


def _load_document(list_path: str) -> dict[str, Any]:
    try:
        with open(list_path, "rb") as source:
            raw = source.read(MAX_JSON_BYTES + 1)
    except (OSError, ValueError) as exc:
        raise InvalidList(f"Cannot read list file: {getattr(exc, 'strerror', None) or exc}.") from exc
    if len(raw) > MAX_JSON_BYTES:
        raise InvalidList("The material list exceeds the 512 KiB limit.")
    try:
        text = raw.decode("utf-8-sig")
        document = json.loads(text, parse_constant=_reject_constant)
    except InvalidList:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise InvalidList("The material list is not valid UTF-8 JSON.") from exc
    return _validate(document)


def _hash_original(path: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    if not stat.S_ISREG(os.stat(path).st_mode):
        raise OSError("not a regular file")
    with open(path, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise OSError("not a regular file")
        while True:
            chunk = source.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
        after = os.fstat(source.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
    ):
        raise OSError("file changed while it was being read")
    if size != after.st_size:
        raise OSError("file length changed while it was being read")
    return "sha256:" + digest.hexdigest(), size


def _build_report(document: dict[str, Any], originals: list[str]) -> dict[str, Any]:
    identities: dict[tuple[str, int], str] = {}
    diagnostics: list[dict[str, str]] = []
    for path in originals:
        try:
            identity = _hash_original(path)
        except (OSError, ValueError) as exc:
            diagnostics.append({"path": path, "reason": str(exc)})
            continue
        identities.setdefault(identity, path)

    occurrences = []
    for position, item in enumerate(document["items"], 1):
        ref = item["ref"]
        match = identities.get((ref["content_id"], ref["logical_size"]))
        occurrence = {"position": position, **item, "state": "AVAILABLE" if match is not None else "UNAVAILABLE"}
        if match is not None:
            occurrence["path"] = match
        occurrences.append(occurrence)
    report: dict[str, Any] = {"document": document, "occurrences": occurrences}
    if diagnostics:
        report["local_read_diagnostics"] = diagnostics
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate and read an ordinary Cairn material-list JSON file.")
    parser.add_argument("list", metavar="LIST", help="path to a .cairn-list.json file")
    parser.add_argument("--original", metavar="FILE", action="append", default=[],
                        help="explicit local original to verify; may be supplied more than once")
    args = parser.parse_args(argv)
    try:
        document = _load_document(args.list)
    except InvalidList as exc:
        print(str(exc), file=sys.stderr)
        return 2
    report = _build_report(document, args.original)
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
