"""True-mode: instance meta must accept list payload fields without name= collision."""

from __future__ import annotations

from airfare_management.whatsapp import events as wa_events


def test_set_instance_meta_ignores_name_kwarg() -> None:
    wa_events.set_instance_meta(
        "lab-ops-bh-01",
        name="lab-ops-bh-01",  # would TypeError without guard
        state="connecting",
        phone=None,
        mode="baileys",
    )
    meta = wa_events.get_instance_meta("lab-ops-bh-01")
    assert meta is not None
    assert meta["name"] == "lab-ops-bh-01"
    assert meta["state"] == "connecting"
    assert meta["mode"] == "baileys"
