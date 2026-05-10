from __future__ import annotations
"""
ROP follow-up scheduling per standard guidelines:
  Zone I (any stage) or Zone II Stage 2+ with Plus  → 1 week
  Zone II Stage 2+ (no Plus)                         → 1 week
  Zone II Stage 1                                     → 2 weeks
  Zone II immature / Zone III Stage 1                → 2-3 weeks (we use 2)
  Zone III no ROP                                    → 4 weeks
"""
from datetime import date, timedelta
from app.models.exam import Zone, Stage, PlusDisease


def calculate_next_exam_weeks(
    worst_zone: Zone | None,
    worst_stage: Stage | None,
    has_plus: bool,
) -> int:
    if worst_zone is None:
        return 4

    if worst_zone == Zone.ZONE_I:
        return 1

    if worst_zone == Zone.ZONE_II:
        if worst_stage in (Stage.STAGE_2, Stage.STAGE_3, Stage.STAGE_4, Stage.STAGE_5):
            return 1
        if worst_stage == Stage.STAGE_1:
            return 2
        if worst_stage in (Stage.IMMATURE, Stage.NO_ROP):
            return 2

    # Zone III
    if worst_stage in (Stage.STAGE_1,):
        return 2
    return 4


def derive_worst_finding(exam) -> tuple[Zone | None, Stage | None, bool]:
    """Return (worst_zone, worst_stage, has_plus) from both eyes."""
    zone_rank = {Zone.ZONE_I: 1, Zone.ZONE_II: 2, Zone.ZONE_III: 3}
    stage_rank = {
        Stage.STAGE_5: 5, Stage.STAGE_4: 4, Stage.STAGE_3: 3,
        Stage.STAGE_2: 2, Stage.STAGE_1: 1, Stage.IMMATURE: 0, Stage.NO_ROP: -1,
    }

    worst_zone = None
    worst_stage = None
    has_plus = False

    for eye_zone, eye_stage, eye_plus in [
        (exam.right_zone, exam.right_stage, exam.right_plus),
        (exam.left_zone, exam.left_stage, exam.left_plus),
    ]:
        if eye_zone is None:
            continue
        if worst_zone is None or zone_rank.get(eye_zone, 99) < zone_rank.get(worst_zone, 99):
            worst_zone = eye_zone
        if eye_stage is not None:
            if worst_stage is None or stage_rank.get(eye_stage, -99) > stage_rank.get(worst_stage, -99):
                worst_stage = eye_stage
        if eye_plus in (PlusDisease.PLUS, PlusDisease.PRE_PLUS):
            has_plus = True

    return worst_zone, worst_stage, has_plus


def next_due_date(exam_date: date, weeks: int) -> date:
    return exam_date + timedelta(weeks=weeks)
