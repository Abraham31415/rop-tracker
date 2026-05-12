"""
SMS dispatch via Africa's Talking + reminder persistence.
Message templates in English and Luganda (plus Runyankole, Acholi, Ateso).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
    from app.models.appointment import Appointment

from app.config import settings

logger = logging.getLogger(__name__)

# ── Message templates ─────────────────────────────────────────────────────────
# Placeholders: {caregiver} {baby_name} {date} {hospital} {phone}
TEMPLATES: dict[str, dict[str, str]] = {
    "english": {
        "t_minus_3": (
            "Hello {caregiver}, your baby {baby_name} has an eye check-up in 3 days "
            "on {date} at {hospital}. Please attend — early treatment saves sight. "
            "Questions? Call {phone}"
        ),
        "t_minus_1": (
            "REMINDER: {baby_name}'s eye exam is TOMORROW ({date}) at {hospital}. "
            "Please come — this appointment is very important. Call {phone}"
        ),
        "day_of": (
            "Today is {baby_name}'s eye exam day at {hospital}. "
            "If you cannot attend, please call us immediately: {phone}"
        ),
        "ltfu_48h": (
            "URGENT: We have not seen {baby_name} for their scheduled eye exam "
            "on {date}. Please contact {hospital} today. Call: {phone}"
        ),
    },
    "luganda": {
        "t_minus_3": (
            "Mulimu {caregiver}, omwana wo {baby_name} alina okufunira amaaso "
            "mu nnaku 3 ku {date} e {hospital}. Jja oyambe omwana wo. "
            "Buuza: {phone}"
        ),
        "t_minus_1": (
            "EKUKUMBUZA: {baby_name} alina examination gy'amaaso LEERO ENKYA "
            "({date}) e {hospital}. Jja mangu — kino kikyamu nnyo. "
            "Koowoola: {phone}"
        ),
        "day_of": (
            "Leero {baby_name} alina okufunira amaaso e {hospital}. "
            "Singa tewayinza kujja, tukoowoola mangu mangu: {phone}"
        ),
        "ltfu_48h": (
            "OMUTWAALO: Tewali {baby_name} ku examination y'amaaso ku {date}. "
            "Dda ku {hospital} leero mangu. Koowoola: {phone}"
        ),
    },
    "runyankole": {
        "t_minus_3": (
            "Oriire ota {caregiver}, omwana wo {baby_name} afaire examination "
            "y'amaisho omu mazuun 3 ku {date} aha {hospital}. "
            "Tuhamagara: {phone}"
        ),
        "t_minus_1": (
            "Ekukumbuza: {baby_name} afaire examination y'amaisho ENJEGYEGYEZA "
            "({date}) aha {hospital}. Tuhamagara: {phone}"
        ),
        "day_of": (
            "Erizooba {baby_name} afaire okugumisibwa amaisho aha {hospital}. "
            "Nkakuhamagara: {phone}"
        ),
        "ltfu_48h": (
            "OMUTWAALO: Ntatwegyere {baby_name} ku examination y'amaisho ku {date}. "
            "Jayo aha {hospital} mangu. Hamagara: {phone}"
        ),
    },
    "acholi": {
        "t_minus_3": (
            "Apwoyo {caregiver}, latin ni {baby_name} tye ki cek wang "
            "i nino 3 i {date} i {hospital}. Bin. Lwong wan: {phone}"
        ),
        "t_minus_1": (
            "Po: {baby_name} tye ki cek wang DIKI ({date}) i {hospital}. "
            "Bin — mony madit matek. Lwong: {phone}"
        ),
        "day_of": (
            "Tin {baby_name} tye ki cek wang i {hospital}. "
            "Ka pe itwero bino, lwong wan mangu: {phone}"
        ),
        "ltfu_48h": (
            "MWAKA: Pe wanenyo {baby_name} i cek wang ku {date}. "
            "Bin i {hospital} tin oyot. Lwong: {phone}"
        ),
    },
    "ateso": {
        "t_minus_3": (
            "Ejok {caregiver}, ijo {baby_name} edwong examination ya ilolo "
            "ijo amin 3 ku {date} kide {hospital}. Idwong: {phone}"
        ),
        "t_minus_1": (
            "Ekukumbuza: {baby_name} edwong examination ya ilolo APARAN "
            "({date}) kide {hospital}. Bo. Idwong: {phone}"
        ),
        "day_of": (
            "Dakaun {baby_name} edwong examination ya ilolo kide {hospital}. "
            "Itunga bo, idwong: {phone}"
        ),
        "ltfu_48h": (
            "OMWAKA: Itubong {baby_name} examination ya ilolo ku {date}. "
            "Itubar kide {hospital} tenet. Idwong: {phone}"
        ),
    },
}

CONTACT_PHONE = "+256200900900"  # fallback — override per hospital


def render_message(
    trigger: str,
    language: str,
    baby_name: str,
    caregiver: str,
    appt_date: date,
    hospital: str,
) -> str:
    lang = (language or "english").lower()
    templates = TEMPLATES.get(lang, TEMPLATES["english"])
    template = templates.get(trigger, templates["t_minus_3"])
    return template.format(
        caregiver=caregiver,
        baby_name=baby_name,
        date=appt_date.strftime("%d %b %Y"),
        hospital=hospital,
        phone=CONTACT_PHONE,
    )


def send_sms(phone: str, message: str) -> dict:
    """
    Send SMS via Africa's Talking.

    When AT_SIMULATE=True (default until real credentials are configured),
    the message is logged but no HTTP call is made — useful for development
    before an AT account exists. Flip to False once you have real credentials.
    """
    if settings.AT_SIMULATE:
        logger.info(
            "[SIMULATED SMS] To: %s | Message: %s",
            phone, message
        )
        return {
            "success": True,
            "response": {"SMSMessageData": {"Recipients": [{"messageId": "sim-0", "status": "Success"}]}},
        }

    try:
        import africastalking
        africastalking.initialize(settings.AT_USERNAME, settings.AT_API_KEY)
        response = africastalking.SMS.send(message, [phone], settings.AT_SENDER_ID or None)
        logger.info("SMS sent to %s | %s", phone, message[:60])
        return {"success": True, "response": response}
    except Exception as exc:
        logger.error("SMS failed to %s: %s", phone, exc)
        return {"success": False, "error": str(exc)}


def test_gateway(phone: str) -> dict:
    """
    Send a live test SMS via Africa's Talking, always bypassing AT_SIMULATE.
    Used by the Settings gateway-status page to verify credentials work.
    """
    if not settings.AT_API_KEY:
        return {"success": False, "simulated": False, "error": "AT_API_KEY is not set in environment"}
    message = (
        "ROP Tracker test message from Uganda ROP Network. "
        "Gateway is working correctly. Please ignore."
    )
    try:
        import africastalking
        africastalking.initialize(settings.AT_USERNAME, settings.AT_API_KEY)
        response = africastalking.SMS.send(message, [phone], settings.AT_SENDER_ID or None)
        recipients = response.get("SMSMessageData", {}).get("Recipients", [])
        if recipients:
            r = recipients[0]
            ok = r.get("status") == "Success"
            return {
                "success": ok,
                "simulated": False,
                "message_id": r.get("messageId"),
                "cost": r.get("cost"),
                "status": r.get("status"),
                "error": None if ok else f"AT status: {r.get('status')}",
            }
        return {"success": False, "simulated": False, "error": "Empty recipients in AT response"}
    except Exception as exc:
        logger.error("Gateway test failed: %s", exc)
        return {"success": False, "simulated": False, "error": str(exc)}


def dispatch_reminder(db: "Session", appointment: "Appointment", trigger: str) -> "Reminder":  # noqa: F821
    """
    Full pipeline: pick phone → render message → send via AT → persist Reminder row.
    Safe to call even when AT is in sandbox mode or credentials are missing —
    the Reminder is persisted with status=failed and the error recorded.
    """
    from app.models.reminder import Reminder, ReminderStatus, ReminderTrigger, ReminderType

    baby = appointment.baby
    hospital_name = baby.hospital.name if baby.hospital else "your hospital"
    language = (baby.language_preference or "english").lower()
    phone = baby.mtn_phone or baby.airtel_phone
    now = datetime.now(timezone.utc)

    if not phone:
        reminder = Reminder(
            baby_id=baby.id,
            appointment_id=appointment.id,
            reminder_type=ReminderType.SMS,
            trigger=trigger,
            language=language,
            recipient_phone=None,
            message_body=None,
            status=ReminderStatus.FAILED,
            error_message="No phone number on record",
            scheduled_at=now,
        )
        db.add(reminder)
        db.commit()
        db.refresh(reminder)
        logger.warning("No phone for baby %s — reminder skipped", baby.full_name)
        return reminder

    message = render_message(
        trigger=trigger,
        language=language,
        baby_name=baby.full_name,
        caregiver=baby.caregiver_name,
        appt_date=appointment.due_date,
        hospital=hospital_name,
    )

    result = send_sms(phone, message)

    # Extract Africa's Talking message ID safely
    at_msg_id = None
    if result["success"]:
        try:
            recipients = result["response"]["SMSMessageData"]["Recipients"]
            if recipients:
                at_msg_id = recipients[0].get("messageId")
        except (KeyError, IndexError, TypeError):
            pass

    reminder = Reminder(
        baby_id=baby.id,
        appointment_id=appointment.id,
        reminder_type=ReminderType.SMS,
        trigger=trigger,
        language=language,
        recipient_phone=phone,
        message_body=message,
        status=ReminderStatus.SENT if result["success"] else ReminderStatus.FAILED,
        provider_message_id=at_msg_id,
        error_message=result.get("error") if not result["success"] else None,
        scheduled_at=now,
        sent_at=now if result["success"] else None,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder
