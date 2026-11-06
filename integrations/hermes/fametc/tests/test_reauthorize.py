"""Hermes >= 0.23 role re-check (run: python3 -m unittest discover -s integrations/hermes/fametc/tests)."""
import asyncio
import importlib
import os
import sys
import types
import unittest

PKG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _load_adapter():
    """Import adapter.py with minimal stand-ins for the Hermes gateway modules."""
    gateway = types.ModuleType("gateway")
    config = types.ModuleType("gateway.config")
    config.Platform = type("Platform", (), {})
    config.PlatformConfig = type("PlatformConfig", (), {})
    platforms = types.ModuleType("gateway.platforms")
    base = types.ModuleType("gateway.platforms.base")
    for name in ("BasePlatformAdapter", "MessageEvent", "MessageType", "SendResult"):
        setattr(base, name, type(name, (), {}))
    sys.modules.update({"gateway": gateway, "gateway.config": config,
                        "gateway.platforms": platforms, "gateway.platforms.base": base})
    parent = os.path.dirname(PKG_DIR)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    pkg = os.path.basename(PKG_DIR)
    return importlib.import_module(f"{pkg}.adapter")


adapter_mod = _load_adapter()
Adapter = next(v for v in vars(adapter_mod).values()
               if isinstance(v, type) and hasattr(v, "reauthorize_native_roles") and v.__module__ == adapter_mod.__name__)


def run(adapter, chat_id):
    return asyncio.run(Adapter.reauthorize_native_roles(adapter, types.SimpleNamespace(chat_id=chat_id)))


class Fake:
    def __init__(self, rooms=None, error=None):
        self.rooms, self.error = rooms or [], error

    async def _list_rooms(self):
        if self.error:
            raise self.error
        return self.rooms


class ReauthorizeTests(unittest.TestCase):
    def test_room_still_authorized(self):
        self.assertIs(run(Fake([{"roomId": "family"}, {"roomId": "hermes:p1"}]), "hermes:p1"), True)

    def test_room_no_longer_listed(self):
        self.assertIs(run(Fake([{"roomId": "family"}]), "hermes:p1"), False)

    def test_bridge_failure_fails_closed(self):
        self.assertIs(run(Fake(error=RuntimeError("401")), "family"), False)

    def test_missing_chat_id(self):
        self.assertIs(run(Fake([{"roomId": "family"}]), None), False)


if __name__ == "__main__":
    unittest.main()
