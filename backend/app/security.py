from __future__ import annotations

import logging
import re
from typing import Any


SENSITIVE_HEADER_RE = re.compile(
    r"(?i)\b(x-meraki-api-key|x-cisco-meraki-api-key|authorization)\b([\"'\s:=]+)([^\"',}]+)"
)
BEARER_RE = re.compile(r"(?i)\bbearer\s+[^\"'\s,}]+")


def redact_sensitive(value: Any, extra_values: tuple[str, ...] = ()) -> str:
    text = str(value)
    text = SENSITIVE_HEADER_RE.sub(r"\1\2[REDACTED]", text)
    text = BEARER_RE.sub("Bearer [REDACTED]", text)
    for secret in extra_values:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return text


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact_sensitive(record.getMessage())
            record.args = ()
        except Exception:
            record.msg = "[REDACTED LOG MESSAGE]"
            record.args = ()
        return True
