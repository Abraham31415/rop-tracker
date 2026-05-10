"""
SMS template management.
GET  /api/templates/                         — all templates
PUT  /api/templates/{language}/{trigger}     — update a template body
"""
from __future__ import annotations
import json, os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth.jwt import get_current_user
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/templates", tags=["templates"])

_OVERRIDE_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "templates_override.json")


def _load_overrides() -> dict:
    try:
        with open(_OVERRIDE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_overrides(data: dict) -> None:
    os.makedirs(os.path.dirname(_OVERRIDE_FILE), exist_ok=True)
    with open(_OVERRIDE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _all_templates() -> dict:
    from app.services.messaging import TEMPLATES
    import copy
    merged = copy.deepcopy(TEMPLATES)
    overrides = _load_overrides()
    for lang, triggers in overrides.items():
        if lang not in merged:
            merged[lang] = {}
        for trigger, body in triggers.items():
            merged[lang][trigger] = body
    return merged


def _require_coordinator(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.HOSPITAL_COORDINATOR, UserRole.CENTRAL_COORDINATOR):
        raise HTTPException(403, "Coordinators only")
    return user


@router.get("/")
def get_templates(user: User = Depends(_require_coordinator)):
    templates = _all_templates()
    # Flatten for easier UI consumption
    result = []
    for lang, triggers in templates.items():
        for trigger, body in triggers.items():
            result.append({"language": lang, "trigger": trigger, "body": body})
    return result


class TemplateUpdate(BaseModel):
    body: str


@router.put("/{language}/{trigger}")
def update_template(
    language: str,
    trigger: str,
    data: TemplateUpdate,
    user: User = Depends(_require_coordinator),
):
    from app.services.messaging import TEMPLATES
    valid_langs = set(TEMPLATES.keys())
    valid_triggers = {"t_minus_3", "t_minus_1", "day_of", "ltfu_48h"}
    if language not in valid_langs:
        raise HTTPException(400, f"Unknown language. Valid: {', '.join(sorted(valid_langs))}")
    if trigger not in valid_triggers:
        raise HTTPException(400, f"Unknown trigger. Valid: {', '.join(sorted(valid_triggers))}")

    overrides = _load_overrides()
    if language not in overrides:
        overrides[language] = {}
    overrides[language][trigger] = data.body
    _save_overrides(overrides)
    return {"language": language, "trigger": trigger, "body": data.body}


@router.delete("/{language}/{trigger}")
def reset_template(
    language: str,
    trigger: str,
    user: User = Depends(_require_coordinator),
):
    """Reset a template to the built-in default."""
    overrides = _load_overrides()
    if language in overrides and trigger in overrides[language]:
        del overrides[language][trigger]
        if not overrides[language]:
            del overrides[language]
        _save_overrides(overrides)
    from app.services.messaging import TEMPLATES
    default = TEMPLATES.get(language, {}).get(trigger, "")
    return {"language": language, "trigger": trigger, "body": default, "is_default": True}
