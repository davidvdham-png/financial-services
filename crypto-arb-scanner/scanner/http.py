"""Shared HTTP plumbing: stdlib only, with retries, backoff and pacing.

Every venue client sits on top of this. Exchange-specific rate-limit
accounting (Bitvavo's weight headers, for instance) is layered on by the
client through the `on_response` hook.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from .types import VenueError

USER_AGENT = "crypto-arb-scanner/0.2 (read-only market-data scanner)"


class HttpClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 10.0,
        max_retries: int = 4,
        min_interval: float = 0.0,
        user_agent: str = USER_AGENT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        # Floor on the gap between requests, for venues that throttle by
        # request rate rather than by weight.
        self.min_interval = min_interval
        self.user_agent = user_agent
        self._last_request_at = 0.0
        # Set by a client's rate-limit accounting to force a wait.
        self.hold_until = 0.0

    def _pace(self) -> None:
        now = time.time()
        earliest = max(self._last_request_at + self.min_interval, self.hold_until)
        if earliest > now:
            time.sleep(min(earliest - now, 60.0))
        self._last_request_at = time.time()

    def get_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        on_response: Callable[[Any], None] | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            self._pace()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if on_response:
                        on_response(response.headers)
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if on_response:
                    on_response(exc.headers)
                if exc.code == 429:
                    # Throttled: respect whatever hold the client computed,
                    # otherwise back off a fixed step.
                    wait = max(self.hold_until - time.time(), 5.0 * (attempt + 1))
                    time.sleep(min(wait, 60.0))
                    last_error = exc
                    continue
                if 500 <= exc.code < 600:
                    last_error = exc
                    time.sleep(2.0**attempt)
                    continue
                raise VenueError(f"{path}: HTTP {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                time.sleep(2.0**attempt)

        raise VenueError(f"{path}: failed after {self.max_retries} attempts: {last_error}")
