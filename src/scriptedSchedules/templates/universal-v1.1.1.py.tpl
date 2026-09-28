#!/usr/bin/env python3
"""
ErsatzTV Legacy v26.10.0 - Scripted Schedule Universal / Modular

Este arquivo e um modelo para montar programacoes diferentes sem precisar criar um script
novo para cada canal. Voce configura apenas os modulos que quiser usar e deixa os outros
vazios.

MODULOS DISPONIVEIS
-------------------
1. ROTATION
   Rotacao continua entre fontes de conteudo.

2. FIXED_EVENTS
   Em um horario, toca uma quantidade definida de itens.

3. FIXED_DURATION_EVENTS
   Em um horario, toca uma fonte por um tempo definido. Se for interrompido por prioridade
   maior, depois continua apenas pelo tempo que faltou.

4. FIXED_ALL_EVENTS
   Em um horario, toca todos os itens de uma fonte. Depois que comeca, termina antes de
   liberar outro modulo.

5. FIXED_WINDOW_EVENTS
   Toca uma fonte somente dentro de uma faixa de horario.

6. WINDOW_ROTATIONS
   Faz uma rotacao propria dentro de uma faixa de horario.

7. SEQUENCE_EVENTS
   Executa varios passos em sequencia, como vinheta -> programa -> intervalo.

8. INTERVAL_EVENTS
   Repete um evento a cada X minutos.

9. DATE_EVENTS
   Executa um evento em uma data e hora especificas.

10. OFFLINE_WINDOWS
    Reserva uma faixa de horario sem programacao.

11. FILLER
    Preenche buracos quando nao existe outro conteudo programado.

REGRAS IMPORTANTES
------------------
- Nenhum modulo e obrigatorio.
- Prioridade maior significa maior peso.
- Em empate, quem ja esta tocando continua.
- Por padrao, nenhum video e cortado no meio para cumprir um horario.
- A API key vem da variavel ETV_API_KEY fornecida pelo ErsatzTV.

O script usa somente a biblioteca padrao do Python 3.
"""

from __future__ import annotations

import copy
import json
import os
import re
import sys
import tempfile
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SCRIPT_VERSION = "1.1.1"


# =============================================================================
# CONFIGURACAO GERADA PELO ERSATZTV YOUTUBE
# =============================================================================
__GENERATED_CONFIG__


# =============================================================================
# UTILITARIOS
# =============================================================================


