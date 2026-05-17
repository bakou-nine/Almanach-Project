from __future__ import annotations

import argparse
import logging
import sys

import uvicorn

# On Windows the bundled certifi store frequently lags behind the OS trust
# store, breaking TLS to sites with Let's Encrypt and other modern CAs. Route
# Python's default SSL context through the OS trust store instead — same CAs
# Chrome / Edge / etc. already trust.
if sys.platform == "win32":
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(prog="almanach", description="Run Almanach.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    uvicorn.run(
        "almanach.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
