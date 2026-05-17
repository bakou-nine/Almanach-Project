import sys as _sys

__version__ = "0.1.0"

if _sys.platform == "win32":
    try:
        import truststore as _truststore

        _truststore.inject_into_ssl()
    except ImportError:
        pass