def log(message: str) -> None:
    print(f"[scripted-universal] {message}", file=sys.stderr, flush=True)


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_hhmm(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", str(value).strip())
    if not match:
        raise ValueError(f"Horario invalido: {value!r}. Use HH:MM, ex.: 10:00")
    return int(match.group(1)), int(match.group(2))


def parse_date_value(value: str) -> date:
    return date.fromisoformat(str(value).strip())


def parse_local_datetime(value: str, tzinfo: Any) -> datetime:
    text = str(value).strip().replace(" ", "T")
    result = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if result.tzinfo is None:
        result = result.replace(tzinfo=tzinfo)
    return result


def safe_state_key(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    return cleaned or "default"


def format_duration(seconds: float) -> str:
    total = max(1, int(round(seconds)))
    if total % 3600 == 0:
        hours = total // 3600
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    if total % 60 == 0:
        minutes = total // 60
        return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"
    return f"{total} second" if total == 1 else f"{total} seconds"


def ensure_advanced(before: datetime, after: datetime, context: dict[str, Any], label: str) -> None:
    if after <= before and not bool(context.get("isDone")):
        raise RuntimeError(f"{label} nao avancou o playout. Verifique se a fonte possui itens.")


def event_priority(event: dict[str, Any]) -> int:
    return int(event.get("priority", DEFAULT_FIXED_PRIORITY))


def compact_dict(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


# =============================================================================
# DIAS, DATAS E JANELAS
# =============================================================================

_DAY_ALIASES = {
    "mon": 0, "monday": 0, "seg": 0, "segunda": 0, "segunda-feira": 0,
    "tue": 1, "tuesday": 1, "ter": 1, "terca": 1, "terça": 1, "terca-feira": 1, "terça-feira": 1,
    "wed": 2, "wednesday": 2, "qua": 2, "quarta": 2, "quarta-feira": 2,
    "thu": 3, "thursday": 3, "qui": 3, "quinta": 3, "quinta-feira": 3,
    "fri": 4, "friday": 4, "sex": 4, "sexta": 4, "sexta-feira": 4,
    "sat": 5, "saturday": 5, "sab": 5, "sábado": 5, "sabado": 5,
    "sun": 6, "sunday": 6, "dom": 6, "domingo": 6,
}


def normalize_days(values: Any) -> set[int] | None:
    if values is None:
        return None
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        raise ValueError("days precisa ser uma lista de dias")

    result: set[int] = set()
    for raw in values:
        value = str(raw).strip().lower()
        if value in {"all", "todos", "todo", "daily", "diario", "diário"}:
            return None
        if value in {"weekdays", "dias_uteis", "dias-uteis", "uteis", "úteis"}:
            result.update({0, 1, 2, 3, 4})
            continue
        if value in {"weekends", "fim_de_semana", "fim-de-semana"}:
            result.update({5, 6})
            continue
        if value.isdigit() and 0 <= int(value) <= 6:
            result.add(int(value))
            continue
        if value not in _DAY_ALIASES:
            raise ValueError(f"Dia invalido em days: {raw!r}")
        result.add(_DAY_ALIASES[value])
    return result


def date_allowed(event: dict[str, Any], day: date) -> bool:
    if event.get("enabled", True) is False:
        return False

    days = normalize_days(event.get("days"))
    if days is not None and day.weekday() not in days:
        return False

    if event.get("start_date") and day < parse_date_value(str(event["start_date"])):
        return False
    if event.get("end_date") and day > parse_date_value(str(event["end_date"])):
        return False

    dates = event.get("dates")
    if dates:
        allowed_dates = {parse_date_value(str(value)) for value in dates}
        if day not in allowed_dates:
            return False

    excluded = event.get("exclude_dates") or []
    excluded_dates = {parse_date_value(str(value)) for value in excluded}
    if day in excluded_dates:
        return False

    return True


def datetime_on_day(value: str, day: date, tzinfo: Any) -> datetime:
    hour, minute = parse_hhmm(value)
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=tzinfo)


def window_bounds(event: dict[str, Any], start_day: date, tzinfo: Any) -> tuple[datetime, datetime]:
    start = datetime_on_day(str(event["start_time"]), start_day, tzinfo)
    end = datetime_on_day(str(event["end_time"]), start_day, tzinfo)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def iter_days(start: date, end: date) -> Iterable[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


# =============================================================================
# APRESENTACAO (GRAPHICS / WATERMARKS / PRE-ROLL / EPG)
# =============================================================================


def _unique_strings(values: Any) -> list[str]:
    result: list[str] = []
    for raw in values or []:
        value = str(raw).strip()
        if value and value not in result:
            result.append(value)
    return result


def resolve_presentation(config: dict[str, Any] | None, source_key: str | None = None) -> dict[str, Any]:
    config = config or {}
    source = SOURCES.get(source_key or "", {}) if source_key else {}
    profile_name = str(config.get("presentation") or source.get("presentation") or "none")
    if profile_name not in PRESENTATION_PROFILES:
        raise ValueError(f"Perfil de presentation inexistente: {profile_name!r}")

    result = copy.deepcopy(PRESENTATION_PROFILES[profile_name])
    for field in (
        "graphics", "graphics_variables", "watermarks", "pre_roll",
        "epg_group", "epg_title", "epg_advance",
    ):
        if field in config:
            result[field] = copy.deepcopy(config[field])

    result["graphics"] = _unique_strings(result.get("graphics"))
    result["watermarks"] = _unique_strings(result.get("watermarks"))
    result["graphics_variables"] = dict(result.get("graphics_variables") or {})
    result["pre_roll"] = str(result.get("pre_roll") or "").strip() or None
    result["epg_group"] = bool(result.get("epg_group", False))
    result["epg_advance"] = bool(result.get("epg_advance", True))
    if result.get("epg_title") is not None:
        result["epg_title"] = str(result["epg_title"])
    return result


def playback_options(config: dict[str, Any] | None) -> dict[str, Any]:
    config = config or {}
    return {
        "custom_title": config.get("custom_title"),
        "filler_kind": config.get("filler_kind"),
        "disable_watermarks": bool(config.get("disable_watermarks", False)),
        "fallback": config.get("fallback"),
        "trim": bool(config.get("trim", False)),
        "discard_attempts": int(config.get("discard_attempts", 0)),
        "offline_tail": bool(config.get("offline_tail", False)),
        "allow_overrun": bool(config.get("allow_overrun", ALLOW_OVERRUN)),
    }


# =============================================================================
# VALIDACAO DAS FONTES
# =============================================================================


def validate_source_key(key: str, label: str) -> None:
    if key not in SOURCES:
        raise ValueError(f"{label}: source {key!r} nao existe em SOURCES")


def validate_source_definition(key: str, source: dict[str, Any]) -> None:
    if not isinstance(source, dict):
        raise ValueError(f"SOURCES[{key!r}] precisa ser dict")
    kind = str(source.get("type", "")).strip().lower()
    if kind not in {
        "smart_collection", "collection", "multi_collection", "playlist",
        "search", "show", "marathon",
    }:
        raise ValueError(f"SOURCES[{key!r}]: type invalido {kind!r}")

    order = str(source.get("order", "chronological")).strip().lower()
    if kind in {"smart_collection", "collection", "multi_collection", "search", "show"}:
        if order not in {"chronological", "shuffle"}:
            raise ValueError(f"SOURCES[{key!r}]: order deve ser chronological ou shuffle")

    if kind in {"smart_collection", "collection", "multi_collection"} and not str(source.get("name", "")).strip():
        raise ValueError(f"SOURCES[{key!r}]: name obrigatorio")
    if kind == "playlist":
        if not str(source.get("playlist", "")).strip() or not str(source.get("playlist_group", "")).strip():
            raise ValueError(f"SOURCES[{key!r}]: playlist e playlist_group sao obrigatorios")
    if kind == "search" and not str(source.get("query", "")).strip():
        raise ValueError(f"SOURCES[{key!r}]: query obrigatoria")
    if kind == "show" and not isinstance(source.get("guids"), dict):
        raise ValueError(f"SOURCES[{key!r}]: guids precisa ser dict")
    if kind == "marathon":
        if str(source.get("group_by", "")).strip().lower() not in {"show", "season", "artist", "album", "director"}:
            raise ValueError(f"SOURCES[{key!r}]: group_by invalido")
        item_order = str(source.get("item_order", "chronological")).strip().lower()
        if item_order not in {"chronological", "shuffle"}:
            raise ValueError(f"SOURCES[{key!r}]: item_order invalido")

    # valida presentation padrao da fonte
    resolve_presentation({}, key)


def validate_common_event(event: dict[str, Any], label: str) -> None:
    if not isinstance(event, dict):
        raise ValueError(f"{label} precisa ser dict")
    int(event_priority(event))
    normalize_days(event.get("days"))
    for field in ("start_date", "end_date"):
        if event.get(field):
            parse_date_value(str(event[field]))
    for field in ("dates", "exclude_dates"):
        for value in event.get(field) or []:
            parse_date_value(str(value))
    if event.get("presentation") and str(event["presentation"]) not in PRESENTATION_PROFILES:
        raise ValueError(f"{label}: presentation inexistente {event['presentation']!r}")


def validate_mode_payload(event: dict[str, Any], label: str, mode: str | None = None) -> None:
    mode = str(mode or event.get("mode", "count")).strip().lower()
    if mode in {"count", "duration", "all"}:
        source = str(event.get("source", "")).strip()
        validate_source_key(source, label)
        resolve_presentation(event, source)
    if mode == "count":
        if int(event.get("count", 1)) <= 0:
            raise ValueError(f"{label}: count precisa ser > 0")
    elif mode == "duration":
        if float(event.get("duration_minutes", 0)) <= 0:
            raise ValueError(f"{label}: duration_minutes precisa ser > 0")
    elif mode == "all":
        pass
    elif mode == "sequence":
        validate_sequence_steps(event.get("steps"), label)
    else:
        raise ValueError(f"{label}: mode invalido {mode!r}")


def validate_sequence_steps(steps: Any, label: str) -> None:
    if not isinstance(steps, list) or not steps:
        raise ValueError(f"{label}: steps precisa ser lista nao vazia")
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"{label}.steps[{index}] precisa ser dict")
        mode = str(step.get("mode", "count")).strip().lower()
        step_label = f"{label}.steps[{index}]"
        if mode in {"count", "duration", "all", "pad_to_next"}:
            source = str(step.get("source", "")).strip()
            validate_source_key(source, step_label)
            resolve_presentation(step, source)
        elif mode == "wait":
            resolve_presentation(step, None)
        else:
            raise ValueError(f"{step_label}: mode invalido {mode!r}")

        if mode == "count" and int(step.get("count", 1)) <= 0:
            raise ValueError(f"{step_label}: count precisa ser > 0")
        if mode in {"duration", "wait"} and float(step.get("duration_minutes", 0)) <= 0:
            raise ValueError(f"{step_label}: duration_minutes precisa ser > 0")
        if mode == "pad_to_next" and int(step.get("minutes", 0)) <= 0:
            raise ValueError(f"{step_label}: minutes precisa ser > 0")


def validate_config() -> None:
    if not isinstance(PRESENTATION_PROFILES, dict):
        raise ValueError("PRESENTATION_PROFILES precisa ser dict")
    for name, profile in PRESENTATION_PROFILES.items():
        if not isinstance(profile, dict):
            raise ValueError(f"PRESENTATION_PROFILES[{name!r}] precisa ser dict")
        _unique_strings(profile.get("graphics"))
        _unique_strings(profile.get("watermarks"))
        pre_roll = str(profile.get("pre_roll") or "").strip()
        if pre_roll and pre_roll not in SCRIPTED_PLAYLISTS:
            raise ValueError(f"Perfil {name!r}: pre_roll {pre_roll!r} nao existe em SCRIPTED_PLAYLISTS")

    if not isinstance(SOURCES, dict):
        raise ValueError("SOURCES precisa ser dict")
    for key, source in SOURCES.items():
        validate_source_definition(str(key), source)

    if not isinstance(SCRIPTED_PLAYLISTS, dict):
        raise ValueError("SCRIPTED_PLAYLISTS precisa ser dict")
    for key, items in SCRIPTED_PLAYLISTS.items():
        if key in SOURCES:
            raise ValueError(f"SCRIPTED_PLAYLISTS key {key!r} conflita com SOURCES")
        if not isinstance(items, list) or not items:
            raise ValueError(f"SCRIPTED_PLAYLISTS[{key!r}] precisa ser lista nao vazia")
        for item in items:
            validate_source_key(str(item.get("source", "")), f"SCRIPTED_PLAYLISTS[{key!r}]")
            if int(item.get("count", 0)) <= 0:
                raise ValueError(f"SCRIPTED_PLAYLISTS[{key!r}]: count precisa ser > 0")

    if not isinstance(ROTATION, list):
        raise ValueError("ROTATION precisa ser lista")
    if ROTATION and float(DEFAULT_ROTATION_DURATION_MINUTES) <= 0:
        raise ValueError("DEFAULT_ROTATION_DURATION_MINUTES precisa ser > 0")
    for index, item in enumerate(ROTATION):
        source = str(item.get("source", "")).strip()
        validate_source_key(source, f"ROTATION[{index}]")
        resolve_presentation(item, source)
        if item.get("duration_minutes") is not None and float(item["duration_minutes"]) <= 0:
            raise ValueError(f"ROTATION[{index}].duration_minutes precisa ser > 0")

    module_lists = {
        "FIXED_EVENTS": FIXED_EVENTS,
        "FIXED_DURATION_EVENTS": FIXED_DURATION_EVENTS,
        "FIXED_ALL_EVENTS": FIXED_ALL_EVENTS,
        "FIXED_WINDOW_EVENTS": FIXED_WINDOW_EVENTS,
        "WINDOW_ROTATIONS": WINDOW_ROTATIONS,
        "SEQUENCE_EVENTS": SEQUENCE_EVENTS,
        "INTERVAL_EVENTS": INTERVAL_EVENTS,
        "DATE_EVENTS": DATE_EVENTS,
        "OFFLINE_WINDOWS": OFFLINE_WINDOWS,
    }
    for name, values in module_lists.items():
        if not isinstance(values, list):
            raise ValueError(f"{name} precisa ser lista; use [] para desativar")

    for index, event in enumerate(FIXED_EVENTS):
        validate_common_event(event, f"FIXED_EVENTS[{index}]")
        parse_hhmm(str(event.get("time", "")))
        validate_mode_payload(event, f"FIXED_EVENTS[{index}]", "count")

    for index, event in enumerate(FIXED_DURATION_EVENTS):
        validate_common_event(event, f"FIXED_DURATION_EVENTS[{index}]")
        parse_hhmm(str(event.get("time", "")))
        validate_mode_payload(event, f"FIXED_DURATION_EVENTS[{index}]", "duration")

    for index, event in enumerate(FIXED_ALL_EVENTS):
        validate_common_event(event, f"FIXED_ALL_EVENTS[{index}]")
        parse_hhmm(str(event.get("time", "")))
        validate_mode_payload(event, f"FIXED_ALL_EVENTS[{index}]", "all")

    for index, event in enumerate(FIXED_WINDOW_EVENTS):
        validate_common_event(event, f"FIXED_WINDOW_EVENTS[{index}]")
        parse_hhmm(str(event.get("start_time", "")))
        parse_hhmm(str(event.get("end_time", "")))
        source = str(event.get("source", "")).strip()
        validate_source_key(source, f"FIXED_WINDOW_EVENTS[{index}]")
        resolve_presentation(event, source)

    for index, event in enumerate(WINDOW_ROTATIONS):
        validate_common_event(event, f"WINDOW_ROTATIONS[{index}]")
        parse_hhmm(str(event.get("start_time", "")))
        parse_hhmm(str(event.get("end_time", "")))
        if float(event.get("block_minutes", 0)) <= 0:
            raise ValueError(f"WINDOW_ROTATIONS[{index}].block_minutes precisa ser > 0")
        items = event.get("items")
        if not isinstance(items, list) or not items:
            raise ValueError(f"WINDOW_ROTATIONS[{index}].items precisa ser lista nao vazia")
        for item_index, item in enumerate(items):
            source = str(item.get("source", "")).strip()
            validate_source_key(source, f"WINDOW_ROTATIONS[{index}].items[{item_index}]")
            resolve_presentation(item, source)
            if item.get("duration_minutes") is not None and float(item["duration_minutes"]) <= 0:
                raise ValueError(f"WINDOW_ROTATIONS[{index}].items[{item_index}].duration_minutes precisa ser > 0")

    for index, event in enumerate(SEQUENCE_EVENTS):
        validate_common_event(event, f"SEQUENCE_EVENTS[{index}]")
        parse_hhmm(str(event.get("time", "")))
        validate_sequence_steps(event.get("steps"), f"SEQUENCE_EVENTS[{index}]")

    for index, event in enumerate(INTERVAL_EVENTS):
        validate_common_event(event, f"INTERVAL_EVENTS[{index}]")
        parse_hhmm(str(event.get("start_time", "")))
        parse_hhmm(str(event.get("end_time", "")))
        if int(event.get("every_minutes", 0)) <= 0:
            raise ValueError(f"INTERVAL_EVENTS[{index}].every_minutes precisa ser > 0")
        validate_mode_payload(event, f"INTERVAL_EVENTS[{index}]")
        policy = str(event.get("late_policy", "queue")).lower()
        if policy not in {"queue", "skip"}:
            raise ValueError(f"INTERVAL_EVENTS[{index}].late_policy deve ser queue ou skip")
        if event.get("max_lateness_minutes") is not None and float(event["max_lateness_minutes"]) < 0:
            raise ValueError(f"INTERVAL_EVENTS[{index}].max_lateness_minutes invalido")

    for index, event in enumerate(DATE_EVENTS):
        validate_common_event(event, f"DATE_EVENTS[{index}]")
        if not str(event.get("datetime", "")).strip():
            raise ValueError(f"DATE_EVENTS[{index}].datetime obrigatorio")
        # timezone e aplicado somente quando o contexto do build estiver disponivel
        datetime.fromisoformat(str(event["datetime"]).strip().replace(" ", "T").replace("Z", "+00:00"))
        validate_mode_payload(event, f"DATE_EVENTS[{index}]")

    for index, event in enumerate(OFFLINE_WINDOWS):
        validate_common_event(event, f"OFFLINE_WINDOWS[{index}]")
        parse_hhmm(str(event.get("start_time", "")))
        parse_hhmm(str(event.get("end_time", "")))

    if FILLER is not None:
        if not isinstance(FILLER, dict):
            raise ValueError("FILLER precisa ser dict ou None")
        source = str(FILLER.get("source", "")).strip()
        validate_source_key(source, "FILLER")
        resolve_presentation(FILLER, source)


# =============================================================================
# ESTADO PERSISTENTE
# =============================================================================


def default_state() -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "next_rotation_index": 0,
        "rotation_remaining_seconds": None,
        "tasks": [],
        "active_task_id": None,
        "seen_occurrences": {},
    }


def normalize_state(data: dict[str, Any]) -> dict[str, Any]:
    if int(data.get("version", 0) or 0) != STATE_VERSION:
        state = default_state()
        try:
            state["next_rotation_index"] = max(0, int(data.get("next_rotation_index", 0)))
        except Exception:
            pass
        return state

    state = default_state()
    state.update(data)
    if not isinstance(state.get("tasks"), list):
        state["tasks"] = []
    if not isinstance(state.get("seen_occurrences"), dict):
        state["seen_occurrences"] = {}
    state["active_task_id"] = str(state["active_task_id"]) if state.get("active_task_id") else None
    try:
        state["next_rotation_index"] = max(0, int(state.get("next_rotation_index", 0)))
    except Exception:
        state["next_rotation_index"] = 0
    value = state.get("rotation_remaining_seconds")
    if value is not None:
        try:
            value = float(value)
            state["rotation_remaining_seconds"] = value if value > 0 else None
        except Exception:
            state["rotation_remaining_seconds"] = None
    return state


def load_state(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("estado nao e objeto JSON")
        return normalize_state(raw)
    except FileNotFoundError:
        return default_state()
    except Exception as exc:
        raise RuntimeError(f"Nao foi possivel ler o estado {path}: {exc}") from exc


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def prune_seen_occurrences(state: dict[str, Any], current: datetime) -> None:
    cutoff = current - timedelta(days=SEEN_OCCURRENCE_RETENTION_DAYS)
    keep: dict[str, str] = {}
    for occurrence_id, target_value in (state.get("seen_occurrences") or {}).items():
        try:
            if parse_dt(str(target_value)) >= cutoff:
                keep[str(occurrence_id)] = str(target_value)
        except Exception:
            continue
    state["seen_occurrences"] = keep


# =============================================================================
# CLIENTE HTTP DA API SCRIPTED SCHEDULE
# =============================================================================


class EtvApi:
    def __init__(self, host: str, build_id: str, api_key: str) -> None:
        self.host = host.rstrip("/")
        self.build_id = build_id
        self.api_key = api_key
        self.base = f"{self.host}/api/scripted/playout/build/{self.build_id}"

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        body = None
        headers = {"Accept": "application/json", "X-Etv-Api-Key": self.api_key}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = Request(self.base + path, data=body, headers=headers, method=method)
        try:
            with urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as response:
                raw = response.read()
                if not raw:
                    return None
                return json.loads(raw.decode("utf-8"))
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ErsatzTV respondeu HTTP {exc.code} em {method} {path}: {details}") from exc
        except URLError as exc:
            raise RuntimeError(f"Falha ao acessar ErsatzTV em {method} {path}: {exc}") from exc

    def context(self) -> dict[str, Any]:
        return self._request("GET", "/context")

    # ----- registro de fontes -----
    def add_collection(self, key: str, name: str, order: str) -> None:
        self._request("POST", "/add_collection", {"key": key, "collection": name, "order": order})

    def add_multi_collection(self, key: str, name: str, order: str) -> None:
        self._request("POST", "/add_multi_collection", {"key": key, "multiCollection": name, "order": order})

    def add_playlist(self, key: str, playlist: str, playlist_group: str) -> None:
        self._request("POST", "/add_playlist", {"key": key, "playlist": playlist, "playlistGroup": playlist_group})

    def create_playlist(self, key: str, items: list[dict[str, Any]]) -> None:
        self._request("POST", "/create_playlist", {"key": key, "items": items})

    def add_search(self, key: str, query: str, order: str) -> None:
        self._request("POST", "/add_search", {"key": key, "query": query, "order": order})

    def add_smart_collection(self, key: str, name: str, order: str) -> None:
        self._request("POST", "/add_smart_collection", {"key": key, "smartCollection": name, "order": order})

    def add_show(self, key: str, guids: dict[str, str], order: str) -> None:
        self._request("POST", "/add_show", {"key": key, "guids": guids, "order": order})

    def add_marathon(self, key: str, source: dict[str, Any]) -> None:
        self._request(
            "POST",
            "/add_marathon",
            compact_dict(
                {
                    "key": key,
                    "groupBy": str(source["group_by"]),
                    "itemOrder": str(source.get("item_order", "chronological")),
                    "guids": source.get("guids") or {},
                    "searches": source.get("searches") or [],
                    "playAllItems": bool(source.get("play_all_items", False)),
                    "shuffleGroups": bool(source.get("shuffle_groups", False)),
                }
            ),
        )

    # ----- operacoes de playout -----
    @staticmethod
    def _content_options(payload: dict[str, Any], options: dict[str, Any] | None) -> dict[str, Any]:
        options = options or {}
        payload["disableWatermarks"] = bool(options.get("disable_watermarks", False))
        if options.get("filler_kind") is not None:
            payload["fillerKind"] = options["filler_kind"]
        if options.get("custom_title") is not None:
            payload["customTitle"] = options["custom_title"]
        return payload

    def add_all(self, content: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("POST", "/add_all", self._content_options({"content": content}, options))

    def add_count(self, content: str, count: int, options: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request(
            "POST", "/add_count", self._content_options({"content": content, "count": int(count)}, options)
        )

    def add_duration(self, content: str, seconds: float, options: dict[str, Any] | None = None) -> dict[str, Any]:
        options = options or {}
        payload = self._content_options(
            {
                "content": content,
                "duration": format_duration(seconds),
                "fallback": options.get("fallback"),
                "trim": bool(options.get("trim", False)),
                "discardAttempts": int(options.get("discard_attempts", 0)),
                "stopBeforeEnd": not bool(options.get("allow_overrun", ALLOW_OVERRUN)),
                "offlineTail": bool(options.get("offline_tail", False)),
            },
            options,
        )
        return self._request("POST", "/add_duration", compact_dict(payload))

    def pad_until_exact(self, content: str, when: datetime, options: dict[str, Any] | None = None) -> dict[str, Any]:
        options = options or {}
        payload = self._content_options(
            {
                "content": content,
                "when": when.isoformat(),
                "fallback": options.get("fallback"),
                "trim": bool(options.get("trim", False)),
                "discardAttempts": int(options.get("discard_attempts", 0)),
                "stopBeforeEnd": not bool(options.get("allow_overrun", ALLOW_OVERRUN)),
                "offlineTail": bool(options.get("offline_tail", False)),
            },
            options,
        )
        return self._request("POST", "/pad_until_exact", compact_dict(payload))

    def pad_to_next(self, content: str, minutes: int, options: dict[str, Any] | None = None) -> dict[str, Any]:
        options = options or {}
        payload = self._content_options(
            {
                "content": content,
                "minutes": int(minutes),
                "fallback": options.get("fallback"),
                "trim": bool(options.get("trim", False)),
                "discardAttempts": int(options.get("discard_attempts", 0)),
                "stopBeforeEnd": not bool(options.get("allow_overrun", ALLOW_OVERRUN)),
                "offlineTail": bool(options.get("offline_tail", False)),
            },
            options,
        )
        return self._request("POST", "/pad_to_next", compact_dict(payload))

    def wait_until_exact(self, when: datetime, rewind_on_reset: bool = False) -> dict[str, Any]:
        return self._request(
            "POST", "/wait_until_exact", {"when": when.isoformat(), "rewindOnReset": bool(rewind_on_reset)}
        )

    # ----- controles -----
    def graphics_on(self, graphics: list[str], variables: dict[str, str] | None = None) -> None:
        payload: dict[str, Any] = {"graphics": graphics}
        if variables:
            payload["variables"] = variables
        self._request("POST", "/graphics_on", payload)

    def graphics_off(self, graphics: list[str] | None = None) -> None:
        self._request("POST", "/graphics_off", {"graphics": list(graphics or [])})

    def watermark_on(self, watermarks: list[str]) -> None:
        self._request("POST", "/watermark_on", {"watermark": watermarks})

    def watermark_off(self, watermarks: list[str] | None = None) -> None:
        self._request("POST", "/watermark_off", {"watermark": list(watermarks or [])})

    def pre_roll_on(self, playlist_key: str) -> None:
        self._request("POST", "/pre_roll_on", {"playlist": playlist_key})

    def pre_roll_off(self) -> None:
        self._request("POST", "/pre_roll_off", None)

    def start_epg_group(self, advance: bool = True, custom_title: str | None = None) -> None:
        self._request("POST", "/start_epg_group", compact_dict({"advance": bool(advance), "customTitle": custom_title}))

    def stop_epg_group(self) -> None:
        self._request("POST", "/stop_epg_group", None)

    def peek_next(self, content: str) -> Any:
        return self._request("GET", f"/peek_next/{quote(content, safe='')}", None)


class PresentationController:
    """Sincroniza Graphics Elements, scripted watermarks, pre-roll e EPG group por bloco."""

    def __init__(self, api: EtvApi) -> None:
        self.api = api
        self.initialized = False
        self.graphics: list[str] = []
        self.graphics_variables: dict[str, str] = {}
        self.watermarks: list[str] = []
        self.pre_roll: str | None = None
        self.epg_active = False
        self.token: str | None = None

    def _initialize(self) -> None:
        if self.initialized:
            return
        self.api.graphics_off([])
        self.api.watermark_off([])
        self.api.pre_roll_off()
        self.initialized = True

    def set(self, presentation: dict[str, Any], token: str) -> None:
        self._initialize()
        desired_graphics = _unique_strings(presentation.get("graphics"))
        desired_variables = dict(presentation.get("graphics_variables") or {})
        desired_watermarks = _unique_strings(presentation.get("watermarks"))
        desired_pre_roll = str(presentation.get("pre_roll") or "").strip() or None
        desired_epg = bool(presentation.get("epg_group", False))

        same_token = self.token == token
        same_visuals = (
            self.graphics == desired_graphics
            and self.graphics_variables == desired_variables
            and self.watermarks == desired_watermarks
            and self.pre_roll == desired_pre_roll
            and self.epg_active == desired_epg
        )
        if same_token and same_visuals:
            return

        # Cada troca de modulo encerra o grupo EPG anterior e cria outro se solicitado.
        if self.epg_active:
            self.api.stop_epg_group()
            self.epg_active = False

        # Graphics: se as variaveis mudaram, religa o conjunto para atualizar valores.
        variables_changed = self.graphics_variables != desired_variables
        if variables_changed and self.graphics:
            self.api.graphics_off(self.graphics)
            self.graphics = []
        to_off = [item for item in self.graphics if item not in desired_graphics]
        to_on = [item for item in desired_graphics if item not in self.graphics]
        if to_off:
            self.api.graphics_off(to_off)
        if to_on:
            self.api.graphics_on(to_on, desired_variables)
        elif variables_changed and desired_graphics:
            self.api.graphics_on(desired_graphics, desired_variables)
        self.graphics = desired_graphics
        self.graphics_variables = desired_variables

        to_wm_off = [item for item in self.watermarks if item not in desired_watermarks]
        to_wm_on = [item for item in desired_watermarks if item not in self.watermarks]
        if to_wm_off:
            self.api.watermark_off(to_wm_off)
        if to_wm_on:
            self.api.watermark_on(to_wm_on)
        self.watermarks = desired_watermarks

        if self.pre_roll != desired_pre_roll:
            if self.pre_roll:
                self.api.pre_roll_off()
            if desired_pre_roll:
                self.api.pre_roll_on(desired_pre_roll)
            self.pre_roll = desired_pre_roll

        if desired_epg:
            self.api.start_epg_group(
                advance=bool(presentation.get("epg_advance", True)),
                custom_title=presentation.get("epg_title"),
            )
            self.epg_active = True

        self.token = token

    def clear(self, token: str = "offline") -> None:
        self.set(resolve_presentation({"presentation": "none"}), token)

    def finish(self) -> None:
        if not self.initialized:
            return
        if self.epg_active:
            self.api.stop_epg_group()
            self.epg_active = False


# =============================================================================
# REGISTRO DAS FONTES NO BUILD
# =============================================================================


def register_sources(api: EtvApi) -> None:
    for key, source in SOURCES.items():
        kind = str(source["type"]).strip().lower()
        order = str(source.get("order", "chronological")).strip().lower()
        if kind == "smart_collection":
            api.add_smart_collection(key, str(source["name"]), order)
        elif kind == "collection":
            api.add_collection(key, str(source["name"]), order)
        elif kind == "multi_collection":
            api.add_multi_collection(key, str(source["name"]), order)
        elif kind == "playlist":
            api.add_playlist(key, str(source["playlist"]), str(source["playlist_group"]))
        elif kind == "search":
            api.add_search(key, str(source["query"]), order)
        elif kind == "show":
            api.add_show(key, dict(source["guids"]), order)
        elif kind == "marathon":
            api.add_marathon(key, source)
        else:
            raise RuntimeError(f"Tipo de fonte nao suportado em runtime: {kind!r}")

    # Cria playlists somente depois de registrar as fontes que elas referenciam.
    for key, items in SCRIPTED_PLAYLISTS.items():
        api.create_playlist(
            key,
            [{"content": str(item["source"]), "count": int(item["count"])} for item in items],
        )


# =============================================================================
# DEFINICOES E OCORRENCIAS
# =============================================================================


def _event_id(module: str, index: int, event: dict[str, Any]) -> str:
    value = str(event.get("id") or f"{module.lower()}_{index}").strip()
    return value


def scheduled_definitions() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    serial = 0

    def add(module: str, kind: str, events: list[dict[str, Any]]) -> None:
        nonlocal serial
        for index, event in enumerate(events):
            result.append(
                {
                    "module": module,
                    "kind": kind,
                    "index": index,
                    "id": _event_id(module, index, event),
                    "serial": serial,
                    "priority": event_priority(event),
                    "event": event,
                }
            )
            serial += 1

    add("FIXED_EVENTS", "count", FIXED_EVENTS)
    add("FIXED_DURATION_EVENTS", "duration", FIXED_DURATION_EVENTS)
    add("FIXED_ALL_EVENTS", "all", FIXED_ALL_EVENTS)
    add("FIXED_WINDOW_EVENTS", "window", FIXED_WINDOW_EVENTS)
    add("WINDOW_ROTATIONS", "window_rotation", WINDOW_ROTATIONS)
    add("SEQUENCE_EVENTS", "sequence", SEQUENCE_EVENTS)
    add("INTERVAL_EVENTS", "interval", INTERVAL_EVENTS)
    add("DATE_EVENTS", "date_event", DATE_EVENTS)
    add("OFFLINE_WINDOWS", "offline_window", OFFLINE_WINDOWS)
    return result


def definition_target_for_day(definition: dict[str, Any], day: date, tzinfo: Any) -> datetime:
    event = definition["event"]
    kind = str(definition["kind"])
    if kind in {"window", "window_rotation", "offline_window", "interval"}:
        return datetime_on_day(str(event["start_time"]), day, tzinfo)
    return datetime_on_day(str(event["time"]), day, tzinfo)


def interval_targets_for_day(event: dict[str, Any], day: date, tzinfo: Any) -> list[datetime]:
    if not date_allowed(event, day):
        return []
    start, end = window_bounds(event, day, tzinfo)
    step = timedelta(minutes=int(event["every_minutes"]))
    values: list[datetime] = []
    current = start
    while current < end:
        values.append(current)
        current += step
    return values


def definition_occurrences_between(
    definition: dict[str, Any], start: datetime, end: datetime
) -> list[datetime]:
    event = definition["event"]
    kind = str(definition["kind"])
    if end < start or event.get("enabled", True) is False:
        return []

    if kind == "date_event":
        target = parse_local_datetime(str(event["datetime"]), start.tzinfo)
        return [target] if start <= target <= end else []

    results: list[datetime] = []
    # -1 day is useful for interval windows that cross midnight, although targets themselves
    # are still filtered by the requested range.
    first_day = start.date() - timedelta(days=1)
    final_day = end.date()
    for day in iter_days(first_day, final_day):
        if not date_allowed(event, day):
            continue
        if kind == "interval":
            for target in interval_targets_for_day(event, day, start.tzinfo):
                if start <= target <= end:
                    results.append(target)
        else:
            target = definition_target_for_day(definition, day, start.tzinfo)
            if start <= target <= end:
                results.append(target)
    results.sort()
    return results


def occurrences_between(start: datetime, end: datetime) -> list[tuple[dict[str, Any], datetime]]:
    result: list[tuple[dict[str, Any], datetime]] = []
    for definition in scheduled_definitions():
        for target in definition_occurrences_between(definition, start, end):
            result.append((definition, target))
    result.sort(key=lambda item: (item[1], item[0]["serial"]))
    return result


def occurrence_id(definition: dict[str, Any], target: datetime) -> str:
    return f"{definition['module']}:{definition['id']}:{target.isoformat()}"


def occurrence_window_end(definition: dict[str, Any], target: datetime) -> datetime | None:
    kind = str(definition["kind"])
    if kind not in {"window", "window_rotation", "offline_window"}:
        return None
    _, end = window_bounds(definition["event"], target.date(), target.tzinfo)
    return end


def make_task(definition: dict[str, Any], target: datetime) -> dict[str, Any]:
    event = definition["event"]
    kind = str(definition["kind"])
    task: dict[str, Any] = {
        "task_id": occurrence_id(definition, target),
        "module": str(definition["module"]),
        "kind": kind,
        "target": target.isoformat(),
        "priority": int(definition["priority"]),
        "label": str(event.get("label") or definition["id"]),
        "atomic": False,
    }

    # INTERVAL_EVENTS e DATE_EVENTS viram um dos tipos de tarefa normais.
    if kind in {"interval", "date_event"}:
        mode = str(event.get("mode", "count")).strip().lower()
        task["origin_kind"] = kind
        task["kind"] = mode
        kind = mode

    if kind in {"count", "duration", "all", "window"}:
        source = str(event["source"]).strip()
        task["source"] = source
        task["presentation"] = resolve_presentation(event, source)
        task["playback"] = playback_options(event)

    if kind == "count":
        task["remaining_count"] = int(event.get("count", 1))
    elif kind == "duration":
        task["remaining_seconds"] = float(event["duration_minutes"]) * 60.0
    elif kind == "all":
        task["atomic"] = True
    elif kind == "window":
        task["window_end"] = occurrence_window_end(definition, target).isoformat()
    elif kind == "window_rotation":
        task["window_end"] = occurrence_window_end(definition, target).isoformat()
        task["items"] = []
        for item in event["items"]:
            source = str(item["source"]).strip()
            task["items"].append(
                {
                    "source": source,
                    "presentation": resolve_presentation(item, source),
                    "playback": playback_options(item),
                    "duration_minutes": float(item.get("duration_minutes", event["block_minutes"])),
                }
            )
        task["rotation_index"] = 0
        task["block_remaining_seconds"] = None
    elif kind == "sequence":
        task["atomic"] = bool(event.get("atomic", False))
        task["steps"] = []
        for step in event["steps"]:
            mode = str(step.get("mode", "count")).strip().lower()
            source = str(step.get("source", "")).strip() or None
            task["steps"].append(
                {
                    "mode": mode,
                    "source": source,
                    "count": int(step.get("count", 1)) if mode == "count" else None,
                    "duration_minutes": float(step.get("duration_minutes", 0)) if mode in {"duration", "wait"} else None,
                    "minutes": int(step.get("minutes", 0)) if mode == "pad_to_next" else None,
                    "presentation": resolve_presentation(step, source),
                    "playback": playback_options(step),
                }
            )
        task["step_index"] = 0
        task["step_remaining_count"] = None
        task["step_remaining_seconds"] = None
    elif kind == "offline_window":
        task["window_end"] = occurrence_window_end(definition, target).isoformat()
        task["presentation"] = resolve_presentation({"presentation": "none"})
    else:
        raise RuntimeError(f"Nao foi possivel criar tarefa para kind={kind!r}")

    return task


def should_skip_late(definition: dict[str, Any], target: datetime, now: datetime) -> bool:
    event = definition["event"]
    policy = str(event.get("late_policy", "queue")).strip().lower()
    if policy != "skip" or now <= target:
        return False
    max_lateness = event.get("max_lateness_minutes")
    if max_lateness is None:
        return True
    lateness = (now - target).total_seconds() / 60.0
    return lateness > float(max_lateness)


def enqueue_occurrences_between(state: dict[str, Any], start: datetime, end: datetime) -> None:
    seen: dict[str, str] = state.setdefault("seen_occurrences", {})
    tasks: list[dict[str, Any]] = state.setdefault("tasks", [])
    task_ids = {str(task.get("task_id")) for task in tasks}

    for definition, target in occurrences_between(start, end):
        occ_id = occurrence_id(definition, target)
        if occ_id in seen or occ_id in task_ids:
            continue
        seen[occ_id] = target.isoformat()
        if should_skip_late(definition, target, end):
            log(f"Evento atrasado descartado: {definition['module']} {definition['id']} @ {target.isoformat()}")
            continue
        task = make_task(definition, target)
        tasks.append(task)
        task_ids.add(occ_id)
        log(
            f"Evento liberado: {task['module']} {task['label']} @ {target.isoformat()} "
            f"priority={task['priority']}"
        )


def enqueue_active_windows_at(state: dict[str, Any], current: datetime) -> None:
    """Ao iniciar/continuar um build dentro de uma janela, garante que ela exista na fila."""
    seen: dict[str, str] = state.setdefault("seen_occurrences", {})
    tasks: list[dict[str, Any]] = state.setdefault("tasks", [])
    task_ids = {str(task.get("task_id")) for task in tasks}

    for definition in scheduled_definitions():
        if definition["kind"] not in {"window", "window_rotation", "offline_window"}:
            continue
        event = definition["event"]
        for day in (current.date() - timedelta(days=1), current.date()):
            if not date_allowed(event, day):
                continue
            start, end = window_bounds(event, day, current.tzinfo)
            if not (start <= current < end):
                continue
            occ_id = occurrence_id(definition, start)
            if occ_id in seen or occ_id in task_ids:
                continue
            seen[occ_id] = start.isoformat()
            task = make_task(definition, start)
            tasks.append(task)
            task_ids.add(occ_id)
            log(f"Janela ja ativa restaurada: {task['module']} {task['label']} ate {end.isoformat()}")


def next_occurrence_after(
    current: datetime,
    finish: datetime,
    *,
    priority_greater_than: int | None = None,
) -> tuple[dict[str, Any], datetime] | None:
    if finish <= current:
        return None
    start = current + timedelta(microseconds=1)
    candidates = occurrences_between(start, finish)
    for definition, target in candidates:
        if priority_greater_than is not None and int(definition["priority"]) <= priority_greater_than:
            continue
        return definition, target
    return None


# =============================================================================
# FILA / PRIORIDADE
# =============================================================================


def find_task(state: dict[str, Any], task_id: str | None) -> dict[str, Any] | None:
    if not task_id:
        return None
    for task in state.get("tasks", []):
        if str(task.get("task_id")) == str(task_id):
            return task
    return None


def finish_task(state: dict[str, Any], task: dict[str, Any]) -> None:
    task_id = str(task["task_id"])
    state["tasks"] = [item for item in state.get("tasks", []) if str(item.get("task_id")) != task_id]
    if str(state.get("active_task_id") or "") == task_id:
        state["active_task_id"] = None


def expire_tasks(state: dict[str, Any], current: datetime) -> None:
    for task in list(state.get("tasks", [])):
        if task.get("kind") not in {"window", "window_rotation", "offline_window"}:
            continue
        try:
            end = parse_dt(str(task["window_end"]))
        except Exception:
            continue
        if current >= end:
            log(f"Janela expirada: {task['module']} {task['label']}")
            finish_task(state, task)


def choose_task(state: dict[str, Any]) -> dict[str, Any] | None:
    tasks: list[dict[str, Any]] = state.get("tasks", [])
    if not tasks:
        state["active_task_id"] = None
        return None

    active = find_task(state, state.get("active_task_id"))
    if active is not None:
        if bool(active.get("atomic", False)):
            return active
        active_priority = int(active.get("priority", DEFAULT_FIXED_PRIORITY))
        if not any(
            int(task.get("priority", DEFAULT_FIXED_PRIORITY)) > active_priority
            for task in tasks
            if task is not active
        ):
            return active

    winner = sorted(
        tasks,
        key=lambda task: (
            -int(task.get("priority", DEFAULT_FIXED_PRIORITY)),
            parse_dt(str(task["target"])),
            str(task.get("task_id", "")),
        ),
    )[0]
    previous = state.get("active_task_id")
    state["active_task_id"] = str(winner["task_id"])
    if previous and previous != state["active_task_id"]:
        log(f"Prioridade: {winner['label']} (p={winner['priority']}) assume; tarefa anterior fica suspensa")
    return winner


# =============================================================================
# EXECUCAO DAS TAREFAS
# =============================================================================


def run_count_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    presentation.set(task["presentation"], str(task["task_id"]))
    before = current
    log(f"{task['module']} {task['label']}: 1 item (restavam {task['remaining_count']}, p={task['priority']})")
    context = api.add_count(str(task["source"]), 1, task.get("playback"))
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"{task['module']} {task['label']}")
    task["remaining_count"] = max(0, int(task["remaining_count"]) - 1)
    enqueue_occurrences_between(state, before, after)
    if int(task["remaining_count"]) <= 0:
        finish_task(state, task)
    return context


def run_duration_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    remaining = max(0.0, float(task.get("remaining_seconds", 0.0)))
    if remaining <= 0.5:
        finish_task(state, task)
        return context

    presentation.set(task["presentation"], str(task["task_id"]))
    desired_end = current + timedelta(seconds=remaining)
    higher = next_occurrence_after(
        current,
        min(finish, desired_end),
        priority_greater_than=int(task.get("priority", DEFAULT_FIXED_PRIORITY)),
    )

    before = current
    if higher is not None and higher[1] < desired_end:
        target = higher[1]
        log(f"{task['module']} {task['label']} ate prioridade maior @ {target.isoformat()} (saldo {remaining/60:.1f} min)")
        context = api.pad_until_exact(str(task["source"]), target, task.get("playback"))
    else:
        log(f"{task['module']} {task['label']}: saldo {remaining/60:.1f} min")
        context = api.add_duration(str(task["source"]), remaining, task.get("playback"))

    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"{task['module']} {task['label']}")
    elapsed = max(0.0, (after - before).total_seconds())
    task["remaining_seconds"] = max(0.0, remaining - elapsed)
    enqueue_occurrences_between(state, before, after)
    if float(task["remaining_seconds"]) <= 0.5:
        finish_task(state, task)
    return context


def run_all_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    presentation.set(task["presentation"], str(task["task_id"]))
    before = current
    log(f"{task['module']} {task['label']}: add_all atomico (p={task['priority']})")
    context = api.add_all(str(task["source"]), task.get("playback"))
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"{task['module']} {task['label']}")
    enqueue_occurrences_between(state, before, after)
    finish_task(state, task)
    return context


def run_window_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    window_end = parse_dt(str(task["window_end"]))
    if current >= window_end:
        finish_task(state, task)
        return context

    presentation.set(task["presentation"], str(task["task_id"]))
    target = min(window_end, finish)
    higher = next_occurrence_after(
        current,
        target,
        priority_greater_than=int(task.get("priority", DEFAULT_FIXED_PRIORITY)),
    )
    if higher is not None and higher[1] < target:
        target = higher[1]

    before = current
    log(f"{task['module']} {task['label']}: janela ate {target.isoformat()}")
    context = api.pad_until_exact(str(task["source"]), target, task.get("playback"))
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"{task['module']} {task['label']}")
    enqueue_occurrences_between(state, before, after)
    if after >= window_end:
        finish_task(state, task)
    return context


