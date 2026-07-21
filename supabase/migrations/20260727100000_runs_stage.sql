-- Live pipeline stage ("mining", "scraping", "scoring", …) written
-- additively by the worker at existing stage boundaries. Free-text slug:
-- stages are display hints, not workflow state — run_status stays the
-- source of truth. Terminal updates leave it untouched so a failed run
-- shows where it died.
alter table runs add column stage text;
