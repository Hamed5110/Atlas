"""Property-based tests for calendar helpers."""

from datetime import date

from hypothesis import given, settings
from hypothesis import strategies as st

from airfare_management.api.main import _first_of_next_month

YEAR = st.integers(min_value=2000, max_value=2035)
MONTH = st.integers(min_value=1, max_value=12)
DAY = st.integers(min_value=1, max_value=28)


class TestDateProperties:
    """First-of-next-month helper invariants."""

    @given(year=YEAR, month=MONTH, day=DAY)
    @settings(max_examples=200, deadline=None)
    def test_next_cycle_due_is_first_of_next_month(
        self, year: int, month: int, day: int
    ) -> None:
        anchor = date(year, month, day)
        result = _first_of_next_month(anchor)
        assert result.day == 1
        if month == 12:
            assert result.year == year + 1
            assert result.month == 1
        else:
            assert result.year == year
            assert result.month == month + 1

    @given(year=YEAR, month=MONTH, day=DAY)
    @settings(max_examples=100, deadline=None)
    def test_result_always_after_anchor(self, year: int, month: int, day: int) -> None:
        anchor = date(year, month, day)
        result = _first_of_next_month(anchor)
        assert result > anchor