def run_window_rotation_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    window_end = parse_dt(str(task["window_end"]))
    if current >= window_end:
        finish_task(state, task)
        return context

    items = task["items"]
    index = int(task.get("rotation_index", 0)) % len(items)
    item = items[index]
    remaining_value = task.get("block_remaining_seconds")
    if remaining_value is None:
        remaining = float(item["duration_minutes"]) * 60.0
    else:
        remaining = max(1.0, float(remaining_value))

    token = f"{task['task_id']}:rotation:{index}"
    presentation.set(item["presentation"], token)
    desired_end = min(current + timedelta(seconds=remaining), window_end, finish)
    higher = next_occurrence_after(
        current,
        desired_end,
        priority_greater_than=int(task.get("priority", DEFAULT_FIXED_PRIORITY)),
    )
    target = higher[1] if higher is not None and higher[1] < desired_end else desired_end

    before = current
    log(f"WINDOW_ROTATIONS {task['label']} -> {item['source']} ate {target.isoformat()}")
    context = api.pad_until_exact(str(item["source"]), target, item.get("playback"))
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"WINDOW_ROTATIONS {task['label']}")
    elapsed = max(0.0, (after - before).total_seconds())
    enqueue_occurrences_between(state, before, after)

    remaining_after = max(0.0, remaining - elapsed)
    if remaining_after <= 0.5:
        task["rotation_index"] = (index + 1) % len(items)
        task["block_remaining_seconds"] = None
    else:
        task["block_remaining_seconds"] = remaining_after

    if after >= window_end:
        finish_task(state, task)
    return context


