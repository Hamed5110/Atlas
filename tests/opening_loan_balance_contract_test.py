from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "server.js").read_text(encoding="utf-8")
HCM_SQL = (ROOT / "database" / "ATLAS_HCM_SQL_Objects.sql").read_text(encoding="utf-8")
PAGE = (ROOT / "atlas-hcm-next" / "app" / "page.tsx").read_text(encoding="utf-8")


def require(text: str, needle: str, message: str) -> None:
    if needle not in text:
        raise AssertionError(message)


require(HCM_SQL, "CREATE TABLE dbo.OpeningLoanBalances", "Opening loan balance table is missing")
require(HCM_SQL, "sp_ATLAS_UpsertOpeningLoanBalance", "Opening loan balance upsert procedure is missing")
require(HCM_SQL, "sp_ATLAS_GetOpeningLoanBalances", "Opening loan balance register procedure is missing")
require(HCM_SQL, "NextOpeningLoanBalance", "Year-end SQL preview does not expose next opening loan balance")
require(SERVER, "/api/opening-loan-balances", "Opening loan balance API route is missing")
require(SERVER, "sp_ATLAS_UpsertOpeningLoanBalance", "Year-end close does not call the SQL upsert procedure")
require(PAGE, "Opening Loan Balance", "Loan dashboard does not display opening loan balance")
require(PAGE, "NextOpeningLoanBalance", "Year-end preview does not display the SQL opening loan value")

print("opening loan balance SQL/API/UI contract passed")
