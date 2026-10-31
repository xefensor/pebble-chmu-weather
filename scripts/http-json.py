#!/usr/bin/env python3
"""Restricted JSON transport for developer scripts; stdout is a machine pipe."""

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


HOSTS = frozenset({
    "data-provider.chmi.cz",
    "opendata.chmi.cz",
    "api.open-meteo.com",
    "chmu.rails.cz",
})
MAX_BODY = 4 * 1024 * 1024
MAX_INPUT = 8 * 1024 * 1024
TIMEOUT = 8
HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
RESPONSE_HEADERS = ("etag", "last-modified", "cache-control", "expires")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def reject_constant(_value):
    raise ValueError()


def parse_json(raw):
    value = json.loads(raw.decode("utf-8-sig"), parse_constant=reject_constant)
    # Reject non-finite values, including numeric overflow, before forwarding.
    json.dumps(value, allow_nan=False)
    return value


def make_request(payload):
    if not isinstance(payload, dict):
        raise ValueError()
    url = payload.get("url")
    if not isinstance(url, str) or not url or len(url) > 65536:
        raise ValueError()
    if "#" in url or any(ord(char) <= 32 or ord(char) == 127 for char in url):
        raise ValueError()
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in HOSTS
            or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443)):
        raise ValueError()

    init = payload.get("init", {})
    if not isinstance(init, dict):
        raise ValueError()
    method = init.get("method", "GET")
    if method not in ("GET", "POST"):
        raise ValueError()
    headers = init.get("headers", {})
    if not isinstance(headers, dict) or len(headers) > 128:
        raise ValueError()
    header_size = 0
    for name, value in headers.items():
        if (not isinstance(name, str) or not HEADER_NAME.fullmatch(name)
                or not isinstance(value, str)
                or any(char in value for char in ("\r", "\n", "\0"))
                or name.lower() in ("host", "proxy-authorization", "proxy-connection")):
            raise ValueError()
        header_size += len(name) + len(value)
    if header_size > 65536:
        raise ValueError()
    body = init.get("body")
    if body is not None and not isinstance(body, str):
        raise ValueError()
    data = body.encode("utf-8") if body is not None else None
    if data is not None and len(data) > MAX_BODY:
        raise ValueError()
    return urllib.request.Request(url, data=data, headers=headers, method=method)


def response_body(response):
    raw = response.read(MAX_BODY + 1)
    if len(raw) > MAX_BODY:
        return None
    try:
        return parse_json(raw)
    except Exception:
        return None


def response_headers(response):
    selected = {}
    headers = getattr(response, "headers", None)
    if headers is None:
        return selected
    for name in RESPONSE_HEADERS:
        value = headers.get(name)
        if (isinstance(value, str) and len(value) <= 4096
                and not any(char in value for char in ("\r", "\n", "\0"))):
            selected[name] = value
    return selected


def transport(payload):
    try:
        request = make_request(payload)
        # The default ProxyHandler honors standard urllib proxy configuration.
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=TIMEOUT) as response:
                return {"status": response.status, "body": response_body(response),
                        "headers": response_headers(response)}
        except urllib.error.HTTPError as response:
            with response:
                return {"status": response.code, "body": response_body(response),
                        "headers": response_headers(response)}
    except Exception:
        return {"status": 0, "body": None, "headers": {}}


def main():
    result = {"status": 0, "body": None, "headers": {}}
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) <= MAX_INPUT:
            result = transport(parse_json(raw))
    except BaseException:
        pass
    try:
        sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False,
                                    separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except BaseException:
        # A closed machine pipe must not cause a traceback with request context.
        pass


if __name__ == "__main__":
    main()