def _advance_sequence_step(task: dict[str, Any]) -> None:
    task["step_index"] = int(task.get("step_index", 0)) + 1
    task["step_remaining_count"] = None
    task["step_remaining_seconds"] = None


def run_sequence_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    index = int(task.get("step_index", 0))
    steps = task["steps"]
    if index >= len(steps):
        finish_task(state, task)
        return context

    step = steps[index]
    mode = str(step["mode"])
    token = f"{task['task_id']}:step:{index}"
    presentation.set(step["presentation"], token)
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    before = current

    if mode == "count":
        if task.get("step_remaining_count") is None:
            task["step_remaining_count"] = int(step["count"])
        log(f"SEQUENCE {task['label']} step {index+1}: count 1/{task['step_remaining_count']}")
        context = api.add_count(str(step["source"]), 1, step.get("playback"))
        task["step_remaining_count"] = max(0, int(task["step_remaining_count"]) - 1)

    elif mode == "duration":
        if task.get("step_remaining_seconds") is None:
            task["step_remaining_seconds"] = float(step["duration_minutes"]) * 60.0
        remaining = max(0.0, float(task["step_remaining_seconds"]))
        desired_end = current + timedelta(seconds=remaining)
        higher = None
        if not bool(task.get("atomic", False)):
            higher = next_occurrence_after(
                current,
                min(finish, desired_end),
                priority_greater_than=int(task.get("priority", DEFAULT_FIXED_PRIORITY)),
            )
        if higher is not None and higher[1] < desired_end:
            context = api.pad_until_exact(str(step["source"]), higher[1], step.get("playback"))
        else:
            context = api.add_duration(str(step["source"]), remaining, step.get("playback"))

    elif mode == "all":
        log(f"SEQUENCE {task['label']} step {index+1}: add_all")
        context = api.add_all(str(step["source"]), step.get("playback"))

    elif mode == "pad_to_next":
        log(f"SEQUENCE {task['label']} step {index+1}: pad_to_next {step['minutes']} min")
        context = api.pad_to_next(str(step["source"]), int(step["minutes"]), step.get("playback"))

    elif mode == "wait":
        seconds = float(step["duration_minutes"]) * 60.0
        log(f"SEQUENCE {task['label']} step {index+1}: wait {seconds/60:.1f} min")
        context = api.wait_until_exact(current + timedelta(seconds=seconds))

    else:
        raise RuntimeError(f"SEQUENCE mode desconhecido: {mode!r}")

    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"SEQUENCE {task['label']} step {index+1}")
    elapsed = max(0.0, (after - before).total_seconds())
    enqueue_occurrences_between(state, before, after)

    if mode == "count":
        if int(task["step_remaining_count"]) <= 0:
            _advance_sequence_step(task)
    elif mode == "duration":
        task["step_remaining_seconds"] = max(0.0, float(task["step_remaining_seconds"]) - elapsed)
        if float(task["step_remaining_seconds"]) <= 0.5:
            _advance_sequence_step(task)
    else:
        _advance_sequence_step(task)

    if int(task.get("step_index", 0)) >= len(steps):
        finish_task(state, task)
    return context


