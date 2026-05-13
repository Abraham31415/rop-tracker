from __future__ import annotations

import logging
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)

_RATE_LIMIT_HOURS = 6
_last_sent: dict[str, datetime] = {}


def _can_send(alert_key: str) -> bool:
    last = _last_sent.get(alert_key)
    return last is None or datetime.now(timezone.utc) - last > timedelta(hours=_RATE_LIMIT_HOURS)


def send_alert_email(subject: str, body: str, alert_key: str) -> bool:
    """
    Fire an alert. Returns True if the alert fired (not rate-limited), False otherwise.
    Sends an email only when SMTP is configured; always returns True when not rate-limited
    so callers can log the event to the DB regardless.
    """
    if not _can_send(alert_key):
        logger.debug("Alert rate-limited: %s", alert_key)
        return False

    # Record the fire time before attempting email so we rate-limit even on failure
    _last_sent[alert_key] = datetime.now(timezone.utc)

    if not settings.SMTP_HOST or not settings.ALERT_TO_EMAIL:
        logger.warning("Alert triggered (SMTP not configured): %s", subject)
        return True

    try:
        msg = MIMEText(body, "plain")
        msg["Subject"] = f"[ROP Tracker Alert] {subject}"
        msg["From"] = settings.ALERT_FROM_EMAIL or settings.SMTP_USER
        msg["To"] = settings.ALERT_TO_EMAIL
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as s:
            s.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        logger.info("Alert email sent: %s", subject)
    except Exception:
        logger.exception("Failed to send alert email: %s", subject)

    return True
