"""Seed Atlas Aluminum sample workforce (15 employees + 2026 opening balances)."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import create_engine, text

from airfare_management.config import get_settings

COMPANY_ID = "11111111-1111-1111-1111-111111111111"

# grade -> max payout (BHD) until EntitlementPolicy table exists
GRADE_RATE = {"A": Decimal("350"), "B": Decimal("250"), "C": Decimal("180"), "D": Decimal("150"), "E": Decimal("120")}

EMPLOYEES: list[dict[str, object]] = [
    {
        "code": "AA-001",
        "full_name": "Khalid Al-Mansoori",
        "email": "khalid.almansoori@atlas-aluminum.com",
        "department": "Admin",
        "branch": "Head Office",
        "designation": "General Manager",
        "nationality": "Bahraini",
        "pay_group": "monthly",
        "sub_section": "Executive",
        "join_date": date(2020, 3, 15),
        "grade": "A",
        "opening_days": Decimal("22"),
    },
    {
        "code": "AA-002",
        "full_name": "Fatima Al-Khalifa",
        "email": "fatima.alkhalifa@atlas-aluminum.com",
        "department": "HR",
        "branch": "Head Office",
        "designation": "Manager",
        "nationality": "Bahraini",
        "pay_group": "monthly",
        "sub_section": "Human Resources",
        "join_date": date(2021, 6, 1),
        "grade": "B",
        "opening_days": Decimal("18"),
        "reports_to_code": "AA-001",
    },
    {
        "code": "AA-003",
        "full_name": "Rajesh Kumar",
        "email": "rajesh.kumar@atlas-aluminum.com",
        "department": "Production",
        "branch": "Factory 1",
        "designation": "Manager",
        "nationality": "Indian",
        "pay_group": "monthly",
        "sub_section": "Casting",
        "join_date": date(2020, 9, 10),
        "grade": "B",
        "opening_days": Decimal("20"),
        "reports_to_code": "AA-001",
    },
    {
        "code": "AA-004",
        "full_name": "Mohammed Ali Hassan",
        "email": "mohammed.hassan@atlas-aluminum.com",
        "department": "Production",
        "branch": "Factory 1",
        "designation": "Supervisor",
        "nationality": "Egyptian",
        "pay_group": "monthly",
        "sub_section": "Extrusion Line 1",
        "join_date": date(2022, 2, 14),
        "grade": "C",
        "opening_days": Decimal("14"),
        "reports_to_code": "AA-003",
    },
    {
        "code": "AA-005",
        "full_name": "Ahmed Rahman",
        "email": "ahmed.rahman@atlas-aluminum.com",
        "department": "Maintenance",
        "branch": "Factory 2",
        "designation": "Supervisor",
        "nationality": "Bangladeshi",
        "pay_group": "monthly",
        "sub_section": "Mechanical",
        "join_date": date(2021, 11, 20),
        "grade": "C",
        "opening_days": Decimal("16"),
        "reports_to_code": "AA-003",
    },
    {
        "code": "AA-006",
        "full_name": "Imran Shaikh",
        "email": "imran.shaikh@atlas-aluminum.com",
        "department": "Quality",
        "branch": "Factory 1",
        "designation": "Supervisor",
        "nationality": "Pakistani",
        "pay_group": "monthly",
        "sub_section": "QA Lab",
        "join_date": date(2023, 4, 5),
        "grade": "C",
        "opening_days": Decimal("12"),
        "reports_to_code": "AA-003",
    },
    {
        "code": "AA-007",
        "full_name": "Priya Nair",
        "email": "priya.nair@atlas-aluminum.com",
        "department": "Engineering",
        "branch": "Factory 1",
        "designation": "Engineer",
        "nationality": "Indian",
        "pay_group": "monthly",
        "sub_section": "Process Engineering",
        "join_date": date(2022, 8, 1),
        "grade": "C",
        "opening_days": Decimal("15"),
        "reports_to_code": "AA-003",
    },
    {
        "code": "AA-008",
        "full_name": "Carlos Santos",
        "email": "carlos.santos@atlas-aluminum.com",
        "department": "Production",
        "branch": "Factory 2",
        "designation": "Engineer",
        "nationality": "Filipino",
        "pay_group": "monthly",
        "sub_section": "Finishing",
        "join_date": date(2023, 1, 15),
        "grade": "C",
        "opening_days": Decimal("13"),
        "reports_to_code": "AA-003",
    },
    {
        "code": "AA-009",
        "full_name": "Omar Farouk",
        "email": "omar.farouk@atlas-aluminum.com",
        "department": "Maintenance",
        "branch": "Factory 2",
        "designation": "Engineer",
        "nationality": "Jordanian",
        "pay_group": "monthly",
        "sub_section": "Electrical",
        "join_date": date(2024, 3, 10),
        "grade": "C",
        "opening_days": Decimal("8"),
        "reports_to_code": "AA-005",
    },
    {
        "code": "AA-010",
        "full_name": "Yusuf Ibrahim",
        "email": "yusuf.ibrahim@atlas-aluminum.com",
        "department": "Logistics",
        "branch": "Factory 1",
        "designation": "Engineer",
        "nationality": "Indian",
        "pay_group": "monthly",
        "sub_section": "Warehouse Systems",
        "join_date": date(2023, 7, 22),
        "grade": "C",
        "opening_days": Decimal("11"),
        "reports_to_code": "AA-003",
    },
    {
        "code": "AA-011",
        "full_name": "Ravi Shankar",
        "email": "ravi.shankar@atlas-aluminum.com",
        "department": "Production",
        "branch": "Factory 1",
        "designation": "Technician",
        "nationality": "Indian",
        "pay_group": "monthly",
        "sub_section": "Extrusion Line 2",
        "join_date": date(2022, 5, 18),
        "grade": "D",
        "opening_days": Decimal("14"),
        "reports_to_code": "AA-004",
    },
    {
        "code": "AA-012",
        "full_name": "Hassan Mahmoud",
        "email": "hassan.mahmoud@atlas-aluminum.com",
        "department": "Maintenance",
        "branch": "Factory 2",
        "designation": "Technician",
        "nationality": "Egyptian",
        "pay_group": "monthly",
        "sub_section": "HVAC",
        "join_date": date(2023, 9, 1),
        "grade": "D",
        "opening_days": Decimal("10"),
        "reports_to_code": "AA-005",
    },
    {
        "code": "AA-013",
        "full_name": "Junaid Khan",
        "email": "junaid.khan@atlas-aluminum.com",
        "department": "Quality",
        "branch": "Factory 1",
        "designation": "Technician",
        "nationality": "Pakistani",
        "pay_group": "monthly",
        "sub_section": "Inspection",
        "join_date": date(2024, 6, 12),
        "grade": "D",
        "opening_days": Decimal("7"),
        "reports_to_code": "AA-006",
    },
    {
        "code": "AA-014",
        "full_name": "Abdul Hameed",
        "email": "abdul.hameed@atlas-aluminum.com",
        "department": "Production",
        "branch": "Factory 1",
        "designation": "Operator",
        "nationality": "Bangladeshi",
        "pay_group": "monthly",
        "sub_section": "Melting",
        "join_date": date(2024, 11, 3),
        "grade": "E",
        "opening_days": Decimal("5"),
        "reports_to_code": "AA-004",
    },
    {
        "code": "AA-015",
        "full_name": "Arjun Menon",
        "email": "arjun.menon@atlas-aluminum.com",
        "department": "Production",
        "branch": "Factory 2",
        "designation": "Operator",
        "nationality": "Indian",
        "pay_group": "monthly",
        "sub_section": "Packaging",
        "join_date": date(2025, 2, 20),
        "grade": "E",
        "opening_days": Decimal("4"),
        "reports_to_code": "AA-008",
    },
]


def _amount(max_payout: Decimal, days: Decimal) -> Decimal:
    return (max_payout / Decimal("60") * days).quantize(Decimal("0.01"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Replace existing AA-* rows.")
    args = parser.parse_args()
    settings = get_settings()
    engine = create_engine(settings.database_url)
    now = datetime.now(timezone.utc)
    ids_by_code: dict[str, str] = {}

    with engine.begin() as conn:
        existing = conn.execute(
            text("SELECT COUNT(*) FROM employees WHERE code LIKE 'AA-%' AND deleted_at IS NULL")
        ).scalar()
        if existing and not args.force:
            print(f"Found {existing} active AA-* employees. Use --force to replace.")
            return
        if existing and args.force:
            aa_ids = [
                str(row[0])
                for row in conn.execute(
                    text("SELECT id FROM employees WHERE code LIKE 'AA-%' AND deleted_at IS NULL")
                ).fetchall()
            ]
            if aa_ids:
                for table in ("tickets", "loans", "opening_balances", "ess_requests"):
                    conn.execute(
                        text(
                            f"""
                            UPDATE {table}
                            SET deleted_at = :now, version = version + 1
                            WHERE deleted_at IS NULL AND employee_id IN ({",".join(f"'{i}'" for i in aa_ids)})
                            """
                        ),
                        {"now": now},
                    )
                conn.execute(
                    text(
                        f"""
                        UPDATE employees
                        SET deleted_at = :now, active = 0, version = version + 1
                        WHERE code LIKE 'AA-%' AND deleted_at IS NULL
                        """
                    ),
                    {"now": now},
                )

        for row in EMPLOYEES:
            grade = str(row["grade"])
            max_payout = GRADE_RATE[grade]
            emp_id = str(uuid4())
            ids_by_code[str(row["code"])] = emp_id
            conn.execute(
                text(
                    """
                    INSERT INTO employees (
                        id, company_id, code, full_name, join_date, department, branch,
                        pay_group, repair_center, designation, nationality, sub_section,
                        reporting_officer_id, email, custom_airfare_rate, max_entitlement_cap_rate,
                        active, version, created_at, updated_at
                    ) VALUES (
                        :id, :company_id, :code, :full_name, :join_date, :department, :branch,
                        :pay_group, '', :designation, :nationality, :sub_section,
                        NULL, :email, :rate, :cap, 1, 1, :now, :now
                    )
                    """
                ),
                {
                    "id": emp_id,
                    "company_id": COMPANY_ID,
                    "code": row["code"],
                    "full_name": row["full_name"],
                    "join_date": row["join_date"],
                    "department": row["department"],
                    "branch": row["branch"],
                    "pay_group": row["pay_group"],
                    "designation": row["designation"],
                    "nationality": row["nationality"],
                    "sub_section": row["sub_section"],
                    "email": row["email"],
                    "rate": max_payout,
                    "cap": max_payout,
                    "now": now,
                },
            )

        for row in EMPLOYEES:
            code = str(row["code"])
            reports = row.get("reports_to_code")
            if reports:
                conn.execute(
                    text(
                        """
                        UPDATE employees
                        SET reporting_officer_id = :ro, version = version + 1, updated_at = :now
                        WHERE id = :id
                        """
                    ),
                    {"ro": ids_by_code[str(reports)], "id": ids_by_code[code], "now": now},
                )

        for row in EMPLOYEES:
            grade = str(row["grade"])
            max_payout = GRADE_RATE[grade]
            days = Decimal(str(row["opening_days"]))
            conn.execute(
                text(
                    """
                    INSERT INTO opening_balances (
                        id, employee_id, balance_year, opening_days, paid_days,
                        opening_amount, maximum_payout, version, created_at, updated_at
                    ) VALUES (
                        :id, :employee_id, 2026, :opening_days, 0,
                        :opening_amount, :maximum_payout, 1, :now, :now
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "employee_id": ids_by_code[str(row["code"])],
                    "opening_days": days,
                    "opening_amount": _amount(max_payout, days),
                    "maximum_payout": max_payout,
                    "now": now,
                },
            )

        total = conn.execute(
            text("SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL")
        ).scalar()
        print(f"Seeded {len(EMPLOYEES)} Atlas Aluminum employees. Active total: {total}")


if __name__ == "__main__":
    main()