def run_offline_window_task(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    window_end = parse_dt(str(task["window_end"]))
    if current >= window_end:
        finish_task(state, task)
        return context

    presentation.clear(str(task["task_id"]))
    target = min(window_end, finish)
    higher = next_occurrence_after(
        current,
        target,
        priority_greater_than=int(task.get("priority", DEFAULT_FIXED_PRIORITY)),
    )
    if higher is not None and higher[1] < target:
        target = higher[1]

    before = current
    log(f"OFFLINE_WINDOWS {task['label']} ate {target.isoformat()}")
    context = api.wait_until_exact(target)
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"OFFLINE_WINDOWS {task['label']}")
    enqueue_occurrences_between(state, before, after)
    if after >= window_end:
        finish_task(state, task)
    return context


def run_task_step(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
    task: dict[str, Any],
) -> dict[str, Any]:
    kind = str(task["kind"])
    if kind == "count":
        return run_count_task(api, presentation, context, state, task)
    if kind == "duration":
        return run_duration_task(api, presentation, context, state, task)
    if kind == "all":
        return run_all_task(api, presentation, context, state, task)
    if kind == "window":
        return run_window_task(api, presentation, context, state, task)
    if kind == "window_rotation":
        return run_window_rotation_task(api, presentation, context, state, task)
    if kind == "sequence":
        return run_sequence_task(api, presentation, context, state, task)
    if kind == "offline_window":
        return run_offline_window_task(api, presentation, context, state, task)
    raise RuntimeError(f"Tipo de tarefa desconhecido: {kind!r}")


# =============================================================================
# FUNDO: ROTATION / FILLER / OFFLINE
# =============================================================================


def advance_rotation(state: dict[str, Any]) -> None:
    if not ROTATION:
        state["next_rotation_index"] = 0
        state["rotation_remaining_seconds"] = None
        return
    index = int(state.get("next_rotation_index", 0)) % len(ROTATION)
    state["next_rotation_index"] = (index + 1) % len(ROTATION)
    state["rotation_remaining_seconds"] = None


def run_rotation(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    index = int(state.get("next_rotation_index", 0)) % len(ROTATION)
    item = ROTATION[index]
    source = str(item["source"])

    remaining_value = state.get("rotation_remaining_seconds")
    default_seconds = float(item.get("duration_minutes", DEFAULT_ROTATION_DURATION_MINUTES)) * 60.0
    remaining = default_seconds if remaining_value is None else max(1.0, float(remaining_value))

    presentation.set(resolve_presentation(item, source), f"rotation:{index}:{source}")
    desired_end = min(current + timedelta(seconds=remaining), finish)
    next_event = next_occurrence_after(current, desired_end)

    before = current
    interrupted = False
    if next_event is not None and next_event[1] < desired_end:
        target = next_event[1]
        log(f"ROTATION {source} ate {target.isoformat()} (sem corte; depois avanca)")
        context = api.pad_until_exact(source, target, playback_options(item))
        after = parse_dt(str(context["currentTime"]))
        interrupted = after >= target
    else:
        log(f"ROTATION {source}: {remaining/60:.1f} min do bloco")
        context = api.add_duration(source, remaining, playback_options(item))
        after = parse_dt(str(context["currentTime"]))

    ensure_advanced(before, after, context, f"ROTATION {source}")
    elapsed = max(0.0, (after - before).total_seconds())
    enqueue_occurrences_between(state, before, after)

    if interrupted:
        advance_rotation(state)
    else:
        remaining_after = max(0.0, remaining - elapsed)
        if remaining_after <= 0.5:
            advance_rotation(state)
        else:
            state["rotation_remaining_seconds"] = remaining_after
    return context


def run_filler(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    if FILLER is None:
        return context
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    next_event = next_occurrence_after(current, finish)
    target = next_event[1] if next_event is not None else finish
    source = str(FILLER["source"])
    presentation.set(resolve_presentation(FILLER, source), "filler")
    before = current
    log(f"FILLER {source} ate {target.isoformat()}")
    context = api.pad_until_exact(source, target, playback_options(FILLER))
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, f"FILLER {source}")
    enqueue_occurrences_between(state, before, after)
    return context


def run_offline_gap(
    api: EtvApi,
    presentation: PresentationController,
    context: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    current = parse_dt(str(context["currentTime"]))
    finish = parse_dt(str(context["finishTime"]))
    next_event = next_occurrence_after(current, finish)
    target = next_event[1] if next_event is not None else finish
    presentation.clear("background-offline")
    before = current
    log(f"Sem fundo configurado: offline ate {target.isoformat()}")
    context = api.wait_until_exact(target)
    after = parse_dt(str(context["currentTime"]))
    ensure_advanced(before, after, context, "intervalo offline")
    enqueue_occurrences_between(state, before, after)
    return context


# =============================================================================
# MOTOR
# =============================================================================


def build(api: EtvApi, context: dict[str, Any], state: dict[str, Any], state_path: Path) -> None:
    presentation = PresentationController(api)
    iterations = 0
    try:
        while not bool(context["isDone"]):
            iterations += 1
            if iterations > 200000:
                raise RuntimeError("Limite de iteracoes excedido; abortando para evitar loop infinito")

            current = parse_dt(str(context["currentTime"]))
            enqueue_active_windows_at(state, current)
            enqueue_occurrences_between(state, current, current)
            expire_tasks(state, current)
            prune_seen_occurrences(state, current)

            task = choose_task(state)
            if task is not None:
                context = run_task_step(api, presentation, context, state, task)
            elif ROTATION:
                context = run_rotation(api, presentation, context, state)
            elif FILLER is not None:
                context = run_filler(api, presentation, context, state)
            else:
                context = run_offline_gap(api, presentation, context, state)

            save_state(state_path, state)
    finally:
        presentation.finish()


# =============================================================================
# ENTRADA
# =============================================================================


def main() -> int:
    validate_config()

    if len(sys.argv) == 2 and sys.argv[1] == "--validate-config":
        print(f"Scripted Schedule Universal v{SCRIPT_VERSION} - configuracao valida.")
        print(f"Fontes: {len(SOURCES)}")
        print(
            "Modulos ativos: "
            f"ROTATION={bool(ROTATION)}, FIXED_EVENTS={len(FIXED_EVENTS)}, "
            f"FIXED_DURATION_EVENTS={len(FIXED_DURATION_EVENTS)}, FIXED_ALL_EVENTS={len(FIXED_ALL_EVENTS)}, "
            f"FIXED_WINDOW_EVENTS={len(FIXED_WINDOW_EVENTS)}, WINDOW_ROTATIONS={len(WINDOW_ROTATIONS)}, "
            f"SEQUENCE_EVENTS={len(SEQUENCE_EVENTS)}, INTERVAL_EVENTS={len(INTERVAL_EVENTS)}, "
            f"DATE_EVENTS={len(DATE_EVENTS)}, OFFLINE_WINDOWS={len(OFFLINE_WINDOWS)}, "
            f"FILLER={FILLER is not None}"
        )
        return 0

    if len(sys.argv) < 4:
        print(
            "Uso esperado pelo ErsatzTV: script.py <api_host> <build_id> <reset|continue> [state_key]\n"
            "Validacao local: script.py --validate-config",
            file=sys.stderr,
        )
        return 2

    api_host = sys.argv[1]
    build_id = sys.argv[2]
    build_mode = sys.argv[3].strip().lower()
    state_key = safe_state_key(sys.argv[4]) if len(sys.argv) >= 5 else "default"

    api_key = os.environ.get("ETV_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ETV_API_KEY nao esta definida. ErsatzTV v26.9+ deve fornecer essa variavel ao script.")

    state_path = DEFAULT_STATE_DIR / f".{Path(__file__).stem}.{state_key}.state.json"
    state = load_state(state_path)

    if build_mode == "reset":
        state = default_state()
        save_state(state_path, state)
        log("Build reset: estado reiniciado")
    elif build_mode != "continue":
        raise ValueError(f"Modo de build desconhecido: {build_mode!r}")

    api = EtvApi(api_host, build_id, api_key)
    context = api.context()
    log(f"Build {build_mode}: {context['currentTime']} -> {context['finishTime']} (state={state_path})")

    register_sources(api)
    build(api, context, state, state_path)
    log("Build concluido")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERRO: {exc}")
        raise
